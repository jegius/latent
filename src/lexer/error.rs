//! Ошибки лексического анализа.

use super::position::Position;
use std::fmt;

/// Ошибки лексера
#[derive(Debug, Clone, PartialEq)]
pub enum LexerError {
    UnexpectedCharacter { ch: char, pos: Position },
    UnterminatedString { pos: Position },
    InvalidEscapeSequence { sequence: String, pos: Position },
    InvalidNumberFormat { text: String, pos: Position },
    UnterminatedBlockComment { pos: Position },
}

impl fmt::Display for LexerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LexerError::UnexpectedCharacter { ch, pos } => {
                write!(f, "Неожиданный символ '{}' на строке {}:{}", ch, pos.line, pos.column)
            }
            LexerError::UnterminatedString { pos } => {
                write!(f, "Незавершённая строка на строке {}:{}", pos.line, pos.column)
            }
            LexerError::InvalidEscapeSequence { sequence, pos } => {
                write!(f, "Неверная escape-последовательность '{}' на строке {}:{}", sequence, pos.line, pos.column)
            }
            LexerError::InvalidNumberFormat { text, pos } => {
                write!(f, "Неверный формат числа '{}' на строке {}:{}", text, pos.line, pos.column)
            }
            LexerError::UnterminatedBlockComment { pos } => {
                write!(f, "Незавершённый блочный комментарий на строке {}:{}", pos.line, pos.column)
            }
        }
    }
}