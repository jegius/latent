//! Кодогенерация вызовов (функции, конструкторы классов/enum, методы, массивы).

use super::bytecode::{op, valtype};
use super::context::{FuncContext, StaticTy};
use super::module_builder::WasmCodegen;
use super::runtime_helpers::{ALLOC, F64_TO_STR, I32_TO_STR, STR_TO_I32};
use crate::ast::*;

/// Встроенные, требующие host-рантайма: движок №2 даёт по ним понятную ошибку.
const HOST_BUILTINS: &[&str] = &[
    "tensor", "semantic", "matmul", "cosine_similarity", "dot", "magnitude",
    "zeros", "ones", "snapshot", "ai_contract", "enforce_contract",
    "ai_infer", "ai_embed", "ai_stream", "stream_next",
    "channel",
];

impl WasmCodegen {
    pub(super) fn compile_call(
        &mut self,
        callee: &Expr,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        // Конструктор класса: `new Class(...)`
        if let ExprKind::Identifier(name) = &callee.kind {
            if name.starts_with("new ") {
                if let Some(result) = self.try_compile_new(name, args, ctx)? {
                    return Ok(result);
                }
            }
        }

        // Конструктор enum-варианта: `Ok(v)`, `Some(x)`, `None`.
        if let ExprKind::Identifier(name) = &callee.kind {
            if !self.functions.contains_key(name) && self.enum_variant(name).is_some() {
                return self.compile_variant(name, args, ctx);
            }
        }

        // Прямой вызов именованной функции / встроенной.
        if let ExprKind::Identifier(name) = &callee.kind {
            // Локальная переменная-функция → косвенный вызов через closure.
            if let Some((_, vty)) = ctx.locals.get(name) {
                if *vty == valtype::I32 {
                    return self.compile_indirect_call(callee, args, ctx);
                }
            }
            return self.compile_direct_call(name, args, ctx);
        }

        // Метод-вызовы obj.method(args)
        if let ExprKind::Field { object, field } = &callee.kind {
            return self.compile_method_call(object, field, args, ctx);
        }

        // Всё остальное (выражение-функция) — косвенный вызов.
        self.compile_indirect_call(callee, args, ctx)
    }

    /// Компилирует `new Class(args)`; возвращает `Some(Ok(()))`, если класс найден.
    fn try_compile_new(
        &mut self,
        name: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<Option<()>, String> {
        let class_name = name[4..].to_string();

        if let Some(layout) = self.class_layouts.get(&class_name) {
            let temp = ctx.reserve_local();

            ctx.body.push(op::GLOBAL_GET);
            ctx.body.write_u32(self.heap_global_idx);
            ctx.body.push(op::LOCAL_TEE);
            ctx.body.write_u32(temp);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(layout.size as i32);
            ctx.body.push(op::I32_ADD);
            ctx.body.push(op::GLOBAL_SET);
            ctx.body.write_u32(self.heap_global_idx);

            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(temp);

            for arg in args {
                self.compile_expr(arg, ctx)?;
            }

            let ctor_name = format!("{}_init", class_name);
            let ctor = self.functions.get(&ctor_name)
                .or_else(|| self.functions.get(&format!("{}_new", class_name)))
                .cloned();
            if let Some((func_idx, _)) = ctor {
                ctx.body.push(op::CALL);
                ctx.body.write_u32(func_idx);
                // Если конструктор не void — снимаем его результат со стека.
                if !self.void_functions.contains(&ctor_name)
                    && !self.void_functions.contains(&format!("{}_new", class_name)) {
                    ctx.body.push(op::DROP);
                }
            }

            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(temp);

            return Ok(Some(()));
        }
        Ok(None)
    }

    /// Вызов по имени: встроенные и пользовательские функции.
    fn compile_direct_call(
        &mut self,
        name: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        if name == "print" {
            for arg in args {
                // Не-строковые аргументы конвертируем в строку, чтобы
                // `print(42)` и `print(arr.length)` печатали число, а не
                // интерпретировали его как указатель.
                let t = self.static_ty_of(arg, ctx);
                self.compile_expr(arg, ctx)?;
                match t {
                    StaticTy::Str => {}
                    StaticTy::Float => self.emit_helper_call(&mut ctx.body, F64_TO_STR),
                    _ => self.emit_helper_call(&mut ctx.body, I32_TO_STR),
                }
                ctx.body.push(op::CALL);
                ctx.body.write_u32(self.print_func_idx);
            }
            return Ok(());
        }
        if name == "len" {
            // len(arr|str) → длина из заголовка (общее представление).
            if let Some(a) = args.first() {
                self.compile_expr(a, ctx)?;
            } else {
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(0);
            }
            self.emit_i32_load(&mut ctx.body);
            return Ok(());
        }
        if name == "push" {
            // push(arr, x) — функциональная форма метода arr.push(x).
            if args.len() >= 2 {
                return self.compile_push(&args[0], &args[1..], ctx);
            }
            return Err("push expects (array, value)".to_string());
        }
        if name == "str" {
            // str(x): строку оставляем, число конвертируем.
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                match t {
                    StaticTy::Float => self.emit_helper_call(&mut ctx.body, F64_TO_STR),
                    StaticTy::Str => {}
                    _ => self.emit_helper_call(&mut ctx.body, I32_TO_STR),
                }
            } else {
                let addr = self.add_string("");
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(addr as i32);
            }
            return Ok(());
        }
        if name == "int" {
            // int(x): строку парсим, float усекаем, int как есть.
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                match t {
                    StaticTy::Str => self.emit_helper_call(&mut ctx.body, STR_TO_I32),
                    StaticTy::Float => ctx.body.push(op::I32_TRUNC_F64_S),
                    _ => {}
                }
            } else {
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(0);
            }
            return Ok(());
        }
        if name == "float" {
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                match t {
                    StaticTy::Float => {}
                    StaticTy::Str => {
                        self.emit_helper_call(&mut ctx.body, STR_TO_I32);
                        ctx.body.push(op::F64_CONVERT_I32_S);
                    }
                    _ => ctx.body.push(op::F64_CONVERT_I32_S),
                }
            } else {
                ctx.body.push(op::F64_CONST);
                ctx.body.extend(&0f64.to_le_bytes());
            }
            return Ok(());
        }
        if name == "sqrt" {
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                if t != StaticTy::Float {
                    ctx.body.push(op::F64_CONVERT_I32_S);
                }
                ctx.body.push(op::F64_SQRT);
            }
            return Ok(());
        }
        if name == "assert" {
            if let Some(a) = args.first() {
                self.compile_expr(a, ctx)?;
                ctx.body.push(op::I32_EQZ);
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::UNREACHABLE);
                ctx.body.push(op::END);
            }
            return Ok(());
        }
        if name == "assert_eq" {
            if args.len() >= 2 {
                self.compile_expr(&args[0], ctx)?;
                self.compile_expr(&args[1], ctx)?;
                ctx.body.push(op::I32_EQ);
                ctx.body.push(op::I32_EQZ);
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::UNREACHABLE);
                ctx.body.push(op::END);
            }
            return Ok(());
        }
        if HOST_BUILTINS.contains(&name) {
            return Err(format!(
                "Builtin '{}' не поддерживается движком №2 (требует host-рантайма)",
                name
            ));
        }
        for arg in args {
            self.compile_expr(arg, ctx)?;
        }
        if let Some((func_idx, _)) = self.functions.get(name).cloned() {
            ctx.body.push(op::CALL);
            ctx.body.write_u32(func_idx);
            Ok(())
        } else {
            Err(format!("Unknown function: {}", name))
        }
    }

    /// Метод-вызовы (arr.push/pop, строковые). Порядок: сначала объект.
    fn compile_method_call(
        &mut self,
        object: &Expr,
        field: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        // Метод класса: `obj.method(args)` → `Class_method(obj, args)`.
        let class_name = self.infer_class_name(object, ctx);
        if !class_name.is_empty() {
            let mangled = format!("{}_{}", class_name, field);
            if let Some((func_idx, _)) = self.functions.get(&mangled).cloned() {
                self.compile_expr(object, ctx)?;
                for a in args {
                    self.compile_expr(a, ctx)?;
                }
                ctx.body.push(op::CALL);
                ctx.body.write_u32(func_idx);
                return Ok(());
            }
        }
        match field {
            "push" => self.compile_push(object, args, ctx),
            "pop" => self.compile_pop(object, ctx),
            // Строковые методы.
            "to_str" | "toString" => {
                let t = self.static_ty_of(object, ctx);
                self.compile_expr(object, ctx)?;
                match t {
                    StaticTy::Float => self.emit_helper_call(&mut ctx.body, F64_TO_STR),
                    StaticTy::Str => {}
                    _ => self.emit_helper_call(&mut ctx.body, I32_TO_STR),
                }
                Ok(())
            }
            "to_int" | "toInt" => {
                let t = self.static_ty_of(object, ctx);
                self.compile_expr(object, ctx)?;
                match t {
                    StaticTy::Str => self.emit_helper_call(&mut ctx.body, STR_TO_I32),
                    StaticTy::Float => ctx.body.push(op::I32_TRUNC_F64_S),
                    _ => {}
                }
                Ok(())
            }
            // .length уже обработан в Field. Для совместимости с `arr.length()`:
            "length" => {
                self.compile_expr(object, ctx)?;
                self.emit_i32_load(&mut ctx.body);
                Ok(())
            }
            _ => Err(format!(
                "Метод '{}' не поддерживается движком №2 (требует host-рантайма)",
                field
            )),
        }
    }

    /// arr.push(x): arr[len]=x; arr.length = len+1; результат — arr.
    fn compile_push(
        &mut self,
        object: &Expr,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        self.compile_expr(object, ctx)?;
        let arr_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(arr_local);
        for a in args { self.compile_expr(a, ctx)?; }
        let val_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(val_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(val_local);
        self.emit_i32_store(&mut ctx.body);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(1);
        ctx.body.push(op::I32_ADD);
        self.emit_i32_store(&mut ctx.body);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        Ok(())
    }

    /// arr.pop(): len--; результат arr[len].
    fn compile_pop(&mut self, object: &Expr, ctx: &mut FuncContext) -> Result<(), String> {
        self.compile_expr(object, ctx)?;
        let arr_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(1);
        ctx.body.push(op::I32_SUB);
        self.emit_i32_store(&mut ctx.body);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        self.emit_i32_load(&mut ctx.body);
        Ok(())
    }

    /// Литерал массива в линейной памяти: [len][elem0][elem1]...
    pub(super) fn compile_array(
        &mut self,
        elements: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let elem_size = 4;
        let header_size = 4;
        let total_size = header_size + elements.len() as u32 * elem_size;

        let temp_local = ctx.reserve_local();

        // Выделяем через рантайм-аллокатор (растёт при необходимости).
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(total_size as i32);
        self.emit_helper_call(&mut ctx.body, ALLOC);
        ctx.body.push(op::LOCAL_TEE);
        ctx.body.write_u32(temp_local);

        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(elements.len() as i32);
        self.emit_i32_store(&mut ctx.body);

        for (i, elem) in elements.iter().enumerate() {
            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(temp_local);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32((header_size + i as u32 * elem_size) as i32);
            ctx.body.push(op::I32_ADD);
            self.compile_expr(elem, ctx)?;
            self.emit_i32_store(&mut ctx.body);
        }

        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(temp_local);
        Ok(())
    }
}