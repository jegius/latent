//! Ошибки синтаксического анализа.

use crate::lexer::{Position, TokenType};
use std::fmt;

/// Ошибки парсера
#[derive(Debug, Clone)]
pub enum ParserError {
    UnexpectedToken {
        expected: String,
        found: TokenType,
        pos: Position,
    },
    UnexpectedEOF {
        expected: String,
    },
    InvalidAssignmentTarget {
        pos: Position,
    },
}

impl fmt::Display for ParserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParserError::UnexpectedToken { expected, found, pos } => {
                write!(f, "Ошибка парсинга на строке {}:{}: ожидалось '{}', найдено {:?}",
                    pos.line, pos.column, expected, found)
            }
            ParserError::UnexpectedEOF { expected } => {
                write!(f, "Неожиданный конец файла: ожидалось '{}'", expected)
            }
            ParserError::InvalidAssignmentTarget { pos } => {
                write!(f, "Неверная цель присваивания на строке {}:{}", pos.line, pos.column)
            }
        }
    }
}