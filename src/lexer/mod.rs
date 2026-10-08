//! Лексический анализатор (lexer) для языка Latent.
//!
//! Превращает исходный код в последовательность токенов.
//! Реализован как конечный автомат (FSM) с отслеживанием позиций.
//!
//! Модуль декомпозирован по зонам ответственности:
//! * [`position`] — координаты в исходном коде;
//! * [`token`] — типы и структура лексем;
//! * [`error`] — ошибки лексинга;
//! * [`keywords`] — таблица ключевых слов;
//! * [`scanner`] — состояние сканера и базовые операции;
//! * [`next_token`] — разбор одного токена (диспетчер);
//! * [`readers`] — чтение чисел/строк/идентификаторов/комментариев.

mod error;
mod keywords;
mod next_token;
mod position;
mod readers;
mod scanner;
mod token;

pub use error::LexerError;
pub use position::Position;
pub use scanner::Lexer;
pub use token::{Token, TokenType};

#[cfg(test)]
mod tests;