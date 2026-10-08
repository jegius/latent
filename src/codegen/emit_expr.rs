//! Кодогенерация выражений: диспетчер и скалярные выражения.

use super::bytecode::{op, valtype};
use super::context::{FuncContext, StaticTy};
use super::module_builder::WasmCodegen;
use super::runtime_helpers::{
    F64_TO_STR, I32_TO_STR, STR_CHAR_AT, STR_CONCAT, STR_EQ,
};
use crate::ast::*;

impl WasmCodegen {
    pub(super) fn compile_expr(&mut self, expr: &Expr, ctx: &mut FuncContext) -> Result<(), String> {
        match &expr.kind {
            ExprKind::Number(n) => {
                if n.fract() == 0.0 {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(*n as i32);
                } else {
                    ctx.body.push(op::F64_CONST);
                    ctx.body.extend(&n.to_le_bytes());
                }
                Ok(())
            }

            ExprKind::Bool(b) => {
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(if *b { 1 } else { 0 });
                Ok(())
            }

            ExprKind::Null => {
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(0);
                Ok(())
            }

            ExprKind::String(s) => {
                let addr = self.add_string(s);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(addr as i32);
                Ok(())
            }

            ExprKind::Identifier(name) => {
                if let Some((idx, _)) = ctx.locals.get(name) {
                    ctx.body.push(op::LOCAL_GET);
                    ctx.body.write_u32(*idx);
                    Ok(())
                } else if let Some((tag, 0)) = self.enum_variant(name) {
                    // 0-арный вариант enum как значение.
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(tag);
                    Ok(())
                } else {
                    Err(format!("Undefined variable: {}", name))
                }
            }

            ExprKind::Binary { op, left, right } => {
                self.compile_binary(op, left, right, ctx)
            }

            ExprKind::Unary { op, operand } => {
                let is_float = self.static_ty_of(operand, ctx) == StaticTy::Float;
                match op {
                    UnaryOp::Neg => {
                        if is_float {
                            self.compile_expr(operand, ctx)?;
                            ctx.body.push(op::F64_NEG);
                        } else {
                            // 0 - operand: константа push ДО операнда.
                            ctx.body.push(op::I32_CONST);
                            ctx.body.write_i32(0);
                            self.compile_expr(operand, ctx)?;
                            ctx.body.push(op::I32_SUB);
                        }
                    }
                    UnaryOp::Not => {
                        self.compile_expr(operand, ctx)?;
                        ctx.body.push(op::I32_EQZ);
                    }
                }
                Ok(())
            }

            ExprKind::Assign { target, value } => {
                match &target.kind {
                    ExprKind::Identifier(name) => {
                        self.compile_expr(value, ctx)?;
                        if let Some((idx, _)) = ctx.locals.get(name) {
                            ctx.body.push(op::LOCAL_SET);
                            ctx.body.write_u32(*idx);
                            ctx.body.push(op::LOCAL_GET);
                            ctx.body.write_u32(*idx);
                            Ok(())
                        } else {
                            Err(format!("Undefined variable: {}", name))
                        }
                    }
                    ExprKind::Index { object, index } => {
                        self.compile_index_assign(object, index, value, ctx)
                    }
                    ExprKind::Field { object, field } => {
                        self.compile_field_assign(object, field, value, ctx)
                    }
                    _ => Err("Complex assignment not yet supported".to_string()),
                }
            }

            ExprKind::Call { callee, args } => {
                self.compile_call(callee, args, ctx)
            }

            ExprKind::Array(elements) => {
                self.compile_array(elements, ctx)
            }

            ExprKind::Index { object, index } => {
                // Индексация строки → байт-символ; массива → элемент.
                if self.static_ty_of(object, ctx) == StaticTy::Str {
                    self.compile_expr(object, ctx)?;
                    self.compile_expr(index, ctx)?;
                    self.emit_helper_call(&mut ctx.body, STR_CHAR_AT);
                    return Ok(());
                }
                self.compile_expr(object, ctx)?;
                self.compile_expr(index, ctx)?;
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(4);
                ctx.body.push(op::I32_MUL);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(4);
                ctx.body.push(op::I32_ADD);
                self.emit_i32_load(&mut ctx.body);
                Ok(())
            }

            ExprKind::Field { object, field } => {
                // .length: строка — заголовок; массив — заголовок.
                if field == "length" {
                    self.compile_expr(object, ctx)?;
                    self.emit_i32_load(&mut ctx.body);
                    return Ok(());
                }
                self.compile_expr(object, ctx)?;

                let class_name = self.infer_class_name(object, ctx);
                if let Some(layout) = self.class_layouts.get(&class_name) {
                    if let Some(field_info) = layout.fields.iter().find(|f| f.name == *field) {
                        if field_info.offset > 0 {
                            ctx.body.push(op::I32_CONST);
                            ctx.body.write_i32(field_info.offset as i32);
                            ctx.body.push(op::I32_ADD);
                        }
                        if field_info.valtype == valtype::F64 {
                            self.emit_f64_load(&mut ctx.body);
                        } else {
                            self.emit_i32_load(&mut ctx.body);
                        }
                        Ok(())
                    } else {
                        Err(format!("Unknown field: {}.{}", class_name, field))
                    }
                } else {
                    Err(format!("Unknown class: {}", class_name))
                }
            }

            ExprKind::Lambda { .. } => {
                self.compile_lambda(expr, ctx)
            }

            ExprKind::Match { scrutinee, arms } => {
                self.compile_match(scrutinee, arms, ctx)
            }

            // select-выражение: движок №2 не имеет host-каналов — исполняем
            // тело первой ветки (или default), как и statement-форма.
            ExprKind::SelectExpr { arms, default } => {
                if let Some((var, _chan, body)) = arms.first() {
                    // Каналов в движке №2 нет: связываем переменную с 0.
                    if let Some(name) = var {
                        let idx = ctx.reserve_local();
                        ctx.locals.insert(name.clone(), (idx, valtype::I32));
                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(0);
                        ctx.body.push(op::LOCAL_SET);
                        ctx.body.write_u32(idx);
                    }
                    self.compile_expr(body, ctx)
                } else if let Some(d) = default {
                    self.compile_expr(d, ctx)
                } else {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(0);
                    Ok(())
                }
            }

            // Движок №2 — синхронный WASM без host-рантайма промисов:
            // await компилируется как прозрачное разворачивание значения.
            ExprKind::Await(inner) => {
                self.compile_expr(inner, ctx)
            }

            // Каналы/горутины требуют host-рантайма (движок №1). В движке №2 —
            // честная ошибка с именем конструкции, а не молчаливая заглушка.
            ExprKind::ChannelSend { .. } => {
                Err("Оператор отправки в канал (ch <- v) требует host-рантайма движка №1".to_string())
            }
            ExprKind::ChannelRecv(_) => {
                Err("Приём из канала (<- ch) требует host-рантайма движка №1".to_string())
            }
            ExprKind::AiInfer { .. } | ExprKind::AiAgent { .. }
            | ExprKind::AiAgentCall { .. } | ExprKind::AiGenerate { .. }
            | ExprKind::AiLoad(_) | ExprKind::AiEmbed(_) => {
                Err("AI-примитивы требуют host-рантайма движка №1".to_string())
            }
        }
    }

    /// Бинарные операторы с выбором i32/f64/строкового режима.
    fn compile_binary(
        &mut self,
        op: &BinaryOp,
        left: &Expr,
        right: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let lt = self.static_ty_of(left, ctx);
        let rt = self.static_ty_of(right, ctx);

        // Короткое замыкание логических операторов: правая часть вычисляется
        // только если левая не определяет результат.
        if *op == BinaryOp::And {
            self.compile_expr(left, ctx)?;
            ctx.body.push(op::IF);
            ctx.body.push(valtype::I32);
            self.compile_expr(right, ctx)?;
            ctx.body.push(op::I32_EQZ);
            ctx.body.push(op::I32_EQZ);
            ctx.body.push(op::ELSE);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(0);
            ctx.body.push(op::END);
            return Ok(());
        }
        if *op == BinaryOp::Or {
            self.compile_expr(left, ctx)?;
            ctx.body.push(op::IF);
            ctx.body.push(valtype::I32);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(1);
            ctx.body.push(op::ELSE);
            self.compile_expr(right, ctx)?;
            ctx.body.push(op::I32_EQZ);
            ctx.body.push(op::I32_EQZ);
            ctx.body.push(op::END);
            return Ok(());
        }

        let is_float = lt == StaticTy::Float || rt == StaticTy::Float;
        let is_str = lt == StaticTy::Str || rt == StaticTy::Str;

        // Конкатенация строк: "a" + b (b коэрцится в строку).
        if *op == BinaryOp::Add && is_str {
            self.compile_string_operand(left, ctx)?;
            self.compile_string_operand(right, ctx)?;
            self.emit_helper_call(&mut ctx.body, STR_CONCAT);
            return Ok(());
        }
        // Сравнение строк по содержимому.
        if (*op == BinaryOp::Eq || *op == BinaryOp::NotEq) && is_str {
            self.compile_expr(left, ctx)?;
            self.compile_expr(right, ctx)?;
            self.emit_helper_call(&mut ctx.body, STR_EQ);
            if *op == BinaryOp::NotEq {
                ctx.body.push(op::I32_EQZ);
            }
            return Ok(());
        }

        self.compile_expr(left, ctx)?;
        self.compile_expr(right, ctx)?;

        match (op, is_float) {
            (BinaryOp::Add, true) => ctx.body.push(op::F64_ADD),
            (BinaryOp::Add, false) => ctx.body.push(op::I32_ADD),
            (BinaryOp::Sub, true) => ctx.body.push(op::F64_SUB),
            (BinaryOp::Sub, false) => ctx.body.push(op::I32_SUB),
            (BinaryOp::Mul, true) => ctx.body.push(op::F64_MUL),
            (BinaryOp::Mul, false) => ctx.body.push(op::I32_MUL),
            (BinaryOp::Div, true) => ctx.body.push(op::F64_DIV),
            (BinaryOp::Div, false) => ctx.body.push(op::I32_DIV_S),
            (BinaryOp::Mod, true) => {
                // f64 остаток: a - trunc(a/b)*b (упрощённо через i32-путь).
                ctx.body.push(op::I32_REM_S);
            }
            (BinaryOp::Mod, false) => ctx.body.push(op::I32_REM_S),
            (BinaryOp::Eq, true) => ctx.body.push(op::F64_EQ),
            (BinaryOp::Eq, false) => ctx.body.push(op::I32_EQ),
            (BinaryOp::NotEq, true) => ctx.body.push(op::F64_NE),
            (BinaryOp::NotEq, false) => ctx.body.push(op::I32_NE),
            (BinaryOp::Lt, true) => ctx.body.push(op::F64_LT),
            (BinaryOp::Lt, false) => ctx.body.push(op::I32_LT_S),
            (BinaryOp::Gt, true) => ctx.body.push(op::F64_GT),
            (BinaryOp::Gt, false) => ctx.body.push(op::I32_GT_S),
            (BinaryOp::LtEq, true) => ctx.body.push(op::F64_LE),
            (BinaryOp::LtEq, false) => ctx.body.push(op::I32_LE_S),
            (BinaryOp::GtEq, true) => ctx.body.push(op::F64_GE),
            (BinaryOp::GtEq, false) => ctx.body.push(op::I32_GE_S),
            (BinaryOp::And, _) => ctx.body.push(op::I32_AND),
            (BinaryOp::Or, _) => ctx.body.push(op::I32_OR),
            (BinaryOp::BitAnd, _) => ctx.body.push(op::I32_AND),
            (BinaryOp::BitOr, _) => ctx.body.push(op::I32_OR),
            (BinaryOp::BitXor, _) => ctx.body.push(op::I32_XOR),
            (BinaryOp::Shl, _) => ctx.body.push(op::I32_SHL),
            (BinaryOp::Shr, _) => ctx.body.push(op::I32_SHR_S),
        }
        Ok(())
    }

    /// Компилирует операнд как строку: строки — как есть, числа/булы —
    /// через конвертеры (i32_to_str / f64_to_str).
    fn compile_string_operand(&mut self, expr: &Expr, ctx: &mut FuncContext) -> Result<(), String> {
        let t = self.static_ty_of(expr, ctx);
        self.compile_expr(expr, ctx)?;
        match t {
            StaticTy::Float => {
                self.emit_helper_call(&mut ctx.body, F64_TO_STR);
            }
            StaticTy::Int | StaticTy::Bool | StaticTy::Unknown => {
                self.emit_helper_call(&mut ctx.body, I32_TO_STR);
            }
            StaticTy::Str => {}
            StaticTy::Array | StaticTy::Fn => {
                // Массивы/функции в строку не коэрцятся — оставляем как есть.
            }
        }
        Ok(())
    }

    /// Присваивание в элемент массива `arr[i] = value`.
    fn compile_index_assign(
        &mut self,
        object: &Expr,
        index: &Expr,
        value: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        self.compile_expr(value, ctx)?;
        let val_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(val_local);

        self.compile_expr(object, ctx)?;
        self.compile_expr(index, ctx)?;

        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);

        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        self.emit_i32_store(&mut ctx.body);

        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        Ok(())
    }

    /// Присваивание в поле объекта: `obj.field = value` / `this.x = x`.
    fn compile_field_assign(
        &mut self,
        object: &Expr,
        field: &str,
        value: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let class_name = self.infer_class_name(object, ctx);
        let (offset, field_vt) = if let Some(layout) = self.class_layouts.get(&class_name) {
            let info = layout.fields.iter().find(|f| f.name == field)
                .ok_or_else(|| format!("Unknown field: {}.{}", class_name, field))?;
            (info.offset, info.valtype)
        } else {
            return Err(format!("Unknown class: {}", class_name));
        };

        // value → temp
        self.compile_expr(value, ctx)?;
        let val_local = ctx.reserve_local_ty(field_vt);
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(val_local);

        // addr = obj + offset
        self.compile_expr(object, ctx)?;
        if offset > 0 {
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(offset as i32);
            ctx.body.push(op::I32_ADD);
        }
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        if field_vt == valtype::F64 {
            self.emit_f64_store(&mut ctx.body);
        } else {
            self.emit_i32_store(&mut ctx.body);
        }
        // Значение присваивания — записанное значение.
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        Ok(())
    }

    /// Возвращает true, если выражение оставляет значение на стеке WASM.
    pub(super) fn expr_produces_value(&self, expr: &Expr) -> bool {
        if let ExprKind::Call { callee, .. } = &expr.kind {
            if let ExprKind::Identifier(name) = &callee.kind {
                if name == "print" {
                    return false;
                }
                if name == "assert" || name == "assert_eq" {
                    return false;
                }
                // Примитивы записи в память не оставляют значения на стеке.
                if name == "store8" || name == "store32" || name == "memcopy" {
                    return false;
                }
                if self.void_functions.contains(name) {
                    return false;
                }
            }
        }
        true
    }

    /// Best-effort статический тип выражения (для выбора WASM-инструкций).
    pub(super) fn static_ty_of(&self, expr: &Expr, ctx: &FuncContext) -> StaticTy {
        match &expr.kind {
            ExprKind::Number(n) => {
                if n.fract() == 0.0 { StaticTy::Int } else { StaticTy::Float }
            }
            ExprKind::Bool(_) => StaticTy::Bool,
            ExprKind::String(_) => StaticTy::Str,
            ExprKind::Array(_) => StaticTy::Array,
            ExprKind::Lambda { .. } => StaticTy::Fn,
            ExprKind::Null => StaticTy::Int,
            ExprKind::Identifier(name) => {
                if let Some((idx, _)) = ctx.locals.get(name) {
                    match ctx.static_of(*idx) {
                        StaticTy::Float => StaticTy::Float,
                        StaticTy::Str => StaticTy::Str,
                        StaticTy::Array => StaticTy::Array,
                        StaticTy::Bool => StaticTy::Bool,
                        StaticTy::Fn => StaticTy::Fn,
                        _ => StaticTy::Int,
                    }
                } else if let Some((_, type_idx)) = self.functions.get(name) {
                    let _ = type_idx;
                    StaticTy::Fn
                } else {
                    StaticTy::Unknown
                }
            }
            ExprKind::Binary { op, left, right } => match op {
                BinaryOp::Eq | BinaryOp::NotEq | BinaryOp::Lt | BinaryOp::Gt
                | BinaryOp::LtEq | BinaryOp::GtEq | BinaryOp::And | BinaryOp::Or => StaticTy::Bool,
                BinaryOp::Add => {
                    let l = self.static_ty_of(left, ctx);
                    let r = self.static_ty_of(right, ctx);
                    if l == StaticTy::Str || r == StaticTy::Str {
                        StaticTy::Str
                    } else if l == StaticTy::Float || r == StaticTy::Float {
                        StaticTy::Float
                    } else {
                        StaticTy::Int
                    }
                }
                _ => {
                    if self.static_ty_of(left, ctx) == StaticTy::Float
                        || self.static_ty_of(right, ctx) == StaticTy::Float
                    {
                        StaticTy::Float
                    } else {
                        StaticTy::Int
                    }
                }
            },
            ExprKind::Unary { op, operand } => match op {
                UnaryOp::Not => StaticTy::Bool,
                UnaryOp::Neg => self.static_ty_of(operand, ctx),
            },
            ExprKind::Field { object, field } => {
                if field == "length" {
                    StaticTy::Int
                } else {
                    let _ = object;
                    StaticTy::Unknown
                }
            }
            ExprKind::Index { object, .. } => {
                if self.static_ty_of(object, ctx) == StaticTy::Str {
                    StaticTy::Int
                } else {
                    StaticTy::Unknown
                }
            }
            ExprKind::Call { callee, .. } => {
                if let ExprKind::Identifier(name) = &callee.kind {
                    match name.as_str() {
                        "str" => StaticTy::Str,
                        "len" | "int" => StaticTy::Int,
                        "float" => StaticTy::Float,
                        _ => self.fn_return_static.get(name).copied().unwrap_or(StaticTy::Int),
                    }
                } else {
                    StaticTy::Unknown
                }
            }
            ExprKind::ChannelRecv(_) => StaticTy::Unknown,
            ExprKind::Await(e) => self.static_ty_of(e, ctx),
            ExprKind::Match { arms, .. } => arms.first()
                .map(|a| self.static_ty_of(&a.body, ctx))
                .unwrap_or(StaticTy::Unknown),
            _ => StaticTy::Unknown,
        }
    }

    /// Помощник: статический тип по аннотации AST-типа.
    #[allow(dead_code)]
    pub(super) fn ann_static_ty(ty: &crate::ast::Type) -> StaticTy {
        crate::codegen::context::ast_to_static(ty)
    }

    #[allow(dead_code)]
    pub(super) fn is_float_expr(&self, expr: &Expr) -> bool {
        matches!(&expr.kind, ExprKind::Number(n) if n.fract() != 0.0)
    }

    /// Best-effort имя класса выражения (для доступа к полям/методам).
    /// `this` внутри метода класса и переменные, объявленные как `new Class`.
    pub(super) fn infer_class_name(&self, expr: &Expr, ctx: &FuncContext) -> String {
        if let ExprKind::Identifier(name) = &expr.kind {
            // this / параметр-объект.
            if let Some((idx, _)) = ctx.locals.get(name) {
                if let Some(c) = ctx.class_of(*idx) {
                    return c;
                }
                if name == "this" {
                    // this без класса — берём первый класс (эвристика совместимости).
                    if let Some((k, _)) = self.class_layouts.iter().next() {
                        return k.clone();
                    }
                }
            }
            // let p = new Point(...) — имя "p" могло быть объявлено ранее;
            // хранится в ctx.local_class.
        }
        // Специальный маркер `new Class`.
        if let ExprKind::Identifier(name) = &expr.kind {
            if let Some(rest) = name.strip_prefix("new ") {
                return rest.to_string();
            }
        }
        String::new()
    }
}