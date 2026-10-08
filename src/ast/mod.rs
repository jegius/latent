//! Абстрактное синтаксическое дерево (AST) для языка Latent.
//!
//! Определяет структуры данных для представления программы после парсинга.
//!
//! Декомпозирован по зонам ответственности:
//! * [`ops`] — бинарные и унарные операторы;
//! * [`expr`] — выражения и вспомогательные узлы (параметры, поля, паттерны);
//! * [`stmt`] — инструкции и программа.

mod expr;
mod ops;
mod stmt;

pub use expr::{ClassField, EnumVariant, Expr, ExprKind, MatchArm, Param, Pattern, Type};
pub use ops::{BinaryOp, UnaryOp};
pub use stmt::{Program, SelectArm, Stmt, StmtKind};

#[cfg(test)]
mod tests;