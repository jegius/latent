//! Лямбды, match-выражения и паттерны.

use super::super::error::ParserError;
use super::super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

/// Собирает свободные имена выражения: имена, не связанные `bound`.
/// Внутренние `let` и параметры вложенных лямбд добавляются в `bound`.
fn collect_free_expr(expr: &Expr, bound: &mut Vec<String>, free: &mut Vec<String>) {
    match &expr.kind {
        ExprKind::Identifier(name) => {
            if !bound.contains(name) {
                free.push(name.clone());
            }
        }
        ExprKind::Binary { left, right, .. } => {
            collect_free_expr(left, bound, free);
            collect_free_expr(right, bound, free);
        }
        ExprKind::Unary { operand, .. } => collect_free_expr(operand, bound, free),
        ExprKind::Call { callee, args } => {
            collect_free_expr(callee, bound, free);
            for a in args {
                collect_free_expr(a, bound, free);
            }
        }
        ExprKind::Index { object, index } => {
            collect_free_expr(object, bound, free);
            collect_free_expr(index, bound, free);
        }
        ExprKind::Field { object, .. } => collect_free_expr(object, bound, free),
        ExprKind::Array(elems) => {
            for e in elems {
                collect_free_expr(e, bound, free);
            }
        }
        ExprKind::Assign { target, value } => {
            collect_free_expr(target, bound, free);
            collect_free_expr(value, bound, free);
        }
        ExprKind::ChannelSend { channel, value } => {
            collect_free_expr(channel, bound, free);
            collect_free_expr(value, bound, free);
        }
        ExprKind::ChannelRecv(e) => collect_free_expr(e, bound, free),
        ExprKind::Await(e) => collect_free_expr(e, bound, free),
        ExprKind::Match { scrutinee, arms } => {
            collect_free_expr(scrutinee, bound, free);
            for arm in arms {
                collect_free_expr(&arm.body, bound, free);
            }
        }
        ExprKind::Lambda { params, body, .. } => {
            let mut inner: Vec<String> = bound.clone();
            for p in params {
                inner.push(p.name.clone());
            }
            collect_free_expr(body, &mut inner, free);
        }
        ExprKind::AiInfer { model, input } => {
            collect_free_expr(model, bound, free);
            collect_free_expr(input, bound, free);
        }
        ExprKind::AiEmbed(e) => collect_free_expr(e, bound, free),
        ExprKind::AiAgentCall { agent, input } => {
            collect_free_expr(agent, bound, free);
            collect_free_expr(input, bound, free);
        }
        _ => {}
    }
}

/// Собирает свободные имена инструкции (для `let` тело — выражение).
#[allow(dead_code)]
fn collect_free_stmt(stmt: &Stmt, bound: &mut Vec<String>, free: &mut Vec<String>) {
    match &stmt.kind {
        StmtKind::Let { name, value, .. } => {
            collect_free_expr(value, bound, free);
            bound.push(name.clone());
        }
        StmtKind::Return(Some(e)) | StmtKind::Expr(e) => collect_free_expr(e, bound, free),
        StmtKind::If { cond, then_branch, else_branch } => {
            collect_free_expr(cond, bound, free);
            for s in then_branch {
                collect_free_stmt(s, bound, free);
            }
            if let Some(eb) = else_branch {
                for s in eb {
                    collect_free_stmt(s, bound, free);
                }
            }
        }
        _ => {}
    }
}

impl Parser {
    pub(crate) fn parse_lambda(&mut self) -> Result<Expr, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Fn, "fn")?;
        self.expect(TokenType::LParen, "(")?;
        let params = self.parse_params()?;
        self.expect(TokenType::RParen, ")")?;

        let mut ret_ty = None;
        if self.check(&TokenType::ThinArrow) {
            self.advance();
            ret_ty = Some(self.parse_type()?);
        }

        let param_names: Vec<String> = params.iter().map(|p| p.name.clone()).collect();
        let mut bound: Vec<String> = param_names.clone();
        let mut free = Vec::new();

        // Блочное тело: fn(x) { ... }
        if self.check(&TokenType::LBrace) {
            self.advance();
            let block = self.parse_block()?;
            for s in &block {
                collect_free_stmt(s, &mut bound, &mut free);
            }
            free.sort();
            free.dedup();
            return Ok(Expr {
                kind: ExprKind::Lambda {
                    params,
                    ret_ty,
                    body: Box::new(Expr { kind: ExprKind::Null, pos }),
                    block: Some(block),
                    locals: free,
                },
                pos,
            });
        }

        self.expect(TokenType::Arrow, "=>")?;
        let body = self.parse_expression(0)?;

        collect_free_expr(&body, &mut bound, &mut free);
        free.sort();
        free.dedup();

        Ok(Expr {
            kind: ExprKind::Lambda {
                params,
                ret_ty,
                body: Box::new(body),
                block: None,
                locals: free,
            },
            pos,
        })
    }

    /// Парсинг match выражения
    pub(crate) fn parse_match_expr(&mut self) -> Result<Expr, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Match, "match")?;
        let scrutinee = self.parse_expression(0)?;
        self.expect(TokenType::LBrace, "{")?;

        let mut arms = Vec::new();
        while !self.check(&TokenType::RBrace) {
            let pattern = self.parse_pattern()?;
            self.expect(TokenType::Colon, ":")?;
            let body = self.parse_expression(0)?;
            arms.push(MatchArm { pattern, body: Box::new(body) });

            if self.check(&TokenType::Comma) {
                self.advance();
            } else {
                break;
            }
        }
        self.expect(TokenType::RBrace, "}")?;

        Ok(Expr {
            kind: ExprKind::Match { scrutinee: Box::new(scrutinee), arms },
            pos,
        })
    }

    /// Парсинг паттерна
    pub(crate) fn parse_pattern(&mut self) -> Result<Pattern, ParserError> {
        if self.check(&TokenType::Case) {
            self.advance();
        }

        if self.check(&TokenType::Identifier(String::new())) || self.is_identifier_like(0) {
            let name = self.expect_identifier()?;
            // `_` — wildcard-паттерн, а не идентификатор-переменная
            if name == "_" && !self.check(&TokenType::LParen) {
                Ok(Pattern::Wildcard)
            } else if self.check(&TokenType::LParen) {
                self.advance();
                let mut args = Vec::new();
                while !self.check(&TokenType::RParen) {
                    args.push(self.parse_pattern()?);
                    if self.check(&TokenType::Comma) {
                        self.advance();
                    } else {
                        break;
                    }
                }
                self.expect(TokenType::RParen, ")")?;
                Ok(Pattern::Constructor(name, args))
            } else {
                Ok(Pattern::Identifier(name))
            }
        } else if let TokenType::Number(n) = self.peek().token_type {
            let n = n;
            self.advance();
            Ok(Pattern::Literal(ExprKind::Number(n)))
        } else if let TokenType::String(s) = &self.peek().token_type {
            let s = s.clone();
            self.advance();
            Ok(Pattern::Literal(ExprKind::String(s)))
        } else if self.check(&TokenType::Default) {
            self.advance();
            Ok(Pattern::Wildcard)
        } else {
            Err(ParserError::UnexpectedToken {
                expected: "pattern".to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            })
        }
    }

    /// Парсинг `select { case v <- ch: expr, ... default: expr }` как выражения.
    pub(crate) fn parse_select_expr(&mut self) -> Result<Expr, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Select, "select")?;
        self.expect(TokenType::LBrace, "{")?;

        let mut arms = Vec::new();
        let mut default = None;

        while !self.check(&TokenType::RBrace) && !self.is_at_end() {
            if self.check(&TokenType::Case) {
                self.advance();
            }
            if self.check(&TokenType::Default) {
                self.advance();
                self.expect(TokenType::Colon, ":")?;
                default = Some(Box::new(self.parse_expression(0)?));
                if self.check(&TokenType::Comma) { self.advance(); }
                continue;
            }
            let var = if self.is_identifier_like(0)
                && self.peek_offset(1).map(|t| matches!(t.token_type, TokenType::ChannelSend)).unwrap_or(false)
            {
                Some(self.expect_identifier()?)
            } else {
                None
            };
            self.expect(TokenType::ChannelSend, "<-")?;
            let channel = self.parse_expression(0)?;
            self.expect(TokenType::Colon, ":")?;
            let body = self.parse_expression(0)?;
            arms.push((var, channel, body));
            if self.check(&TokenType::Comma) { self.advance(); } else { break; }
        }
        self.expect(TokenType::RBrace, "}")?;
        Ok(Expr {
            kind: ExprKind::SelectExpr { arms, default },
            pos,
        })
    }
}
