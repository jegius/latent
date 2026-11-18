//! Вывод типов: выражения (диспетчер и базовые формы).
//!
//! Декомпозиция по зонам ответственности:
//! * [`call`] — вызовы функций/методов и типы встроенных;
//! * [`effects`] — host-эффекты: async/await, AI-примитивы, каналы, select.

use super::super::checker::TypeChecker;
use super::super::types::{Type, TypeError};
use crate::ast::*;

mod call;
mod effects;

impl TypeChecker {
    /// Вывод типов для выражений
    pub fn infer_expr(&mut self, expr: &Expr) -> Result<Type, TypeError> {
        let pos = expr.pos;
        match &expr.kind {
            ExprKind::Number(_) => Ok(Type::Float),
            ExprKind::String(_) => Ok(Type::String),
            ExprKind::Bool(_) => Ok(Type::Bool),
            ExprKind::Null => Ok(Type::Null),

            ExprKind::Identifier(name) => {
                let ty = self.env.lookup(name).cloned();
                match ty {
                    Some(ty) => Ok(self.instantiate(&ty)),
                    None => Err(TypeError::UndefinedVariable {
                        name: name.clone(),
                        pos,
                    }),
                }
            }

            ExprKind::Binary { op, left, right } => {
                let t_left_raw = self.infer_expr(left)?;
                let t_left = self.apply(&t_left_raw);
                let t_right_raw = self.infer_expr(right)?;
                let t_right = self.apply(&t_right_raw);

                match op {
                    BinaryOp::Add => {
                        // Конкатенация строк: если хотя бы одна сторона — строка,
                        // результатом также строка (числа коэрцятся в кодегене).
                        if matches!(t_left, Type::String) || matches!(t_right, Type::String) {
                            return Ok(Type::String);
                        }
                        // Иначе — числовое сложение (int/float взаимозаменяемы).
                        Ok(Type::Float)
                    }
                    BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div | BinaryOp::Mod => {
                        let _ = (t_left, t_right);
                        Ok(Type::Float)
                    }
                    BinaryOp::Eq | BinaryOp::NotEq => {
                        let _ = (t_left, t_right);
                        Ok(Type::Bool)
                    }
                    BinaryOp::Lt | BinaryOp::Gt | BinaryOp::LtEq | BinaryOp::GtEq => {
                        Ok(Type::Bool)
                    }
                    BinaryOp::And | BinaryOp::Or => {
                        Ok(Type::Bool)
                    }
                    // Побитовые и сдвиговые операции дают целое.
                    BinaryOp::BitAnd | BinaryOp::BitOr | BinaryOp::BitXor
                    | BinaryOp::Shl | BinaryOp::Shr => Ok(Type::Int),
                }
            }

            ExprKind::Unary { op, operand } => {
                let t = self.infer_expr(operand)?;
                match op {
                    // Арифметическое отрицание: применяется к числам, но в
                    // динамическом стиле допускаем любой скаляр.
                    UnaryOp::Neg => { let _ = t; Ok(Type::Float) }
                    // Логическое НЕ: допускаем числа (truthiness), возвращаем bool.
                    UnaryOp::Not => { let _ = t; Ok(Type::Bool) }
                }
            }

            ExprKind::Assign { target, value } => {
                // Динамический стиль: для присваивания в элемент массива не
                // навязываем гомогенность элементов (массивы как словари).
                if matches!(target.kind, ExprKind::Index { .. }) {
                    self.infer_expr(target)?;
                    return self.infer_expr(value);
                }
                let t_target = self.infer_expr(target)?;
                let t_value = self.infer_expr(value)?;
                self.unify(&t_target, &t_value, pos)?;
                Ok(t_target)
            }

            ExprKind::Call { callee, args } => {
                self.infer_call(callee, args, pos)
            }

            ExprKind::Array(elements) => {
                // Динамический стиль: элементы могут быть разнотипными
                // (в т.ч. вложенные массивы) — не навязываем гомогенность.
                for elem in elements {
                    self.infer_expr(elem)?;
                }
                Ok(Type::Array(Box::new(self.fresh_var())))
            }

            ExprKind::Lambda { params, body, block, .. } => {
                let param_types: Vec<Type> = params.iter().map(|_| self.fresh_var()).collect();
                let ret_type = self.fresh_var();

                self.env.enter_scope();
                for (param, ty) in params.iter().zip(param_types.iter()) {
                    self.env.bind(&param.name, ty.clone());
                    if let Some(ann) = &param.ty {
                        let t_ann = self.parse_type_annotation(ann)?;
                        self.unify(ty, &t_ann, pos)?;
                    }
                }

                if let Some(stmts) = block {
                    // Блочное тело: тип — тип последнего return/инструкции.
                    let mut last = self.fresh_var();
                    for s in stmts {
                        last = self.infer_stmt(s)?;
                        if let crate::ast::StmtKind::Return(Some(e)) = &s.kind {
                            last = self.infer_expr(e)?;
                        }
                    }
                    self.unify(&ret_type, &last, pos)?;
                } else {
                    let t_body = self.infer_expr(body)?;
                    self.unify(&ret_type, &t_body, body.pos)?;
                }

                self.env.exit_scope();

                Ok(Type::Fn(param_types, Box::new(ret_type)))
            }

            ExprKind::Index { object, index } => {
                let t_obj = self.infer_expr(object)?;
                let t_index = self.infer_expr(index)?;
                self.unify(&t_index, &Type::Float, index.pos)?;

                // Индексация строки возвращает байт-символ (int).
                match self.apply(&t_obj) {
                    Type::String => Ok(Type::Int),
                    Type::Array(elem) => Ok(*elem),
                    // Неизвестный тип объекта: динамический стиль — не
                    // навязываем Array (иначе строка-аргумент конфликтовала бы).
                    _ => Ok(self.fresh_var()),
                }
            }

            ExprKind::Field { object, field } => self.infer_field(object, field, pos),

            ExprKind::Match { scrutinee, arms } => {
                let t_scrut = self.infer_expr(scrutinee)?;
                let result_type = self.fresh_var();

                for arm in arms {
                    let t_pat = self.infer_pattern(&arm.pattern, &t_scrut)?;
                    self.unify(&t_scrut, &t_pat, pos)?;

                    let t_body = self.infer_expr(&arm.body)?;
                    self.unify(&result_type, &t_body, arm.body.pos)?;
                }

                Ok(result_type)
            }

            // Host-эффекты вынесены в отдельный модуль.
            ExprKind::AiLoad(_)
            | ExprKind::AiInfer { .. }
            | ExprKind::AiEmbed(_)
            | ExprKind::AiAgent { .. }
            | ExprKind::AiAgentCall { .. }
            | ExprKind::AiGenerate { .. }
            | ExprKind::ChannelSend { .. }
            | ExprKind::ChannelRecv(_)
            | ExprKind::SelectExpr { .. }
            | ExprKind::Await(_) => self.infer_effect_expr(expr),
        }
    }

    /// Доступ к полю: `.length`-подобные — свежая переменная, у `Point`
    /// известны поля `x`/`y` (историческая эвристика typechecker'а).
    fn infer_field(&mut self, object: &Expr, field: &str, pos: crate::lexer::Position) -> Result<Type, TypeError> {
        let t_obj = self.infer_expr(object)?;
        // Для простоты: field access возвращает тип поля, если известен
        // В полной реализации здесь будет record typing
        match self.apply(&t_obj) {
            Type::Generic(name, _) if name == "Point" => {
                // Для класса Point возвращаем тип поля
                match field {
                    "x" | "y" => Ok(Type::Float),
                    _ => Err(TypeError::UndefinedVariable {
                        name: field.to_string(),
                        pos,
                    }),
                }
            }
            _ => {
                // Для других типов — свежая переменная
                Ok(self.fresh_var())
            }
        }
    }
}
