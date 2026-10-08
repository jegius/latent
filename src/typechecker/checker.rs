//! Структура анализатора и проверка программы (hoisting + обход).

use super::environment::Environment;
use super::types::{
    apply_subst, compose_subst, unify, Substitution, Type, TypeError,
};
use crate::ast::*;
use crate::lexer::Position;
use std::collections::{HashMap, HashSet};

/// Семантический анализатор
pub struct TypeChecker {
    pub(super) env: Environment,
    pub(super) subst: Substitution,
    pub(super) var_counter: usize,
}

impl TypeChecker {
    pub fn new() -> Self {
        Self {
            env: Environment::new(),
            subst: HashMap::new(),
            var_counter: 0,
        }
    }

    pub(super) fn fresh_var(&mut self) -> Type {
        self.var_counter += 1;
        Type::Var(format!("$T{}", self.var_counter))
    }

    pub(super) fn apply(&self, ty: &Type) -> Type {
        apply_subst(&self.subst, ty)
    }

    pub(super) fn unify(&mut self, t1: &Type, t2: &Type, pos: Position) -> Result<(), TypeError> {
        let t1 = self.apply(t1);
        let t2 = self.apply(t2);
        match unify(&t1, &t2) {
            Ok(subst) => {
                self.subst = compose_subst(&subst, &self.subst);
                Ok(())
            }
            Err(e) => {
                match e {
                    TypeError::TypeMismatch { expected, found, .. } => {
                        Err(TypeError::TypeMismatch { expected, found, pos })
                    }
                    TypeError::InfiniteType { var, ty, .. } => {
                        Err(TypeError::InfiniteType { var, ty, pos })
                    }
                    TypeError::ArityMismatch { expected, found, .. } => {
                        Err(TypeError::ArityMismatch { expected, found, pos })
                    }
                    other => Err(other),
                }
            }
        }
    }

    /// Инстанцирование полиморфного типа
    pub(super) fn instantiate(&mut self, ty: &Type) -> Type {
        match ty {
            Type::Poly { vars, body } => {
                let mut subst = HashMap::new();
                for v in vars {
                    subst.insert(v.clone(), self.fresh_var());
                }
                apply_subst(&subst, body)
            }
            other => other.clone(),
        }
    }

    /// Обобщение типа. Перед обобщением применяем текущую подстановку, иначе
    /// свободные переменные, уже связанные (например `$T2 = $T1` для `id`),
    /// обобщаются по отдельности и полиморфизм становится несостоятельным.
    pub(super) fn generalize(&self, ty: &Type) -> Type {
        let resolved = self.apply(ty);
        let free_in_env: HashSet<String> = self.env.free_vars();
        let free_in_ty = super::types::free_vars(&resolved);
        let gen_vars: Vec<String> = free_in_ty.difference(&free_in_env).cloned().collect();

        if gen_vars.is_empty() {
            resolved
        } else {
            Type::Poly {
                vars: gen_vars,
                body: Box::new(resolved),
            }
        }
    }

    /// Проверка всей программы
    pub fn check_program(&mut self, program: &Program) -> Result<(), Vec<TypeError>> {
        let mut errors = Vec::new();

        // Хойстинг функций: сначала регистрируем сигнатуры всех функций, чтобы
        // вызовы работали независимо от порядка объявления (как в engine #1).
        for stmt in &program.statements {
            if let StmtKind::Fn { name, params, ret_ty, is_async, .. } = &stmt.kind {
                let param_types: Vec<Type> = params.iter().map(|p| {
                    p.ty.as_ref()
                        .and_then(|t| self.parse_type_annotation(t).ok())
                        .unwrap_or_else(|| self.fresh_var())
                }).collect();
                let ret = ret_ty.as_ref()
                    .and_then(|t| self.parse_type_annotation(t).ok())
                    .unwrap_or(Type::Unit);
                // async fn возвращает Promise<T> — как и при выводе тела.
                let ret = if *is_async {
                    Type::Generic("Promise".to_string(), vec![ret])
                } else {
                    ret
                };
                let sig = Type::Fn(param_types, Box::new(ret));
                self.env.bind(name, self.generalize(&sig));
            }
        }

        // Хойстинг enum-вариантов: конструкторы должны быть видны до места
        // объявления (шаблон Result/Option).
        for stmt in &program.statements {
            if let StmtKind::Enum { name, variants } = &stmt.kind {
                for v in variants {
                    let arg_types: Vec<Type> = v.fields.iter()
                        .map(|t| self.parse_type_annotation(t).unwrap_or(Type::Unit))
                        .collect();
                    let ty = if v.fields.is_empty() {
                        // 0-арный вариант — значение, а не функция.
                        Type::Named(name.clone())
                    } else {
                        Type::Fn(arg_types, Box::new(Type::Named(name.clone())))
                    };
                    self.env.bind(&v.name, ty);
                }
                self.env.bind(name, Type::Named(name.clone()));
            }
        }

        // Встроенные варианты Result/Option (без явной декларации).
        for (vname, arity) in [("Ok", 1usize), ("Err", 1), ("Some", 1), ("None", 0)] {
            if self.env.lookup(vname).is_none() {
                let args = vec![self.fresh_var(); arity];
                let ctor = Type::Fn(args, Box::new(Type::Named("Variant".to_string())));
                self.env.bind(vname, ctor);
            }
        }

        for stmt in &program.statements {
            if let Err(e) = self.infer_stmt(stmt) {
                errors.push(e);
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Получить итоговый тип переменной
    pub fn final_type(&self, ty: &Type) -> Type {
        self.apply(ty)
    }
}