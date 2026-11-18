//! Кодогенерация вызовов (функции, конструкторы классов/enum, методы, массивы).
//!
//! Декомпозиция по зонам ответственности:
//! * [`constructors`] — `new Class(...)`;
//! * [`direct`] — прямые вызовы функций и встроенных;
//! * [`method`] — методы объектов и операции над массивами;
//! * [`array`] — литерал массива в линейной памяти.

use super::context::FuncContext;
use super::module_builder::WasmCodegen;
use crate::ast::*;

mod array;
mod constructors;
mod direct;
mod method;

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
                if *vty == super::bytecode::valtype::I32 {
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
}
