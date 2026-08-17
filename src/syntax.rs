//! Синтаксические конструкции языка Latent.
//!
//! Определяет структуры для представления элементов синтаксиса:
//! переменные, функции, классы, управляющие конструкции.

use serde::{Deserialize, Serialize};

/// Позиция в исходном коде
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub line: usize,
    pub column: usize,
    pub offset: usize,
}

impl Span {
    pub fn new(line: usize, column: usize, offset: usize) -> Self {
        Self { line, column, offset }
    }
}

/// Объявление переменной
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LetDecl {
    pub name: String,
    pub ty: Option<TypeAnnotation>,
    pub value: Option<Box<Expr>>,
    pub span: Span,
}

/// Аннотация типа
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TypeAnnotation {
    Named(String),
    Array(Box<TypeAnnotation>),
    Fn(Vec<TypeAnnotation>, Box<TypeAnnotation>),
    Generic(String, Vec<TypeAnnotation>),
    Union(Vec<TypeAnnotation>),
}

/// Выражение
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Expr {
    Number(f64),
    String(String),
    Bool(bool),
    Null,
    Identifier(String),
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Unary {
        op: UnaryOp,
        operand: Box<Expr>,
    },
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
    },
    Array(Vec<Expr>),
    Lambda {
        params: Vec<Param>,
        body: Box<Expr>,
    },
}

/// Бинарные операторы
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOp {
    Add, Sub, Mul, Div, Mod,
    Eq, NotEq, Lt, Gt, LtEq, GtEq,
    And, Or,
}

/// Унарные операторы
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnaryOp {
    Neg, Not,
}

/// Параметр функции
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub name: String,
    pub ty: Option<TypeAnnotation>,
}

/// Объявление функции
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FnDecl {
    pub name: String,
    pub params: Vec<Param>,
    pub ret_ty: Option<TypeAnnotation>,
    pub body: Vec<Stmt>,
    pub span: Span,
}

/// Объявление класса
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClassDecl {
    pub name: String,
    pub fields: Vec<ClassField>,
    pub methods: Vec<FnDecl>,
    pub span: Span,
}

/// Поле класса
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClassField {
    pub name: String,
    pub ty: Option<TypeAnnotation>,
}

/// Инструкция
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Stmt {
    Let(LetDecl),
    Fn(FnDecl),
    Class(ClassDecl),
    If {
        cond: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Option<Vec<Stmt>>,
    },
    While {
        cond: Expr,
        body: Vec<Stmt>,
    },
    For {
        var: String,
        iterable: Expr,
        body: Vec<Stmt>,
    },
    Return(Option<Expr>),
    Expr(Expr),
    Spawn(Vec<Stmt>),
}

/// Программа — корневой узел AST
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Program {
    pub statements: Vec<Stmt>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_span_creation() {
        let span = Span::new(1, 5, 10);
        assert_eq!(span.line, 1);
        assert_eq!(span.column, 5);
        assert_eq!(span.offset, 10);
    }

    #[test]
    fn test_let_decl() {
        let decl = LetDecl {
            name: "x".to_string(),
            ty: Some(TypeAnnotation::Named("int".to_string())),
            value: Some(Box::new(Expr::Number(42.0))),
            span: Span::new(1, 1, 0),
        };
        assert_eq!(decl.name, "x");
        assert!(decl.ty.is_some());
        assert!(decl.value.is_some());
    }

    #[test]
    fn test_binary_expr() {
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Number(1.0)),
            right: Box::new(Expr::Number(2.0)),
        };
        match expr {
            Expr::Binary { op, .. } => assert_eq!(op, BinaryOp::Add),
            _ => panic!("Expected binary expression"),
        }
    }

    #[test]
    fn test_fn_decl() {
        let func = FnDecl {
            name: "add".to_string(),
            params: vec![
                Param { name: "a".to_string(), ty: Some(TypeAnnotation::Named("int".to_string())) },
                Param { name: "b".to_string(), ty: Some(TypeAnnotation::Named("int".to_string())) },
            ],
            ret_ty: Some(TypeAnnotation::Named("int".to_string())),
            body: vec![Stmt::Return(Some(Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(Expr::Identifier("a".to_string())),
                right: Box::new(Expr::Identifier("b".to_string())),
            }))],
            span: Span::new(1, 1, 0),
        };
        assert_eq!(func.name, "add");
        assert_eq!(func.params.len(), 2);
        assert_eq!(func.body.len(), 1);
    }

    #[test]
    fn test_program() {
        let program = Program {
            statements: vec![
                Stmt::Let(LetDecl {
                    name: "x".to_string(),
                    ty: None,
                    value: Some(Box::new(Expr::Number(42.0))),
                    span: Span::new(1, 1, 0),
                }),
            ],
        };
        assert_eq!(program.statements.len(), 1);
    }
}
