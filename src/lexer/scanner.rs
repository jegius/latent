//! Состояние сканера и базовые операции над потоком символов.

use super::error::LexerError;
use super::keywords::keyword_map;
use super::position::Position;
use super::token::{Token, TokenType};
use std::collections::HashMap;

/// Лексический анализатор: курсор по символам + таблица ключевых слов.
pub struct Lexer<'a> {
    pub(super) source: &'a str,
    pub(super) chars: std::str::Chars<'a>,
    pub(super) current: Option<char>,
    pub(super) pos: Position,
    pub(super) keywords: HashMap<String, TokenType>,
}

impl<'a> Lexer<'a> {
    pub fn new(source: &'a str) -> Self {
        let mut lexer = Self {
            source,
            chars: source.chars(),
            current: None,
            pos: Position::new(1, 1, 0),
            keywords: HashMap::new(),
        };
        lexer.keywords = keyword_map();
        lexer.advance();
        lexer
    }

    /// Сдвигает курсор на один символ, обновляя позицию.
    pub(super) fn advance(&mut self) {
        self.current = self.chars.next();
        if let Some(ch) = self.current {
            self.pos.offset += ch.len_utf8();
            if ch == '\n' {
                self.pos.line += 1;
                self.pos.column = 1;
            } else {
                self.pos.column += 1;
            }
        }
    }

    /// Текущий символ без потребления.
    pub(super) fn peek(&self) -> Option<char> {
        self.current
    }

    /// Следующий символ без потребления.
    pub(super) fn peek_next(&self) -> Option<char> {
        self.chars.clone().next()
    }

    /// Пропускает пробельные символы (включая переводы строк).
    pub(super) fn skip_whitespace(&mut self) {
        while let Some(ch) = self.peek() {
            if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
                self.advance();
            } else {
                break;
            }
        }
    }

    /// Токенизирует весь исходник до EOF.
    pub fn tokenize(&mut self) -> Result<Vec<Token>, LexerError> {
        let mut tokens = Vec::new();

        loop {
            let token = self.next_token()?;
            let is_eof = matches!(token.token_type, TokenType::Eof);
            tokens.push(token);
            if is_eof {
                break;
            }
        }

        Ok(tokens)
    }
}