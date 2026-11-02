//! Кодогенерация выражений: диспетчер и простые (скалярные) выражения.
//!
//! Декомпозиция по зонам ответственности:
//! * [`binary`] — бинарные операторы и строковая коэрция;
//! * [`access`] — индексация, поля и присваивания;
//! * [`ty`] — best-effort статические типы и имя класса выражения.

use super::bytecode::op;
use super::context::FuncContext;
use super::module_builder::WasmCodegen;
use crate::ast::*;

mod access;
mod binary;
mod ty;

impl WasmCodegen {
    /// Компилирует выражение, оставляя его значение на стеке WASM.
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

            ExprKind::Identifier(name) => self.compile_identifier(name, ctx),

            ExprKind::Unary { op, operand } => self.compile_unary(op, operand, ctx),

            ExprKind::Binary { op, left, right } => self.compile_binary(op, left, right, ctx),

            ExprKind::Assign { target, value } => self.compile_assign(target, value, ctx),

            ExprKind::Call { callee, args } => self.compile_call(callee, args, ctx),

            ExprKind::Array(elements) => self.compile_array(elements, ctx),

            ExprKind::Index { object, index } => self.compile_index(object, index, ctx),

            ExprKind::Field { object, field } => self.compile_field(object, field, ctx),

            ExprKind::Lambda { .. } => self.compile_lambda(expr, ctx),

            ExprKind::Match { scrutinee, arms } => self.compile_match(scrutinee, arms, ctx),

            // select-выражение: движок №2 не имеет host-каналов — исполняем
            // тело первой ветки (или default), как и statement-форма.
            ExprKind::SelectExpr { arms, default } => {
                if let Some((var, _chan, body)) = arms.first() {
                    // Каналов в движке №2 нет: связываем переменную с 0.
                    if let Some(name) = var {
                        let idx = ctx.reserve_local();
                        ctx.locals.insert(name.clone(), (idx, super::bytecode::valtype::I32));
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
            ExprKind::Await(inner) => self.compile_expr(inner, ctx),

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

    /// Идентификатор: локальная переменная, 0-арный вариант enum или ошибка.
    fn compile_identifier(&mut self, name: &str, ctx: &mut FuncContext) -> Result<(), String> {
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

    /// Унарные операторы: `-` (int/f64) и `!`.
    fn compile_unary(
        &mut self,
        op: &UnaryOp,
        operand: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let is_float = self.static_ty_of(operand, ctx) == super::context::StaticTy::Float;
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
}
