//! Best-effort статические типы выражений и локальных переменных.
//!
//! ВАЖНО: эти функции влияют на выбор WASM-инструкций (i32 vs f64), но не
//! используют результаты typechecker'а. Любое изменение здесь меняет байты
//! генерируемого модуля — такие правки несовместимы с golden-набором.

use super::super::context::{FuncContext, StaticTy};
use super::super::module_builder::WasmCodegen;
use crate::ast::*;

impl WasmCodegen {
    /// Возвращает true, если выражение оставляет значение на стеке WASM.
    pub(in crate::codegen) fn expr_produces_value(&self, expr: &Expr) -> bool {
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
    pub(in crate::codegen) fn static_ty_of(&self, expr: &Expr, ctx: &FuncContext) -> StaticTy {
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

    /// Best-effort имя класса выражения (для доступа к полям/методам).
    /// `this` внутри метода класса и переменные, объявленные как `new Class`.
    pub(in crate::codegen) fn infer_class_name(&self, expr: &Expr, ctx: &FuncContext) -> String {
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
