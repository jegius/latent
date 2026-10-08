//! Разбор постфиксных операторов (вызов, индексация, доступ к полю).

use super::super::error::ParserError;
use super::super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

impl Parser {
    pub(crate) fn parse_postfix(&mut self, lhs: &mut Expr) -> Result<bool, ParserError> {
        match &self.peek().token_type {
            TokenType::LParen => {
                self.advance();
                let mut args = Vec::new();
                while !self.check(&TokenType::RParen) {
                    args.push(self.parse_expression(0)?);
                    if self.check(&TokenType::Comma) {
                        self.advance();
                    } else {
                        break;
                    }
                }
                self.expect(TokenType::RParen, ")")?;
                let lhs_pos = lhs.pos;
                *lhs = Expr {
                    kind: ExprKind::Call {
                        callee: Box::new(lhs.clone()),
                        args,
                    },
                    pos: lhs_pos,
                };
                Ok(true)
            }
            TokenType::LBracket => {
                self.advance();
                let index = self.parse_expression(0)?;
                self.expect(TokenType::RBracket, "]")?;
                let lhs_pos = lhs.pos;
                *lhs = Expr {
                    kind: ExprKind::Index {
                        object: Box::new(lhs.clone()),
                        index: Box::new(index),
                    },
                    pos: lhs_pos,
                };
                Ok(true)
            }
            TokenType::Dot => {
                self.advance();
                let field = self.expect_identifier()?;
                let lhs_pos = lhs.pos;
                *lhs = Expr {
                    kind: ExprKind::Field {
                        object: Box::new(lhs.clone()),
                        field,
                    },
                    pos: lhs_pos,
                };
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// Ожидает строковый литерал, иначе ошибка.
    pub(crate) fn expect_string_literal(&mut self) -> Result<String, ParserError> {
        if let TokenType::String(s) = &self.peek().token_type {
            let s = s.clone();
            self.advance();
            Ok(s)
        } else {
            Err(ParserError::UnexpectedToken {
                expected: "string literal".to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            })
        }
    }
}
