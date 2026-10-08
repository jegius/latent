//! Функциональное программирование для языка Latent.
//!
//! Реализует closures, monads (Result, Option, Promise) и pattern matching.
//!
//! Декомпозирован по зонам ответственности:
//! * [`value`] — значение FP;
//! * [`closure`] — замыкание и конвертация замыканий;
//! * [`monads`] — Result, Option, Promise;
//! * [`persistent`] — persistent vector;
//! * [`pattern`] — pattern matching.

mod closure;
mod monads;
mod pattern;
mod persistent;
mod value;

pub use closure::{Closure, ClosureConverter};
pub use monads::{OptionType, Promise, Result};
pub use pattern::{match_pattern, MatchResult, Pattern};
pub use persistent::PersistentVector;
pub use value::Value;

#[cfg(test)]
mod tests;