//! Синтаксический анализатор (parser) для языка Latent.
//!
//! Превращает поток токенов в AST (абстрактное синтаксическое дерево).
//! Использует рекурсивный спуск для инструкций и Pratt parser для выражений.
//!
//! Декомпозирован по зонам ответственности:
//! * [`error`] — ошибки парсинга;
//! * [`cursor`] — низкоуровневая работа с потоком токенов;
//! * [`declarations`] — объявления верхнего уровня (let, fn, class, decorator, test);
//! * [`statements`] — инструкции внутри блоков (if/while/for/return/spawn/match);
//! * [`type_parser`] — разбор аннотаций типов;
//! * [`expressions`] — Pratt parser выражений, лямбды и pattern matching.

mod cursor;
mod declarations;
mod error;
mod expressions;
mod statements;
mod type_parser;

pub use error::ParserError;

use crate::ast::Program;
use crate::lexer::{Token, TokenType};

/// Синтаксический анализатор
pub struct Parser {
    pub(super) tokens: Vec<Token>,
    pub(super) pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        // Комментарии — часть лексического потока, но не грамматики: убираем их
        // до парсинга, иначе ведущий `// ...` валит разбор (§7.1).
        let tokens: Vec<Token> = tokens
            .into_iter()
            .filter(|t| !matches!(t.token_type, TokenType::Comment(_)))
            .collect();
        Self { tokens, pos: 0 }
    }

    /// Точка входа — парсинг всей программы.
    pub fn parse(&mut self) -> Result<Program, ParserError> {
        let mut statements = Vec::new();
        while !self.is_at_end() {
            statements.push(self.parse_declaration()?);
        }
        Ok(Program { statements })
    }
}

#[cfg(test)]
mod tests;