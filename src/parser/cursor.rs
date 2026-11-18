//! Низкоуровневые операции с потоком токенов (курсор парсера).

use super::error::ParserError;
use super::Parser;
use crate::lexer::{Token, TokenType};

impl Parser {
    /// Текущий токен (не consume)
    pub(super) fn peek(&self) -> &Token {
        &self.tokens[self.pos.min(self.tokens.len() - 1)]
    }

    /// Предыдущий токен
    pub(super) fn previous(&self) -> &Token {
        &self.tokens[(self.pos - 1).max(0)]
    }

    /// Токен на смещении `offset` от текущей позиции (не consume).
    pub(super) fn peek_offset(&self, offset: usize) -> Option<&Token> {
        self.tokens.get(self.pos + offset)
    }

    /// Достигли конца?
    pub(super) fn is_at_end(&self) -> bool {
        matches!(self.peek().token_type, TokenType::Eof)
    }

    /// Сдвинуться на один токен вперёд
    pub(super) fn advance(&mut self) -> &Token {
        if !self.is_at_end() {
            self.pos += 1;
        }
        self.previous()
    }

    /// Проверить тип текущего токена (без учёта данных внутри)
    pub(super) fn check(&self, token_type: &TokenType) -> bool {
        if self.is_at_end() {
            return false;
        }
        std::mem::discriminant(&self.peek().token_type) == std::mem::discriminant(token_type)
    }

    /// Токен на позиции `offset` может стоять в позиции имени: обычный
    /// идентификатор или «мягкое» ключевое слово (`test`, `model`, ...).
    pub(super) fn is_identifier_like(&self, offset: usize) -> bool {
        let idx = self.pos + offset;
        if idx >= self.tokens.len() {
            return false;
        }
        match &self.tokens[idx].token_type {
            TokenType::Identifier(_) => true,
            other => other.soft_keyword_lexeme().is_some(),
        }
    }

    /// Распознаёт объявление теста `test("name") { ... }` по префиксу
    /// `Test LParen String`. Позволяет отличить его от вызова функции `test(x)`
    /// и от использования `test` в качестве обычного имени.
    pub(super) fn is_test_declaration(&self) -> bool {
        if !self.check(&TokenType::Test) {
            return false;
        }
        // `test("name") { ... }` или `test "name" { ... }`
        if self.pos + 1 >= self.tokens.len() {
            return false;
        }
        if matches!(self.tokens[self.pos + 1].token_type, TokenType::String(_)) {
            return true;
        }
        if self.pos + 2 >= self.tokens.len() {
            return false;
        }
        matches!(self.tokens[self.pos + 1].token_type, TokenType::LParen)
            && matches!(self.tokens[self.pos + 2].token_type, TokenType::String(_))
    }

    /// Если текущий токен подходит — съедаем и возвращаем true
    #[allow(dead_code)]
    pub(super) fn match_token(&mut self, types: &[TokenType]) -> bool {
        for t in types {
            if self.check(t) {
                self.advance();
                return true;
            }
        }
        false
    }

    /// Ожидаем конкретный токен, иначе ошибка
    pub(super) fn expect(&mut self, token_type: TokenType, msg: &str) -> Result<(), ParserError> {
        if self.check(&token_type) {
            self.advance();
            Ok(())
        } else if self.is_at_end() {
            Err(ParserError::UnexpectedEOF {
                expected: msg.to_string(),
            })
        } else {
            Err(ParserError::UnexpectedToken {
                expected: msg.to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            })
        }
    }

    /// Ожидаем идентификатор, возвращаем его имя.
    ///
    /// «Мягкие» ключевые слова (`test`, `model`, `assert`, ...) тоже принимаются
    /// как имена: лексер помечает их особыми типами, но синтаксически они
    /// допустимы в позиции идентификатора (`let test = 5;`).
    pub(super) fn expect_identifier(&mut self) -> Result<String, ParserError> {
        let token = self.peek();
        if let TokenType::Identifier(name) = &token.token_type {
            let name = name.clone();
            self.advance();
            Ok(name)
        } else if let Some(name) = token.token_type.soft_keyword_lexeme() {
            self.advance();
            Ok(name.to_string())
        } else {
            Err(ParserError::UnexpectedToken {
                expected: "identifier".to_string(),
                found: token.token_type.clone(),
                pos: token.pos,
            })
        }
    }

    /// Ожидаем идентификатор или ключевое слово, возвращаем его имя
    pub(super) fn expect_identifier_or_keyword(&mut self) -> Result<String, ParserError> {
        let token = self.peek();
        match &token.token_type {
            TokenType::Identifier(name) => {
                let name = name.clone();
                self.advance();
                Ok(name)
            }
            other if other.soft_keyword_lexeme().is_some() => {
                let name = other.soft_keyword_lexeme().unwrap().to_string();
                self.advance();
                Ok(name)
            }
            TokenType::New => {
                self.advance();
                Ok("new".to_string())
            }
            TokenType::Ai => {
                self.advance();
                Ok("ai".to_string())
            }
            _ => Err(ParserError::UnexpectedToken {
                expected: "identifier or keyword".to_string(),
                found: token.token_type.clone(),
                pos: token.pos,
            }),
        }
    }
}