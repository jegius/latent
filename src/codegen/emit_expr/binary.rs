//! Бинарные операторы и строковая коэрция операндов.

use super::super::bytecode::{op, valtype};
use super::super::context::{FuncContext, StaticTy};
use super::super::module_builder::WasmCodegen;
use super::super::runtime_helpers::{F64_TO_STR, I32_TO_STR, STR_CMP, STR_CONCAT, STR_EQ};
use crate::ast::*;

impl WasmCodegen {
    /// Бинарные операторы с выбором i32/f64/строкового режима.
    pub(super) fn compile_binary(
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
        // Лексикографическое сравнение строк (L03): не указатели, а байты.
        if matches!(*op, BinaryOp::Lt | BinaryOp::Gt | BinaryOp::LtEq | BinaryOp::GtEq)
            && is_str
        {
            self.compile_expr(left, ctx)?;
            self.compile_expr(right, ctx)?;
            self.emit_helper_call(&mut ctx.body, STR_CMP);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(0);
            ctx.body.push(match op {
                BinaryOp::Lt => op::I32_LT_S,
                BinaryOp::Gt => op::I32_GT_S,
                BinaryOp::LtEq => op::I32_LE_S,
                _ => op::I32_GE_S,
            });
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
}
