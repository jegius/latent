//! Разбор аннотаций типов.

use super::error::ParserError;
use super::Parser;
use crate::ast::Type;
use crate::lexer::TokenType;

impl Parser {
    /// Парсинг типа
    pub(super) fn parse_type(&mut self) -> Result<Type, ParserError> {
        if self.check(&TokenType::Fn) {
            self.advance();
            self.expect(TokenType::LParen, "(")?;
            let mut params = Vec::new();
            while !self.check(&TokenType::RParen) {
                params.push(self.parse_type()?);
                if self.check(&TokenType::Comma) {
                    self.advance();
                } else {
                    break;
                }
            }
            self.expect(TokenType::RParen, ")")?;
            self.expect(TokenType::ThinArrow, "->")?;
            let ret = self.parse_type()?;
            Ok(Type::Fn(params, Box::new(ret)))
        } else if self.check(&TokenType::LBracket) {
            self.advance();
            let inner = self.parse_type()?;
            self.expect(TokenType::RBracket, "]")?;
            Ok(Type::Array(Box::new(inner)))
        } else if self.check(&TokenType::Channel) {
            // Встроенный тип канала: `channel` (аналог `channel<T>`).
            self.advance();
            Ok(Type::Named("channel".to_string()))
        } else {
            let name = self.expect_identifier()?;

            if self.check(&TokenType::Lt) {
                self.advance();
                let mut args = Vec::new();
                while !self.check(&TokenType::Gt) {
                    if let TokenType::Number(n) = self.peek().token_type {
                        args.push(Type::Named(n.to_string()));
                        self.advance();
                    } else {
                        args.push(self.parse_type()?);
                    }

                    if self.check(&TokenType::Comma) {
                        self.advance();
                    } else {
                        break;
                    }
                }
                self.expect(TokenType::Gt, ">")?;
                Ok(Type::Generic(name, args))
            } else {
                Ok(Type::Named(name))
            }
        }
    }
}