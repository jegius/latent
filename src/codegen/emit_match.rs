//! Кодогенерация match-выражения как цепочки вложенных IF/ELSE.

use super::bytecode::{op, valtype};
use super::context::FuncContext;
use super::module_builder::WasmCodegen;
use super::runtime_helpers::STR_EQ;
use crate::ast::*;

impl WasmCodegen {
    /// Компилирует match-выражение как цепочку вложенных IF/ELSE, оставляя
    /// одно значение (i32/f64) на стеке.
    pub(super) fn compile_match(
        &mut self,
        scrutinee: &Expr,
        arms: &[MatchArm],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        self.compile_expr(scrutinee, ctx)?;

        let scrut_ty = if self.static_ty_of(scrutinee, ctx) == super::context::StaticTy::Float {
            valtype::F64
        } else {
            valtype::I32
        };
        let scrut_local = ctx.reserve_local_ty(scrut_ty);
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(scrut_local);

        self.emit_match_arms(arms, scrut_local, scrut_ty, ctx)
    }

    fn emit_match_arms(
        &mut self,
        arms: &[MatchArm],
        scrut_local: u32,
        scrut_ty: u8,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        if arms.is_empty() {
            if scrut_ty == valtype::F64 {
                ctx.body.push(op::F64_CONST);
                ctx.body.extend(&0f64.to_le_bytes());
            } else {
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(0);
            }
            return Ok(());
        }

        let arm = &arms[0];
        let rest = &arms[1..];

        match &arm.pattern {
            Pattern::Wildcard => {
                self.compile_expr(&arm.body, ctx)
            }
            Pattern::Identifier(name) => {
                ctx.body.push(op::LOCAL_GET);
                ctx.body.write_u32(scrut_local);
                let idx = ctx.reserve_local_ty(scrut_ty);
                ctx.locals.insert(name.clone(), (idx, scrut_ty));
                ctx.body.push(op::LOCAL_SET);
                ctx.body.write_u32(idx);
                self.compile_expr(&arm.body, ctx)
            }
            Pattern::Literal(lit) => {
                match lit {
                    ExprKind::Number(n) => {
                        ctx.body.push(op::LOCAL_GET);
                        ctx.body.write_u32(scrut_local);
                        if scrut_ty == valtype::F64 {
                            ctx.body.push(op::F64_CONST);
                            ctx.body.extend(&n.to_le_bytes());
                            ctx.body.push(op::F64_EQ);
                        } else {
                            ctx.body.push(op::I32_CONST);
                            ctx.body.write_i32(*n as i32);
                            ctx.body.push(op::I32_EQ);
                        }
                    }
                    ExprKind::Bool(b) => {
                        ctx.body.push(op::LOCAL_GET);
                        ctx.body.write_u32(scrut_local);
                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(if *b { 1 } else { 0 });
                        ctx.body.push(op::I32_EQ);
                    }
                    ExprKind::String(s) => {
                        // Сравнение по содержимому через рантайм-хелпер.
                        ctx.body.push(op::LOCAL_GET);
                        ctx.body.write_u32(scrut_local);
                        let addr = self.add_string(s);
                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(addr as i32);
                        self.emit_helper_call(&mut ctx.body, STR_EQ);
                    }
                    _ => {
                        return Err("Unsupported literal pattern in match codegen".to_string());
                    }
                }

                ctx.body.push(op::IF);
                ctx.body.push(valtype::I32);
                self.compile_expr(&arm.body, ctx)?;
                ctx.body.push(op::ELSE);
                self.emit_match_arms(rest, scrut_local, scrut_ty, ctx)?;
                ctx.body.push(op::END);
                Ok(())
            }
            Pattern::Constructor(name, subpats) => {
                // Условие: tag(scrut) == tag(variant)
                self.emit_constructor_test(name, subpats, scrut_local, ctx)?;
                ctx.body.push(op::IF);
                ctx.body.push(valtype::I32);
                // THEN: связываем поля и выполняем тело.
                self.bind_constructor_fields(subpats, scrut_local, ctx)?;
                self.compile_expr(&arm.body, ctx)?;
                ctx.body.push(op::ELSE);
                self.emit_match_arms(rest, scrut_local, scrut_ty, ctx)?;
                ctx.body.push(op::END);
                Ok(())
            }
        }
    }
}