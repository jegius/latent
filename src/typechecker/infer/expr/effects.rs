//! Вывод типов для host-эффектов: async/await, AI-примитивы, каналы, select.
//!
//! Движок №2 не исполняет эти конструкции, но typechecker обязан принимать
//! их без паники и с предсказуемыми типами (иначе golden-контракт ломается).

use super::super::super::checker::TypeChecker;
use super::super::super::types::{Type, TypeError};
use crate::ast::*;

impl TypeChecker {
    /// Типизация выражения, требующего host-рантайма.
    pub(super) fn infer_effect_expr(&mut self, expr: &Expr) -> Result<Type, TypeError> {
        match &expr.kind {
            ExprKind::AiLoad(_model_name) => {
                Ok(Type::Generic("Model".to_string(), vec![Type::String]))
            }

            ExprKind::AiInfer { model, input } => {
                let t_model = self.infer_expr(model)?;
                let t_input = self.infer_expr(input)?;
                self.unify(&t_input, &Type::String, input.pos)?;

                match self.apply(&t_model) {
                    Type::Generic(name, args) if name == "Model" && args.len() == 1 => {
                        Ok(args[0].clone())
                    }
                    other => Err(TypeError::NotAFunction {
                        ty: other,
                        pos: model.pos,
                    }),
                }
            }

            ExprKind::AiEmbed(expr) => {
                let t = self.infer_expr(expr)?;
                self.unify(&t, &Type::String, expr.pos)?;
                Ok(Type::Generic("Embedding".to_string(), vec![Type::Int]))
            }

            ExprKind::ChannelSend { .. } | ExprKind::ChannelRecv(_) => {
                Ok(Type::Unit)
            }

            ExprKind::SelectExpr { arms, default } => {
                for (var, ch, body) in arms {
                    let _ = self.infer_expr(ch)?;
                    self.env.enter_scope();
                    if let Some(v) = var {
                        let t = self.fresh_var();
                        self.env.bind(v, t);
                    }
                    self.infer_expr(body)?;
                    self.env.exit_scope();
                }
                if let Some(d) = default {
                    self.infer_expr(d)?;
                }
                Ok(self.fresh_var())
            }

            ExprKind::Await(expr) => {
                let t = self.infer_expr(expr)?;
                match self.apply(&t) {
                    Type::Generic(name, args) if name == "Promise" && args.len() == 1 => {
                        Ok(args[0].clone())
                    }
                    other => Err(TypeError::TypeMismatch {
                        expected: Type::Generic("Promise".to_string(), vec![self.fresh_var()]),
                        found: other,
                        pos: expr.pos,
                    }),
                }
            }

            ExprKind::AiAgent { .. } | ExprKind::AiAgentCall { .. } | ExprKind::AiGenerate { .. } => {
                // AI-примитивы, требующие host-рантайма: принимаем без строгой
                // типизации (движок №2 их не исполняет).
                Ok(Type::String)
            }

            // Все остальные варианты обрабатываются в диспетчере.
            _ => Ok(self.fresh_var()),
        }
    }
}
