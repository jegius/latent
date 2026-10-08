//! Семантический анализатор (type checker) для языка Latent.
//!
//! Реализует алгоритм Hindley-Milner для автоматического вывода типов,
//! проверку области видимости (scope analysis) и специальную типизацию для AI-примитивов.
//!
//! Декомпозирован по зонам ответственности:
//! * [`types`] — типы и арифметика над ними (подстановки, унификация);
//! * [`environment`] — стек областей видимости;
//! * [`checker`] — структура анализатора и проверка программы;
//! * [`infer`] — вывод типов для выражений, инструкций и паттернов.

mod checker;
mod environment;
mod infer;
mod types;

pub use checker::TypeChecker;
pub use types::{apply_subst, compose_subst, unify, Substitution, Type, TypeError};

#[cfg(test)]
mod tests;