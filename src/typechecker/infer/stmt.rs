//! Вывод типов: инструкции, функции, аннотации типов и паттерны.

use super::super::checker::TypeChecker;
use super::super::types::{Type, TypeError};
use crate::ast::*;
use crate::lexer::Position;

impl TypeChecker {
    /// Вывод типов для инструкций
    pub fn infer_stmt(&mut self, stmt: &Stmt) -> Result<Type, TypeError> {
        let pos = stmt.pos;
        match &stmt.kind {
            StmtKind::Let { name, ty: ann, value } => {
                let t_value = self.infer_expr(value)?;

                if let Some(ann) = ann {
                    let t_ann = self.parse_type_annotation(ann)?;
                    self.unify(&t_value, &t_ann, pos)?;
                }

                let gen_type = self.generalize(&t_value);
                self.env.bind(name, gen_type);

                Ok(Type::Unit)
            }

            StmtKind::Fn { name, params, ret_ty, body, is_async } => {
                self.infer_fn(name, params, ret_ty, body, *is_async, pos)
            }

            StmtKind::Return(expr) => {
                match expr {
                    Some(e) => self.infer_expr(e),
                    None => Ok(Type::Unit),
                }
            }

            StmtKind::If { cond, then_branch, else_branch } => {
                let t_cond = self.infer_expr(cond)?;
                self.unify(&t_cond, &Type::Bool, cond.pos)?;

                self.env.enter_scope();
                for s in then_branch {
                    self.infer_stmt(s)?;
                }
                self.env.exit_scope();

                if let Some(else_branch) = else_branch {
                    self.env.enter_scope();
                    for s in else_branch {
                        self.infer_stmt(s)?;
                    }
                    self.env.exit_scope();
                }

                Ok(Type::Unit)
            }

            StmtKind::While { cond, body } => {
                let t_cond = self.infer_expr(cond)?;
                self.unify(&t_cond, &Type::Bool, cond.pos)?;

                self.env.enter_scope();
                for s in body {
                    self.infer_stmt(s)?;
                }
                self.env.exit_scope();

                Ok(Type::Unit)
            }

            StmtKind::For { var, iterable, body } => {
                let t_iter = self.infer_expr(iterable)?;
                let elem_type = self.fresh_var();
                self.unify(&t_iter, &Type::Array(Box::new(elem_type.clone())), iterable.pos)?;

                self.env.enter_scope();
                self.env.bind(var, elem_type);
                for s in body {
                    self.infer_stmt(s)?;
                }
                self.env.exit_scope();

                Ok(Type::Unit)
            }

            StmtKind::Expr(expr) => self.infer_expr(expr),

            StmtKind::ForC { init, cond, step, body } => {
                self.env.enter_scope();
                if let Some(init_stmt) = init {
                    self.infer_stmt(init_stmt)?;
                }
                if let Some(c) = cond {
                    self.infer_expr(c)?;
                }
                for s in body {
                    self.infer_stmt(s)?;
                }
                if let Some(st) = step {
                    self.infer_expr(st)?;
                }
                self.env.exit_scope();
                Ok(Type::Unit)
            }

            StmtKind::Spawn(body) => {
                self.env.enter_scope();
                for s in body {
                    self.infer_stmt(s)?;
                }
                self.env.exit_scope();
                Ok(Type::Unit)
            }

            StmtKind::Class { name, fields, methods } => {
                let field_types: Vec<(String, Type)> = fields.iter().map(|f| {
                    let ty = f.ty.as_ref()
                        .map(|a| self.parse_type_annotation(a).unwrap_or(Type::Var("$Unknown".to_string())))
                        .unwrap_or_else(|| Type::Var(format!("$Field_{}", f.name)));
                    (f.name.clone(), ty)
                }).collect();
                let _ = field_types;

                let class_type = Type::Generic(name.clone(), vec![]);
                self.env.bind(name, class_type.clone());

                self.env.enter_scope();
                // Добавляем this в окружение для методов класса
                self.env.bind("this", class_type);
                for method in methods {
                    self.infer_stmt(method)?;
                }
                self.env.exit_scope();

                Ok(Type::Unit)
            }

            StmtKind::Enum { name, variants } => {
                // Конструкторы вариантов: имя → функция (fields...) -> Enum.
                for v in variants {
                    let arg_types: Vec<Type> = v.fields.iter()
                        .map(|t| self.parse_type_annotation(t).unwrap_or(Type::Unit))
                        .collect();
                    let ty = if v.fields.is_empty() {
                        Type::Named(name.clone())
                    } else {
                        Type::Fn(arg_types, Box::new(Type::Named(name.clone())))
                    };
                    self.env.bind(&v.name, ty);
                }
                self.env.bind(name, Type::Named(name.clone()));
                Ok(Type::Unit)
            }

            StmtKind::Decorator { target, .. } => {
                self.infer_stmt(target)
            }

            StmtKind::Test { body, .. } => {
                self.env.enter_scope();
                for s in body {
                    self.infer_stmt(s)?;
                }
                self.env.exit_scope();
                Ok(Type::Unit)
            }

            StmtKind::AiGenerate { .. } => {
                Ok(Type::Var("$AI_Generated".to_string()))
            }

            StmtKind::Select { arms, default_branch } => {
                for arm in arms {
                    let ch = self.infer_expr(&arm.channel)?;
                    // channel<T>() имеет тип Named("channel"); также допускаем
                    // Generic("Channel", [T]). Извлекаем тип элемента, если он есть.
                    let elem = self.fresh_var();
                    match self.apply(&ch) {
                        Type::Generic(n, args) if n == "Channel" && args.len() == 1 => {
                            self.unify(&elem, &args[0], arm.channel.pos)?;
                        }
                        Type::Named(n) if n == "channel" => { /* element неизвестен */ }
                        _ => { /* канал неизвестного типа — принимаем без строгой проверки */ }
                    }
                    self.env.enter_scope();
                    if let Some(var) = &arm.var {
                        self.env.bind(var, elem);
                    }
                    for s in &arm.body {
                        self.infer_stmt(s)?;
                    }
                    self.env.exit_scope();
                }
                if let Some(db) = default_branch {
                    self.env.enter_scope();
                    for s in db {
                        self.infer_stmt(s)?;
                    }
                    self.env.exit_scope();
                }
                Ok(Type::Unit)
            }

            StmtKind::Yield => Ok(Type::Unit),
        }
    }

    /// Вывод типа функции: параметры, тело, возвращаемый тип.
    fn infer_fn(
        &mut self,
        name: &str,
        params: &[Param],
        ret_ty: &Option<crate::ast::Type>,
        body: &[Stmt],
        is_async: bool,
        pos: Position,
    ) -> Result<Type, TypeError> {
        let param_types: Vec<Type> = params.iter().map(|_| self.fresh_var()).collect();
        let ret_type = self.fresh_var();
        let fn_type = Type::Fn(param_types.clone(), Box::new(ret_type.clone()));

        self.env.bind(name, fn_type.clone());

        self.env.enter_scope();
        for (param, ty) in params.iter().zip(param_types.iter()) {
            self.env.bind(&param.name, ty.clone());
            if let Some(ann) = &param.ty {
                let t_ann = self.parse_type_annotation(ann)?;
                self.unify(ty, &t_ann, pos)?;
            }
        }

        let mut has_return = false;
        let mut last_ty = Type::Unit;
        for s in body {
            last_ty = self.infer_stmt(s)?;
            if matches!(s.kind, StmtKind::Return(_)) {
                has_return = true;
            }
        }

        if let Some(ann) = ret_ty {
            let t_ann = self.parse_type_annotation(ann)?;
            self.unify(&ret_type, &t_ann, pos)?;
            // Проверяем, что тип последнего return соответствует аннотации
            if has_return {
                self.unify(&last_ty, &t_ann, pos)?;
            }
        } else if has_return {
            // Унифицируем с типом последнего return
            self.unify(&ret_type, &last_ty, pos)?;
        } else {
            self.unify(&ret_type, &Type::Unit, pos)?;
        }

        self.env.exit_scope();

        // Если функция async, оборачиваем возвращаемый тип в Promise
        let final_ret_type = if is_async {
            Type::Generic("Promise".to_string(), vec![self.apply(&ret_type)])
        } else {
            self.apply(&ret_type)
        };

        let final_fn_type = Type::Fn(param_types, Box::new(final_ret_type));
        self.env.bind(name, self.generalize(&final_fn_type));

        Ok(Type::Unit)
    }

    /// Парсинг аннотации типа
    pub(crate) fn parse_type_annotation(&self, ty: &crate::ast::Type) -> Result<Type, TypeError> {
        match ty {
            crate::ast::Type::Named(name) => match name.as_str() {
                "int" => Ok(Type::Int),
                "float" => Ok(Type::Float),
                "bool" => Ok(Type::Bool),
                "string" => Ok(Type::String),
                "null" => Ok(Type::Null),
                "unit" | "void" => Ok(Type::Unit),
                other => Ok(Type::Named(other.to_string())),
            },
            crate::ast::Type::Array(inner) => {
                Ok(Type::Array(Box::new(self.parse_type_annotation(inner)?)))
            }
            crate::ast::Type::Fn(args, ret) => {
                let a = args.iter().map(|x| self.parse_type_annotation(x)).collect::<Result<Vec<_>, _>>()?;
                let r = self.parse_type_annotation(ret)?;
                Ok(Type::Fn(a, Box::new(r)))
            }
            crate::ast::Type::Union(types) => {
                if let Some(first) = types.first() {
                    self.parse_type_annotation(first)
                } else {
                    Ok(Type::Unit)
                }
            }
            crate::ast::Type::Generic(name, args) => {
                let a = args.iter().map(|x| self.parse_type_annotation(x)).collect::<Result<Vec<_>, _>>()?;
                Ok(Type::Generic(name.clone(), a))
            }
            _ => Ok(Type::Var("$Unknown".to_string())),
        }
    }

    /// Вывод типов для паттернов
    pub(crate) fn infer_pattern(&mut self, pat: &Pattern, expected: &Type) -> Result<Type, TypeError> {
        match pat {
            Pattern::Wildcard => Ok(expected.clone()),
            Pattern::Literal(lit) => match lit {
                ExprKind::Number(_) => {
                    self.unify(expected, &Type::Float, Position::new(0, 0, 0))?;
                    Ok(Type::Float)
                }
                ExprKind::String(_) => {
                    self.unify(expected, &Type::String, Position::new(0, 0, 0))?;
                    Ok(Type::String)
                }
                ExprKind::Bool(_) => {
                    self.unify(expected, &Type::Bool, Position::new(0, 0, 0))?;
                    Ok(Type::Bool)
                }
                _ => Ok(expected.clone()),
            },
            Pattern::Identifier(name) => {
                self.env.bind(name, expected.clone());
                Ok(expected.clone())
            }
            Pattern::Constructor(name, args) => {
                let mut arg_types = Vec::new();
                for arg in args {
                    let t = self.fresh_var();
                    arg_types.push(self.infer_pattern(arg, &t)?);
                }
                let ret = self.fresh_var();
                let ctor_type = Type::Fn(arg_types, Box::new(ret.clone()));
                self.env.bind(name, ctor_type);
                Ok(ret)
            }
        }
    }

}
