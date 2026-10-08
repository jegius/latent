//! Инструкции AST и корневой узел программы.

use super::expr::{ClassField, EnumVariant, Expr, Param};
use super::expr::Type;
use crate::lexer::Position;

/// Программа — корневой узел AST
#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub statements: Vec<Stmt>,
}

/// Инструкция (statement)
#[derive(Debug, Clone, PartialEq)]
pub struct Stmt {
    pub kind: StmtKind,
    pub pos: Position,
}

/// Ветка `select`: `case var <- channel: { body }`.
#[derive(Debug, Clone, PartialEq)]
pub struct SelectArm {
    pub var: Option<String>,
    pub channel: Expr,
    pub body: Vec<Stmt>,
}

/// Типы инструкций
#[derive(Debug, Clone, PartialEq)]
pub enum StmtKind {
    /// let name: Type = value;
    Let {
        name: String,
        ty: Option<Type>,
        value: Expr,
    },

    /// fn name(params) -> Type { body }
    Fn {
        name: String,
        params: Vec<Param>,
        ret_ty: Option<Type>,
        body: Vec<Stmt>,
        is_async: bool,
    },

    /// select { case v <- ch: { ... } default: { ... } }
    Select {
        arms: Vec<SelectArm>,
        default_branch: Option<Vec<Stmt>>,
    },

    /// yield; — уступить планировщику
    Yield,

    /// class Name { fields... methods... }
    Class {
        name: String,
        fields: Vec<ClassField>,
        methods: Vec<Stmt>,
    },

    /// enum Name { Variant, Variant(T, ...), }
    Enum {
        name: String,
        variants: Vec<EnumVariant>,
    },

    /// if (cond) { ... } else { ... }
    If {
        cond: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Option<Vec<Stmt>>,
    },

    /// while (cond) { ... }
    While {
        cond: Expr,
        body: Vec<Stmt>,
    },

    /// for (let var in iterable) { ... }
    For {
        var: String,
        iterable: Expr,
        body: Vec<Stmt>,
    },

    /// C-стиль: for (init; cond; step) { ... }
    /// `init` — обычно let, но может быть присваиванием или пустым.
    ForC {
        init: Option<Box<Stmt>>,
        cond: Option<Expr>,
        step: Option<Expr>,
        body: Vec<Stmt>,
    },

    /// return value;
    Return(Option<Expr>),

    /// spawn { ... }
    Spawn(Vec<Stmt>),

    /// @decorator(args) target
    Decorator {
        name: String,
        args: Vec<Expr>,
        target: Box<Stmt>,
    },

    /// @test("name") { ... }
    Test {
        name: String,
        body: Vec<Stmt>,
    },

    /// ai_generate!("prompt")
    AiGenerate {
        prompt: String,
    },

    /// expression as statement: foo();
    Expr(Expr),
}