//! Вывод типов: выражения.

use super::super::checker::TypeChecker;
use crate::lexer::Position;
use super::super::types::{Type, TypeError};
use crate::ast::*;

/// Встроенные функции с переменным числом аргументов. Для них пропускаем
/// проверку арности, но проверяем каждый аргумент (§8).
const VARIADIC_BUILTINS: &[&str] = &[
    "print", "assert", "ai_infer", "ai_embed", "ai_stream", "stream_next",
    "tensor", "semantic", "matmul", "cosine_similarity", "dot", "magnitude",
    "zeros", "ones", "snapshot", "ai_contract", "enforce_contract", "assert_eq",
    "len", "push", "str", "int", "float", "sqrt",
    "alloc", "load8", "store8", "load32", "store32", "memcopy",
];

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

            ExprKind::Field { object, field } => {
                let t_obj = self.infer_expr(object)?;
                // Для простоты: field access возвращает тип поля, если известен
                // В полной реализации здесь будет record typing
                match self.apply(&t_obj) {
                    Type::Generic(name, _) if name == "Point" => {
                        // Для класса Point возвращаем тип поля
                        match field.as_str() {
                            "x" | "y" => Ok(Type::Float),
                            _ => Err(TypeError::UndefinedVariable {
                                name: field.clone(),
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
        }
    }

    /// Типизирует вызов: методы встроенных типов, вариативные встроенные и
    /// обычные функции.
    fn infer_call(
        &mut self,
        callee: &Expr,
        args: &[Expr],
        pos: Position,
    ) -> Result<Type, TypeError> {
        // Метод-вызовы на встроенных типах: ch.send(v), ch.recv() и т.п.
        if let ExprKind::Field { object, field } = &callee.kind {
            let t_obj_raw = self.infer_expr(object)?;
            let t_obj = self.apply(&t_obj_raw);
            if matches!(&t_obj, Type::Named(n) if n == "channel") || matches!(&t_obj, Type::Generic(n, _) if n == "Channel") {
                for a in args {
                    self.infer_expr(a)?;
                }
                return Ok(match field.as_str() {
                    "recv" => self.fresh_var(),
                    _ => Type::Unit, // send/push/...
                });
            }
            // Прочие методы (arr.push/pop/length): проверяем аргументы,
            // возвращаем свежую переменную — строгая типизация не нужна.
            for a in args {
                self.infer_expr(a)?;
            }
            return Ok(self.fresh_var());
        }

        // Вариативные встроенные функции: проверяем аргументы, но не арность.
        if let ExprKind::Identifier(name) = &callee.kind {
            // `new Class(...)` — конструктор класса.
            if name.starts_with("new ") {
                for arg in args {
                    self.infer_expr(arg)?;
                }
                return Ok(Type::Named(name[4..].to_string()));
            }
            if VARIADIC_BUILTINS.contains(&name.as_str()) {
                for arg in args {
                    self.infer_expr(arg)?;
                }
                return Ok(match name.as_str() {
                    "ai_infer" => Type::String,
                    "ai_embed" => Type::Array(Box::new(Type::Float)),
                    "ai_stream" => Type::Float,
                    "stream_next" => Type::String,
                    "tensor" | "zeros" | "ones" => {
                        Type::Generic("Tensor".to_string(), vec![self.fresh_var()])
                    }
                    "semantic" => Type::Generic("Semantic".to_string(), vec![Type::String]),
                    "cosine_similarity" | "dot" | "magnitude" => Type::Float,
                    "matmul" => Type::Generic("Tensor".to_string(), vec![self.fresh_var()]),
                    "len" => Type::Int,
                    "alloc" | "load8" | "load32" => Type::Int,
                    "store8" | "store32" | "memcopy" => Type::Unit,
                    "str" => Type::String,
                    "int" => Type::Int,
                    "float" => Type::Float,
                    "sqrt" => Type::Float,
                    "push" => Type::Unit,
                    "snapshot" | "enforce_contract" => Type::Bool,
                    "ai_contract" => Type::Generic("Contract".to_string(), vec![Type::String]),
                    _ => Type::Unit, // print, assert, ...
                });
            }
        }

        let t_callee = self.infer_expr(callee)?;
        let t_callee = self.apply(&t_callee);

        let arg_types: Vec<Type> = args.iter().map(|_| self.fresh_var()).collect();
        let ret_type = self.fresh_var();
        let expected_fn = Type::Fn(arg_types.clone(), Box::new(ret_type.clone()));

        self.unify(&t_callee, &expected_fn, callee.pos)?;

        for (arg, expected) in args.iter().zip(arg_types.iter()) {
            let t_arg = self.infer_expr(arg)?;
            self.unify(&t_arg, expected, arg.pos)?;
        }

        let _ = pos;
        Ok(ret_type)
    }

}
