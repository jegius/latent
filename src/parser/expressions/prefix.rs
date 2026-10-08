//! Разбор префиксных (первичных) операндов выражения.

use super::super::error::ParserError;
use super::super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

impl Parser {
    pub(crate) fn parse_prefix(&mut self, pos: crate::lexer::Position) -> Result<Expr, ParserError> {
        match &self.peek().token_type {
            TokenType::Number(n) => {
                let n = *n;
                self.advance();
                Ok(Expr { kind: ExprKind::Number(n), pos })
            }
            TokenType::String(s) => {
                let s = s.clone();
                self.advance();
                Ok(Expr { kind: ExprKind::String(s), pos })
            }
            TokenType::Bool(b) => {
                let b = *b;
                self.advance();
                Ok(Expr { kind: ExprKind::Bool(b), pos })
            }
            TokenType::Null => {
                self.advance();
                Ok(Expr { kind: ExprKind::Null, pos })
            }
            TokenType::Identifier(name) if name == "ai_generate" => {
                self.advance();
                self.expect(TokenType::Not, "!")?;
                self.expect(TokenType::LParen, "(")?;
                let prompt = self.expect_string_literal()?;
                self.expect(TokenType::RParen, ")")?;
                Ok(Expr { kind: ExprKind::AiGenerate { prompt }, pos })
            }
            TokenType::Identifier(name) => {
                let name = name.clone();
                self.advance();
                Ok(Expr { kind: ExprKind::Identifier(name), pos })
            }
            // «Мягкие» ключевые слова допустимы как имена: `print(test)`,
            // `fn model() {}`, `obj.agent`. Лексер помечает их отдельными
            // типами, но в позиции операнда это обычные идентификаторы.
            other if other.soft_keyword_lexeme().is_some() => {
                let name = other.soft_keyword_lexeme().unwrap().to_string();
                self.advance();
                Ok(Expr { kind: ExprKind::Identifier(name), pos })
            }
            TokenType::Ai => {
                self.advance();
                Ok(Expr { kind: ExprKind::Identifier("ai".to_string()), pos })
            }
            TokenType::Channel => {
                self.advance();
                // channel<T>() — вызов с generic параметром
                if self.check(&TokenType::Lt) {
                    self.advance(); // consume '<'
                    let _ty = self.parse_type()?;
                    self.expect(TokenType::Gt, ">")?;
                }
                self.expect(TokenType::LParen, "(")?;
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
                Ok(Expr {
                    kind: ExprKind::Call {
                        callee: Box::new(Expr { kind: ExprKind::Identifier("channel".to_string()), pos }),
                        args,
                    },
                    pos,
                })
            }
            TokenType::Async => {
                self.advance();
                Ok(Expr { kind: ExprKind::Identifier("async".to_string()), pos })
            }
            TokenType::This => {
                self.advance();
                Ok(Expr { kind: ExprKind::Identifier("this".to_string()), pos })
            }
            TokenType::New => {
                // `new Class(...)` → callee-идентификатор "new Class".
                self.advance();
                let class_name = self.expect_identifier()?;
                Ok(Expr {
                    kind: ExprKind::Identifier(format!("new {}", class_name)),
                    pos,
                })
            }
            TokenType::Assert => {
                self.advance();
                Ok(Expr { kind: ExprKind::Identifier("assert".to_string()), pos })
            }
            TokenType::Minus => {
                self.advance();
                let rhs = self.parse_expression(95)?;
                Ok(Expr {
                    kind: ExprKind::Unary { op: UnaryOp::Neg, operand: Box::new(rhs) },
                    pos,
                })
            }
            TokenType::Not => {
                self.advance();
                let rhs = self.parse_expression(95)?;
                Ok(Expr {
                    kind: ExprKind::Unary { op: UnaryOp::Not, operand: Box::new(rhs) },
                    pos,
                })
            }
            TokenType::ChannelSend => {
                self.advance();
                let ch = self.parse_expression(95)?;
                Ok(Expr { kind: ExprKind::ChannelRecv(Box::new(ch)), pos })
            }
            TokenType::Await => {
                self.advance();
                let expr = self.parse_expression(95)?;
                Ok(Expr { kind: ExprKind::Await(Box::new(expr)), pos })
            }
            TokenType::LParen => {
                self.advance();
                let expr = self.parse_expression(0)?;
                self.expect(TokenType::RParen, ")")?;
                Ok(expr)
            }
            TokenType::LBracket => {
                self.advance();
                let mut elements = Vec::new();
                while !self.check(&TokenType::RBracket) {
                    elements.push(self.parse_expression(0)?);
                    if self.check(&TokenType::Comma) {
                        self.advance();
                    } else {
                        break;
                    }
                }
                self.expect(TokenType::RBracket, "]")?;
                Ok(Expr { kind: ExprKind::Array(elements), pos })
            }
            TokenType::Fn => self.parse_lambda(),
            TokenType::Match => self.parse_match_expr(),
            TokenType::Select => self.parse_select_expr(),
            _ => Err(ParserError::UnexpectedToken {
                expected: "expression".to_string(),
                found: self.peek().token_type.clone(),
                pos,
            }),
        }
    }
}
