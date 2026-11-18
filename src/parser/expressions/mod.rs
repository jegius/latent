//! Pratt parser выражений, лямбды и pattern matching.
//!
//! Декомпозирован по зонам ответственности:
//! * [`core`] — точка входа и категории операторов (Pratt);
//! * [`prefix`] — первичные операнды;
//! * [`postfix`] — вызовы, индексация, поля;
//! * [`lambda_match`] — лямбды, match и паттерны.

mod core;
mod lambda_match;
mod postfix;
mod prefix;
