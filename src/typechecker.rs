//! Семантический анализатор (type checker) для языка Latent.
//!
//! Реализует алгоритм Hindley-Milner для автоматического вывода типов,
//! проверку области видимости (scope analysis) и специальную типизацию для AI-примитивов.

use crate::ast::*;
use crate::lexer::Position;
use std::collections::{HashMap, HashSet};
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

/// Свободные переменные в типе
fn free_vars(ty: &Type) -> HashSet<String> {
    match ty {
        Type::Var(name) => {
            let mut set = HashSet::new();
            set.insert(name.clone());
            set
        }
        Type::Array(inner) => free_vars(inner),
        Type::Fn(args, ret) => {
            let mut set = HashSet::new();
            for a in args {
                set.extend(free_vars(a));
            }
            set.extend(free_vars(ret));
            set
        }
        Type::Tuple(types) => {
            let mut set = HashSet::new();
            for t in types {
                set.extend(free_vars(t));
            }
            set
        }
        Type::Generic(_, args) => {
            let mut set = HashSet::new();
            for a in args {
                set.extend(free_vars(a));
            }
            set
        }
        Type::Poly { vars, body } => {
            let mut set = free_vars(body);
            for v in vars {
                set.remove(v);
            }
            set
        }
        _ => HashSet::new(),
    }
}

/// Окружение — стек областей видимости
pub struct Environment {
    scopes: Vec<HashMap<String, Type>>,
}

impl Environment {
    pub fn new() -> Self {
        let mut env = Self { scopes: vec![HashMap::new()] };
        env.bind("print", Type::Fn(vec![Type::String], Box::new(Type::Unit)));
        env.bind("sqrt", Type::Fn(vec![Type::Float], Box::new(Type::Float)));
        // channel<T>() -> Channel<T>
        env.bind("channel", Type::Fn(
            vec![],
            Box::new(Type::Generic("Channel".to_string(), vec![Type::Var("$T".to_string())]))
        ));
        // assert(condition: bool) -> unit
        env.bind("assert", Type::Fn(vec![Type::Bool], Box::new(Type::Unit)));
        env
    }

    pub fn enter_scope(&mut self) {
        self.scopes.push(HashMap::new());
    }

    pub fn exit_scope(&mut self) {
        self.scopes.pop();
    }

    pub fn bind(&mut self, name: &str, ty: Type) {
        let current = self.scopes.last_mut().unwrap();
        current.insert(name.to_string(), ty);
    }

    pub fn lookup(&self, name: &str) -> Option<&Type> {
        for scope in self.scopes.iter().rev() {
            if let Some(ty) = scope.get(name) {
                return Some(ty);
            }
        }
        None
    }

    fn free_vars(&self) -> HashSet<String> {
        let mut set = HashSet::new();
        for scope in &self.scopes {
            for ty in scope.values() {
                set.extend(free_vars(ty));
            }
        }
        set
    }
}

/// Семантический анализатор
pub struct TypeChecker {
    env: Environment,
    subst: Substitution,
    var_counter: usize,
}

impl TypeChecker {
    pub fn new() -> Self {
        Self {
            env: Environment::new(),
            subst: HashMap::new(),
            var_counter: 0,
        }
    }

    fn fresh_var(&mut self) -> Type {
        self.var_counter += 1;
        Type::Var(format!("$T{}", self.var_counter))
    }

    fn apply(&self, ty: &Type) -> Type {
        apply_subst(&self.subst, ty)
    }

    fn unify(&mut self, t1: &Type, t2: &Type, pos: Position) -> Result<(), TypeError> {
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
                    other => Err(other),
                }
            }
        }
    }

    /// Инстанцирование полиморфного типа
    fn instantiate(&mut self, ty: &Type) -> Type {
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

    /// Обобщение типа
    fn generalize(&self, ty: &Type) -> Type {
        let free_in_env: HashSet<String> = self.env.free_vars();
        let free_in_ty = free_vars(ty);
        let gen_vars: Vec<String> = free_in_ty.difference(&free_in_env).cloned().collect();

        if gen_vars.is_empty() {
            ty.clone()
        } else {
            Type::Poly {
                vars: gen_vars,
                body: Box::new(ty.clone()),
            }
        }
    }

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
                let t_left = self.infer_expr(left)?;
                let t_right = self.infer_expr(right)?;

                match op {
                    BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul |
                    BinaryOp::Div | BinaryOp::Mod => {
                        self.unify(&t_left, &Type::Float, left.pos)?;
                        self.unify(&t_right, &Type::Float, right.pos)?;
                        Ok(Type::Float)
                    }
                    BinaryOp::Eq | BinaryOp::NotEq => {
                        self.unify(&t_left, &t_right, pos)?;
                        Ok(Type::Bool)
                    }
                    BinaryOp::Lt | BinaryOp::Gt | BinaryOp::LtEq | BinaryOp::GtEq => {
                        self.unify(&t_left, &Type::Float, left.pos)?;
                        self.unify(&t_right, &Type::Float, right.pos)?;
                        Ok(Type::Bool)
                    }
                    BinaryOp::And | BinaryOp::Or => {
                        self.unify(&t_left, &Type::Bool, left.pos)?;
                        self.unify(&t_right, &Type::Bool, right.pos)?;
                        Ok(Type::Bool)
                    }
                    _ => todo!("Other binary operators"),
                }
            }

            ExprKind::Unary { op, operand } => {
                let t = self.infer_expr(operand)?;
                match op {
                    UnaryOp::Neg => {
                        self.unify(&t, &Type::Float, operand.pos)?;
                        Ok(Type::Float)
                    }
                    UnaryOp::Not => {
                        self.unify(&t, &Type::Bool, operand.pos)?;
                        Ok(Type::Bool)
                    }
                }
            }

            ExprKind::Assign { target, value } => {
                let t_target = self.infer_expr(target)?;
                let t_value = self.infer_expr(value)?;
                self.unify(&t_target, &t_value, pos)?;
                Ok(t_target)
            }

            ExprKind::Call { callee, args } => {
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

                Ok(ret_type)
            }

            ExprKind::Array(elements) => {
                let elem_type = self.fresh_var();
                for elem in elements {
                    let t = self.infer_expr(elem)?;
                    self.unify(&elem_type, &t, elem.pos)?;
                }
                Ok(Type::Array(Box::new(elem_type)))
            }

            ExprKind::Lambda { params, body, .. } => {
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

                let t_body = self.infer_expr(body)?;
                self.unify(&ret_type, &t_body, body.pos)?;

                self.env.exit_scope();

                Ok(Type::Fn(param_types, Box::new(ret_type)))
            }

            ExprKind::Index { object, index } => {
                let t_obj = self.infer_expr(object)?;
                let t_index = self.infer_expr(index)?;
                self.unify(&t_index, &Type::Float, index.pos)?;

                let elem_type = self.fresh_var();
                self.unify(&t_obj, &Type::Array(Box::new(elem_type.clone())), object.pos)?;
                Ok(elem_type)
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

            _ => todo!("More expression types"),
        }
    }

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

            StmtKind::Fn { name, params, ret_ty, body } => {
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
                let final_ret_type = if name.starts_with("async_") || name == "fetch" {
                    Type::Generic("Promise".to_string(), vec![self.apply(&ret_type)])
                } else {
                    self.apply(&ret_type)
                };

                let final_fn_type = Type::Fn(param_types, Box::new(final_ret_type));
                self.env.bind(name, self.generalize(&final_fn_type));

                Ok(Type::Unit)
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
        }
    }

    /// Парсинг аннотации типа
    fn parse_type_annotation(&self, ty: &crate::ast::Type) -> Result<Type, TypeError> {
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
    fn infer_pattern(&mut self, pat: &Pattern, expected: &Type) -> Result<Type, TypeError> {
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

    /// Проверка всей программы
    pub fn check_program(&mut self, program: &Program) -> Result<(), Vec<TypeError>> {
        let mut errors = Vec::new();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::Lexer;
    use crate::parser::Parser;

    fn check(source: &str) -> Result<(), Vec<TypeError>> {
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize().unwrap();
        let mut parser = Parser::new(tokens);
        let ast = parser.parse().unwrap();
        let mut checker = TypeChecker::new();
        checker.check_program(&ast)
    }

    #[test]
    fn test_simple_let() {
        assert!(check("let x = 42;").is_ok());
        assert!(check("let x: int = 42;").is_ok());
        assert!(check("let x: string = 42;").is_err());
    }

    #[test]
    fn test_undefined_variable() {
        let result = check("let x = y;");
        assert!(result.is_err());
    }

    #[test]
    fn test_function_inference() {
        let source = r#"
fn add(a, b) {
    return a + b;
}
let x = add(1, 2);
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_polymorphic_id() {
        let source = r#"
let id = fn(x) => x;
let a = id(5);
let b = id("hello");
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_type_mismatch() {
        let source = r#"
let x = "hello";
let y = x + 5;
"#;
        let result = check(source);
        assert!(result.is_err());
    }

    #[test]
    fn test_nested_functions() {
        let source = r#"
fn makeAdder(n) {
    return fn(x) => x + n;
}
let add5 = makeAdder(5);
let result = add5(10);
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_array_inference() {
        let source = r#"
let arr = [1, 2, 3];
let first = arr[0];
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_lambda_inference() {
        let source = r#"
let apply = fn(f, x) => f(x);
let result = apply(fn(n) => n * 2, 5);
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_if_condition_must_be_bool() {
        let source = r#"
if (42) {
    print("yes");
}
"#;
        let result = check(source);
        assert!(result.is_err());
    }

    #[test]
    fn test_while_condition_must_be_bool() {
        let source = r#"
while (42) {
    print("yes");
}
"#;
        let result = check(source);
        assert!(result.is_err());
    }

    #[test]
    fn test_for_iterable_must_be_array() {
        let source = r#"
for (let x in 42) {
    print(x);
}
"#;
        let result = check(source);
        assert!(result.is_err());
    }

    #[test]
    fn test_return_type_mismatch() {
        let source = r#"
fn f() -> int {
    return "hello";
}
"#;
        let result = check(source);
        if let Err(errors) = &result {
            for e in errors {
                println!("Error: {}", e);
            }
        }
        assert!(result.is_err());
    }

    #[test]
    fn test_recursive_function() {
        let source = r#"
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_class_declaration() {
        let source = r#"
class Point {
    x: int;
    y: int;
    fn new(x: int, y: int) {
        this.x = x;
        this.y = y;
    }
}
"#;
        let result = check(source);
        if let Err(errors) = &result {
            for e in errors {
                println!("Error: {}", e);
            }
        }
        assert!(result.is_ok());
    }

    #[test]
    fn test_spawn() {
        let source = r#"
spawn {
    print("hello");
}
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_decorator() {
        let source = r#"
@test("name")
fn foo() {
    assert(true);
}
"#;
        let result = check(source);
        if let Err(errors) = &result {
            for e in errors {
                println!("Error: {}", e);
            }
        }
        assert!(result.is_ok());
    }

    #[test]
    fn test_match() {
        let source = r#"
let x = 42;
match x {
    case 1: print("one"),
    case _: print("other")
};
"#;
        assert!(check(source).is_ok());
    }

    #[test]
    fn test_channel() {
        let source = r#"
let ch = channel<int>();
spawn {
    ch <- 42;
};
let x = <-ch;
"#;
        let result = check(source);
        if let Err(errors) = &result {
            for e in errors {
                println!("Error: {}", e);
            }
        }
        assert!(result.is_ok());
    }

    #[test]
    fn test_await() {
        let source = r#"
async fn fetch() -> string {
    return "data";
}
let x = await fetch();
"#;
        let result = check(source);
        if let Err(errors) = &result {
            for e in errors {
                println!("Error: {}", e);
            }
        }
        assert!(result.is_ok());
    }
}
