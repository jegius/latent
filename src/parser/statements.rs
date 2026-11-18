//! Разбор инструкций внутри блоков.

use super::error::ParserError;
use super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

impl Parser {
    /// Парсинг инструкции внутри блока
    pub(super) fn parse_statement(&mut self) -> Result<Stmt, ParserError> {
        if self.check(&TokenType::If) {
            self.parse_if()
        } else if self.check(&TokenType::While) {
            self.parse_while()
        } else if self.check(&TokenType::For) {
            self.parse_for()
        } else if self.check(&TokenType::Return) {
            self.parse_return()
        } else if self.check(&TokenType::Spawn) {
            self.parse_spawn()
        } else if self.check(&TokenType::Match) {
            self.parse_match_statement()
        } else if self.check(&TokenType::Select) {
            self.parse_select()
        } else if self.check(&TokenType::Yield) {
            self.parse_yield()
        } else {
            self.parse_expr_statement()
        }
    }

    /// Парсинг if
    fn parse_if(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::If, "if")?;
        self.expect(TokenType::LParen, "(")?;
        let cond = self.parse_expression(0)?;
        self.expect(TokenType::RParen, ")")?;

        self.expect(TokenType::LBrace, "{")?;
        let then_branch = self.parse_block()?;

        let else_branch = if self.check(&TokenType::Else) {
            self.advance();
            if self.check(&TokenType::If) {
                // else if (...) { ... } — рекурсивно разбираем как вложенный if
                let nested = self.parse_if()?;
                Some(vec![nested])
            } else {
                self.expect(TokenType::LBrace, "{")?;
                Some(self.parse_block()?)
            }
        } else {
            None
        };

        Ok(Stmt {
            kind: StmtKind::If { cond, then_branch, else_branch },
            pos,
        })
    }

    /// Парсинг while
    fn parse_while(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::While, "while")?;
        self.expect(TokenType::LParen, "(")?;
        let cond = self.parse_expression(0)?;
        self.expect(TokenType::RParen, ")")?;
        self.expect(TokenType::LBrace, "{")?;
        let body = self.parse_block()?;

        Ok(Stmt {
            kind: StmtKind::While { cond, body },
            pos,
        })
    }

    /// Парсинг for — поддерживает две формы:
    ///   for (let x in arr) { ... }        — итерация по коллекции
    ///   for (let i = 0; i < n; i = i + 1) — C-стиль с init/cond/step
    fn parse_for(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::For, "for")?;
        self.expect(TokenType::LParen, "(")?;

        // Различаем формы по наличию `in` после переменной.
        // Смотрим вперёд: for ( let IDENT in ...
        let is_c_style = if self.check(&TokenType::Let) {
            // let IDENT
            let mut look = self.pos + 1;
            if look < self.tokens.len() && self.is_identifier_like(1) {
                look += 1;
                // необязательная аннотация типа : T
                if look < self.tokens.len()
                    && matches!(self.tokens[look].token_type, TokenType::Colon) {
                    // пропускаем тип до `in`/`=`
                    while look < self.tokens.len()
                        && !matches!(self.tokens[look].token_type,
                            TokenType::In | TokenType::Assign | TokenType::Semicolon) {
                        look += 1;
                    }
                }
                !(look < self.tokens.len()
                    && matches!(self.tokens[look].token_type, TokenType::In))
            } else {
                false
            }
        } else {
            true
        };

        if is_c_style {
            let init = if self.check(&TokenType::Semicolon) {
                None
            } else if self.check(&TokenType::Let) {
                Some(Box::new(self.parse_let()?))
            } else {
                let e = self.parse_expression(0)?;
                self.expect(TokenType::Semicolon, ";")?;
                Some(Box::new(Stmt { kind: StmtKind::Expr(e), pos }))
            };
            if init.is_none() {
                self.expect(TokenType::Semicolon, ";")?;
            }

            let cond = if self.check(&TokenType::Semicolon) {
                None
            } else {
                Some(self.parse_expression(0)?)
            };
            self.expect(TokenType::Semicolon, ";")?;

            let step = if self.check(&TokenType::RParen) {
                None
            } else {
                Some(self.parse_expression(0)?)
            };
            self.expect(TokenType::RParen, ")")?;
            self.expect(TokenType::LBrace, "{")?;
            let body = self.parse_block()?;
            return Ok(Stmt {
                kind: StmtKind::ForC { init, cond, step, body },
                pos,
            });
        }

        self.expect(TokenType::Let, "let")?;
        let var = self.expect_identifier()?;
        // необязательная аннотация типа
        if self.check(&TokenType::Colon) {
            self.advance();
            let _ = self.parse_type()?;
        }
        self.expect(TokenType::In, "in")?;
        let iterable = self.parse_expression(0)?;
        self.expect(TokenType::RParen, ")")?;
        self.expect(TokenType::LBrace, "{")?;
        let body = self.parse_block()?;

        Ok(Stmt {
            kind: StmtKind::For { var, iterable, body },
            pos,
        })
    }

    /// Парсинг return
    fn parse_return(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Return, "return")?;
        let value = if self.check(&TokenType::Semicolon) {
            None
        } else {
            Some(self.parse_expression(0)?)
        };
        self.expect(TokenType::Semicolon, ";")?;
        Ok(Stmt {
            kind: StmtKind::Return(value),
            pos,
        })
    }

    /// Парсинг spawn
    fn parse_spawn(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Spawn, "spawn")?;
        if self.check(&TokenType::LBrace) {
            self.advance();
            let body = self.parse_block()?;
            if self.check(&TokenType::Semicolon) {
                self.advance();
            }
            return Ok(Stmt { kind: StmtKind::Spawn(body), pos });
        }
        // Форма `spawn func(args);` — вызов функции как отдельная горутина.
        let call = self.parse_expression(0)?;
        if self.check(&TokenType::Semicolon) {
            self.advance();
        }
        Ok(Stmt { kind: StmtKind::Spawn(vec![Stmt { kind: StmtKind::Expr(call), pos }]), pos })
    }

    /// Парсинг match как инструкции
    fn parse_match_statement(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        let expr = self.parse_match_expr()?;
        self.expect(TokenType::Semicolon, ";")?;
        Ok(Stmt {
            kind: StmtKind::Expr(expr),
            pos,
        })
    }

    /// Парсинг выражения как инструкции
    fn parse_expr_statement(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        let expr = self.parse_expression(0)?;
        self.expect(TokenType::Semicolon, ";")?;
        Ok(Stmt {
            kind: StmtKind::Expr(expr),
            pos,
        })
    }

    /// Парсинг `select { case v <- ch: { ... } default: { ... } }`.
    fn parse_select(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Select, "select")?;
        self.expect(TokenType::LBrace, "{")?;

        let mut arms = Vec::new();
        let mut default_branch = None;

        while !self.check(&TokenType::RBrace) && !self.is_at_end() {
            // `case` необязателен (совместимо с `default:` без case)
            if self.check(&TokenType::Case) {
                self.advance();
            }
            if self.check(&TokenType::Default) {
                self.advance();
                self.expect(TokenType::Colon, ":")?;
                self.expect(TokenType::LBrace, "{")?;
                default_branch = Some(self.parse_block()?);
                continue;
            }
            // var <- channel
            let var = if self.is_identifier_like(0)
                && self.peek_offset(1).map(|t| matches!(t.token_type, TokenType::ChannelSend)).unwrap_or(false)
            {
                let name = self.expect_identifier()?;
                Some(name)
            } else {
                None
            };
            self.expect(TokenType::ChannelSend, "<-")?;
            let channel = self.parse_expression(0)?;
            self.expect(TokenType::Colon, ":")?;
            self.expect(TokenType::LBrace, "{")?;
            let body = self.parse_block()?;
            arms.push(SelectArm { var, channel, body });
        }
        self.expect(TokenType::RBrace, "}")?;
        if self.check(&TokenType::Semicolon) {
            self.advance();
        }
        Ok(Stmt { kind: StmtKind::Select { arms, default_branch }, pos })
    }

    /// Парсинг `yield;`.
    fn parse_yield(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Yield, "yield")?;
        self.expect(TokenType::Semicolon, ";")?;
        Ok(Stmt { kind: StmtKind::Yield, pos })
    }
}