//! Разбор объявлений верхнего уровня и их вспомогательных элементов.

use super::error::ParserError;
use super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

impl Parser {
    /// Парсинг объявления верхнего уровня
    pub(super) fn parse_declaration(&mut self) -> Result<Stmt, ParserError> {
        if self.check(&TokenType::At) {
            self.parse_decorator()
        } else if self.is_test_declaration() {
            self.parse_test()
        } else if self.check(&TokenType::Let) {
            self.parse_let()
        } else if self.check(&TokenType::Async) {
            // parse_fn сам распознаёт и съедает `async`, выставляя is_async.
            self.parse_fn()
        } else if self.check(&TokenType::Fn) {
            self.parse_fn()
        } else if self.check(&TokenType::Class) {
            self.parse_class()
        } else if self.check(&TokenType::Enum) {
            self.parse_enum()
        } else {
            self.parse_statement()
        }
    }

    /// Парсинг let
    pub(super) fn parse_let(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Let, "let")?;

        let name = self.expect_identifier()?;

        let mut ty = None;
        if self.check(&TokenType::Colon) {
            self.advance();
            ty = Some(self.parse_type()?);
        }

        self.expect(TokenType::Assign, "=")?;
        let value = self.parse_expression(0)?;
        self.expect(TokenType::Semicolon, ";")?;

        Ok(Stmt {
            kind: StmtKind::Let { name, ty, value },
            pos,
        })
    }

    /// Парсинг функции
    pub(super) fn parse_fn(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        // Поддержка async fn
        let is_async = if self.check(&TokenType::Async) {
            self.advance();
            true
        } else {
            false
        };
        self.expect(TokenType::Fn, "fn")?;
        let name = self.expect_identifier_or_keyword()?;

        self.expect(TokenType::LParen, "(")?;
        let params = self.parse_params()?;
        self.expect(TokenType::RParen, ")")?;

        let mut ret_ty = None;
        if self.check(&TokenType::ThinArrow) {
            self.advance();
            ret_ty = Some(self.parse_type()?);
        }

        self.expect(TokenType::LBrace, "{")?;
        let body = self.parse_block()?;

        Ok(Stmt {
            kind: StmtKind::Fn { name, params, ret_ty, body, is_async },
            pos,
        })
    }

    /// Парсинг параметров функции
    pub(super) fn parse_params(&mut self) -> Result<Vec<Param>, ParserError> {
        let mut params = Vec::new();

        while !self.check(&TokenType::RParen) {
            let name = self.expect_identifier()?;

            let mut ty = None;
            if self.check(&TokenType::Colon) {
                self.advance();
                ty = Some(self.parse_type()?);
            }

            params.push(Param { name, ty });

            if self.check(&TokenType::Comma) {
                self.advance();
            } else {
                break;
            }
        }

        Ok(params)
    }

    /// Парсинг блока { ... }
    pub(super) fn parse_block(&mut self) -> Result<Vec<Stmt>, ParserError> {
        let mut stmts = Vec::new();
        while !self.check(&TokenType::RBrace) && !self.is_at_end() {
            stmts.push(self.parse_declaration()?);
        }
        self.expect(TokenType::RBrace, "}")?;
        Ok(stmts)
    }

    /// Парсинг декоратора
    fn parse_decorator(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::At, "@")?;
        let name = self.expect_identifier_or_keyword()?;

        let mut args = Vec::new();
        if self.check(&TokenType::LParen) {
            self.advance();
            while !self.check(&TokenType::RParen) {
                args.push(self.parse_expression(0)?);
                if self.check(&TokenType::Comma) {
                    self.advance();
                } else {
                    break;
                }
            }
            self.expect(TokenType::RParen, ")")?;
        }

        let target = Box::new(self.parse_declaration()?);

        Ok(Stmt {
            kind: StmtKind::Decorator { name, args, target },
            pos,
        })
    }

    /// Парсинг test
    fn parse_test(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Test, "test")?;

        // Поддержка как `test("name")`, так и `test "name"`.
        let has_paren = self.check(&TokenType::LParen);
        if has_paren {
            self.advance();
        }
        let name = if let TokenType::String(s) = &self.peek().token_type {
            let s = s.clone();
            self.advance();
            s
        } else {
            return Err(ParserError::UnexpectedToken {
                expected: "string literal".to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            });
        };
        if has_paren {
            self.expect(TokenType::RParen, ")")?;
        }
        self.expect(TokenType::LBrace, "{")?;
        let body = self.parse_block()?;

        Ok(Stmt {
            kind: StmtKind::Test { name, body },
            pos,
        })
    }

    /// Парсинг класса
    fn parse_class(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Class, "class")?;
        let name = self.expect_identifier()?;

        self.expect(TokenType::LBrace, "{")?;

        let mut fields = Vec::new();
        let mut methods = Vec::new();

        while !self.check(&TokenType::RBrace) && !self.is_at_end() {
            if self.check(&TokenType::Fn) {
                methods.push(self.parse_fn()?);
            } else {
                let field_name = self.expect_identifier_or_keyword()?;
                let mut ty = None;
                if self.check(&TokenType::Colon) {
                    self.advance();
                    ty = Some(self.parse_type()?);
                }
                self.expect(TokenType::Semicolon, ";")?;
                fields.push(ClassField { name: field_name, ty });
            }
        }

        self.expect(TokenType::RBrace, "}")?;

        Ok(Stmt {
            kind: StmtKind::Class { name, fields, methods },
            pos,
        })
    }

    /// Парсинг `enum Name { Variant, Variant(T, ...), }`.
    fn parse_enum(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Enum, "enum")?;
        let name = self.expect_identifier()?;
        self.expect(TokenType::LBrace, "{")?;

        let mut variants = Vec::new();
        while !self.check(&TokenType::RBrace) && !self.is_at_end() {
            let variant_name = self.expect_identifier()?;
            let mut fields = Vec::new();
            if self.check(&TokenType::LParen) {
                self.advance();
                while !self.check(&TokenType::RParen) {
                    fields.push(self.parse_type()?);
                    if self.check(&TokenType::Comma) {
                        self.advance();
                    } else {
                        break;
                    }
                }
                self.expect(TokenType::RParen, ")")?;
            }
            variants.push(EnumVariant { name: variant_name, fields });

            if self.check(&TokenType::Comma) {
                self.advance();
            } else {
                break;
            }
        }

        self.expect(TokenType::RBrace, "}")?;
        Ok(Stmt {
            kind: StmtKind::Enum { name, variants },
            pos,
        })
    }
}