//! Типы системы Hindley-Milner и арифметика над ними.
//!
//! Декомпозирован: модуль [`free_vars`] вынесен отдельно.

use crate::lexer::Position;
use std::collections::HashMap;
use std::fmt;

/// Типы в системе Hindley-Milner
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Type {
    Int,
    Float,
    Bool,
    String,
    Null,
    Unit,
    Var(String),
    Named(String),
    Array(Box<Type>),
    Fn(Vec<Type>, Box<Type>),
    Tuple(Vec<Type>),
    Generic(String, Vec<Type>),
    Poly {
        vars: Vec<String>,
        body: Box<Type>,
    },
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Int => write!(f, "int"),
            Type::Float => write!(f, "float"),
            Type::Bool => write!(f, "bool"),
            Type::String => write!(f, "string"),
            Type::Null => write!(f, "null"),
            Type::Unit => write!(f, "unit"),
            Type::Var(name) => write!(f, "{}", name),
            Type::Named(name) => write!(f, "{}", name),
            Type::Array(inner) => write!(f, "[{}]", inner),
            Type::Fn(args, ret) => {
                let args_str: Vec<String> = args.iter().map(|a| a.to_string()).collect();
                write!(f, "fn({}) -> {}", args_str.join(", "), ret)
            }
            Type::Tuple(types) => {
                let types_str: Vec<String> = types.iter().map(|t| t.to_string()).collect();
                write!(f, "({})", types_str.join(", "))
            }
            Type::Generic(name, args) => {
                let args_str: Vec<String> = args.iter().map(|a| a.to_string()).collect();
                write!(f, "{}<{}>", name, args_str.join(", "))
            }
            Type::Poly { vars, body } => {
                write!(f, "∀{}. {}", vars.join(" "), body)
            }
        }
    }
}

/// Ошибки типизации
#[derive(Debug, Clone)]
pub enum TypeError {
    UndefinedVariable { name: String, pos: Position },
    TypeMismatch { expected: Type, found: Type, pos: Position },
    InfiniteType { var: String, ty: Type, pos: Position },
    ArityMismatch { expected: usize, found: usize, pos: Position },
    NotAFunction { ty: Type, pos: Position },
    MissingReturn { pos: Position },
    InvalidAIType { message: String, pos: Position },
}

impl fmt::Display for TypeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TypeError::UndefinedVariable { name, pos } => {
                write!(f, "Неопределённая переменная '{}' на строке {}:{}", name, pos.line, pos.column)
            }
            TypeError::TypeMismatch { expected, found, pos } => {
                write!(f, "Несовпадение типов на строке {}:{}: ожидалось '{}', найдено '{}'",
                    pos.line, pos.column, expected, found)
            }
            TypeError::InfiniteType { var, ty, pos } => {
                write!(f, "Бесконечный тип на строке {}:{}: '{}' = '{}'",
                    pos.line, pos.column, var, ty)
            }
            TypeError::ArityMismatch { expected, found, pos } => {
                write!(f, "Несовпадение арности на строке {}:{}: ожидалось {} аргументов, найдено {}",
                    pos.line, pos.column, expected, found)
            }
            TypeError::NotAFunction { ty, pos } => {
                write!(f, "Не функция на строке {}:{}: тип '{}'", pos.line, pos.column, ty)
            }
            TypeError::MissingReturn { pos } => {
                write!(f, "Отсутствует return на строке {}:{}", pos.line, pos.column)
            }
            TypeError::InvalidAIType { message, pos } => {
                write!(f, "Неверный AI-тип на строке {}:{}: {}", pos.line, pos.column, message)
            }
        }
    }
}

/// Подстановка — отображение типовых переменных в типы
pub type Substitution = HashMap<String, Type>;

/// Применяет подстановку к типу
pub fn apply_subst(subst: &Substitution, ty: &Type) -> Type {
    match ty {
        Type::Var(name) => {
            if let Some(t) = subst.get(name) {
                apply_subst(subst, t)
            } else {
                ty.clone()
            }
        }
        Type::Array(inner) => Type::Array(Box::new(apply_subst(subst, inner))),
        Type::Fn(args, ret) => Type::Fn(
            args.iter().map(|a| apply_subst(subst, a)).collect(),
            Box::new(apply_subst(subst, ret)),
        ),
        Type::Tuple(types) => Type::Tuple(
            types.iter().map(|t| apply_subst(subst, t)).collect(),
        ),
        Type::Generic(name, args) => Type::Generic(
            name.clone(),
            args.iter().map(|a| apply_subst(subst, a)).collect(),
        ),
        Type::Poly { vars, body } => {
            let mut filtered = subst.clone();
            for v in vars {
                filtered.remove(v);
            }
            Type::Poly {
                vars: vars.clone(),
                body: Box::new(apply_subst(&filtered, body)),
            }
        }
        _ => ty.clone(),
    }
}

/// Композиция подстановок
pub fn compose_subst(s1: &Substitution, s2: &Substitution) -> Substitution {
    let mut result: Substitution = s2.iter()
        .map(|(k, v)| (k.clone(), apply_subst(s1, v)))
        .collect();
    result.extend(s1.iter().map(|(k, v)| (k.clone(), v.clone())));
    result
}

/// Унификация типов
pub fn unify(t1: &Type, t2: &Type) -> Result<Substitution, TypeError> {
    match (t1, t2) {
        (Type::Int, Type::Int) => Ok(HashMap::new()),
        (Type::Float, Type::Float) => Ok(HashMap::new()),
        (Type::Int, Type::Float) => Ok(HashMap::new()),
        (Type::Float, Type::Int) => Ok(HashMap::new()),
        (Type::Bool, Type::Bool) => Ok(HashMap::new()),
        (Type::String, Type::String) => Ok(HashMap::new()),
        (Type::Null, Type::Null) => Ok(HashMap::new()),
        (Type::Unit, Type::Unit) => Ok(HashMap::new()),

        (Type::Var(name), other) => bind_var(name, other),
        (other, Type::Var(name)) => bind_var(name, other),

        // Именованные (пользовательские) типы унифицируются сами с собой.
        // Без этого две переменные одного типа не сходились бы (§7.4 Части IV).
        (Type::Named(a), Type::Named(b)) if a == b => Ok(HashMap::new()),

        (Type::Array(a), Type::Array(b)) => unify(a, b),

        (Type::Fn(args1, ret1), Type::Fn(args2, ret2)) => {
            if args1.len() != args2.len() {
                return Err(TypeError::ArityMismatch {
                    expected: args1.len(),
                    found: args2.len(),
                    pos: Position::new(0, 0, 0),
                });
            }
            let mut subst = HashMap::new();
            for (a1, a2) in args1.iter().zip(args2.iter()) {
                let s = unify(&apply_subst(&subst, a1), &apply_subst(&subst, a2))?;
                subst = compose_subst(&s, &subst);
            }
            let s = unify(&apply_subst(&subst, ret1), &apply_subst(&subst, ret2))?;
            Ok(compose_subst(&s, &subst))
        }

        (Type::Tuple(types1), Type::Tuple(types2)) => {
            if types1.len() != types2.len() {
                return Err(TypeError::ArityMismatch {
                    expected: types1.len(),
                    found: types2.len(),
                    pos: Position::new(0, 0, 0),
                });
            }
            let mut subst = HashMap::new();
            for (t1, t2) in types1.iter().zip(types2.iter()) {
                let s = unify(&apply_subst(&subst, t1), &apply_subst(&subst, t2))?;
                subst = compose_subst(&s, &subst);
            }
            Ok(subst)
        }

        (Type::Generic(n1, args1), Type::Generic(n2, args2)) => {
            if n1 != n2 || args1.len() != args2.len() {
                return Err(TypeError::TypeMismatch {
                    expected: t1.clone(),
                    found: t2.clone(),
                    pos: Position::new(0, 0, 0),
                });
            }
            let mut subst = HashMap::new();
            for (a1, a2) in args1.iter().zip(args2.iter()) {
                let s = unify(&apply_subst(&subst, a1), &apply_subst(&subst, a2))?;
                subst = compose_subst(&s, &subst);
            }
            Ok(subst)
        }

        _ => Err(TypeError::TypeMismatch {
            expected: t1.clone(),
            found: t2.clone(),
            pos: Position::new(0, 0, 0),
        }),
    }
}

/// Связывает типовую переменную с типом
fn bind_var(var: &str, ty: &Type) -> Result<Substitution, TypeError> {
    if let Type::Var(name) = ty {
        if name == var {
            return Ok(HashMap::new());
        }
    }
    if occurs_in(var, ty) {
        return Err(TypeError::InfiniteType {
            var: var.to_string(),
            ty: ty.clone(),
            pos: Position::new(0, 0, 0),
        });
    }
    let mut subst = HashMap::new();
    subst.insert(var.to_string(), ty.clone());
    Ok(subst)
}

/// Проверяет, входит ли типовая переменная в тип
fn occurs_in(var: &str, ty: &Type) -> bool {
    match ty {
        Type::Var(name) => name == var,
        Type::Array(inner) => occurs_in(var, inner),
        Type::Fn(args, ret) => {
            args.iter().any(|a| occurs_in(var, a)) || occurs_in(var, ret)
        }
        Type::Tuple(types) => types.iter().any(|t| occurs_in(var, t)),
        Type::Generic(_, args) => args.iter().any(|a| occurs_in(var, a)),
        Type::Poly { vars, body } => {
            if vars.contains(&var.to_string()) {
                false
            } else {
                occurs_in(var, body)
            }
        }
        _ => false,
    }
}

mod free_vars;

pub(crate) use free_vars::free_vars;
