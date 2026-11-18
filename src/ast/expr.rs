//! Выражения AST и вспомогательные узлы (параметры, поля, паттерны, типы).

use super::ops::{BinaryOp, UnaryOp};
use crate::lexer::Position;

/// Выражение (expression)
#[derive(Debug, Clone, PartialEq)]
pub struct Expr {
    pub kind: ExprKind,
    pub pos: Position,
}

/// Типы выражений
#[derive(Debug, Clone, PartialEq)]
pub enum ExprKind {
    Number(f64),
    String(String),
    Bool(bool),
    Null,
    Identifier(String),

    /// a + b, a == b, a && b
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },

    /// -a, !a
    Unary {
        op: UnaryOp,
        operand: Box<Expr>,
    },

    /// foo(a, b)
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
    },

    /// arr[0]
    Index {
        object: Box<Expr>,
        index: Box<Expr>,
    },

    /// obj.field
    Field {
        object: Box<Expr>,
        field: String,
    },

    /// fn(x) => x * 2  ИЛИ  fn(x) { ...stmts... }
    Lambda {
        params: Vec<Param>,
        ret_ty: Option<Type>,
        /// Выражение-тело для формы `=> expr`.
        body: Box<Expr>,
        /// Блочное тело для формы `{ stmts }` (тогда `body` = Null).
        block: Option<Vec<super::stmt::Stmt>>,
        /// Свободные переменные, захваченные из окружающего scope
        /// (вычислено парсером лексически по enclosing-функции).
        locals: Vec<String>,
    },

    /// [1, 2, 3]
    Array(Vec<Expr>),

    /// target = value
    Assign {
        target: Box<Expr>,
        value: Box<Expr>,
    },

    /// ch <- value (send to channel)
    ChannelSend {
        channel: Box<Expr>,
        value: Box<Expr>,
    },

    /// <-ch (receive from channel)
    ChannelRecv(Box<Expr>),

    /// match x { case ... }
    Match {
        scrutinee: Box<Expr>,
        arms: Vec<MatchArm>,
    },

    /// select { case v <- ch: expr ... default: expr } — как выражение.
    SelectExpr {
        arms: Vec<(Option<String>, Expr, Expr)>,
        default: Option<Box<Expr>>,
    },

    /// await expr
    Await(Box<Expr>),

    /// AI-примитивы
    AiLoad(String),
    AiInfer {
        model: Box<Expr>,
        input: Box<Expr>,
    },
    AiEmbed(Box<Expr>),
    AiAgent {
        name: String,
        config: Vec<(String, Expr)>,
    },
    AiAgentCall {
        agent: Box<Expr>,
        input: Box<Expr>,
    },
    AiGenerate {
        prompt: String,
    },
}

/// Параметр функции
#[derive(Debug, Clone, PartialEq)]
pub struct Param {
    pub name: String,
    pub ty: Option<Type>,
}

/// Поле класса
#[derive(Debug, Clone, PartialEq)]
pub struct ClassField {
    pub name: String,
    pub ty: Option<Type>,
}

/// Вариант enum-объявления: `Name` или `Name(T1, T2, ...)`.
#[derive(Debug, Clone, PartialEq)]
pub struct EnumVariant {
    pub name: String,
    pub fields: Vec<Type>,
}

/// Ветка pattern matching
#[derive(Debug, Clone, PartialEq)]
pub struct MatchArm {
    pub pattern: Pattern,
    pub body: Box<Expr>,
}

/// Паттерн для match
#[derive(Debug, Clone, PartialEq)]
pub enum Pattern {
    Wildcard,
    Literal(ExprKind),
    Identifier(String),
    Constructor(String, Vec<Pattern>),
}

/// Тип
#[derive(Debug, Clone, PartialEq)]
pub enum Type {
    Named(String),
    Array(Box<Type>),
    Fn(Vec<Type>, Box<Type>),
    Union(Vec<Type>),
    Generic(String, Vec<Type>),
    Unit,
}