//! Инструкции AST и корневой узел программы.

use super::expr::{ClassField, EnumVariant, Expr, Param};
use super::expr::Type;
use crate::lexer::Position;

/// Программа — корневой узел AST.
///
/// `imports`/`exports` вынесены на уровень программы, а не в [`StmtKind`]:
/// объявления импорта живут только на верхнем уровне, а флаг `export` — это
/// модификатор объявления, который линкер снимает при сборке единого `Program`
/// (см. `crate::modules`). Однофайловый пайплайн эти поля игнорирует.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Program {
    pub statements: Vec<Stmt>,
    pub imports: Vec<ImportDecl>,
    pub exports: Vec<ExportFlag>,
}

impl Program {
    /// Программа без модульных объявлений (обычный однофайловый случай).
    pub fn new(statements: Vec<Stmt>) -> Self {
        Self { statements, imports: Vec::new(), exports: Vec::new() }
    }
}

/// Спецификатор именованного импорта: `name` либо `name as alias`.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportSpecifier {
    pub name: String,
    pub alias: Option<String>,
    pub pos: Position,
}

/// Что именно импортирует объявление.
#[derive(Debug, Clone, PartialEq)]
pub enum ImportSpecifiers {
    /// `import "./x.lat";` — подключить модуль ради побочного эффекта.
    SideEffect,
    /// `import { a, b as c } from "./x.lat";`
    Named(Vec<ImportSpecifier>),
}

/// Объявление импорта верхнего уровня.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportDecl {
    /// Путь в том виде, как он записан в исходнике (`./math.lat`).
    pub path: String,
    pub specifiers: ImportSpecifiers,
    pub pos: Position,
}

/// Флаг `export` перед top-level `fn`/`class`/`enum`.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportFlag {
    /// Имя экспортируемого объявления.
    pub name: String,
    pub pos: Position,
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