//! Синтаксический анализатор (parser) для языка Latent.
//!
//! Превращает поток токенов в AST (абстрактное синтаксическое дерево).
//! Использует рекурсивный спуск для инструкций и Pratt parser для выражений.

use crate::ast::*;
use crate::lexer::{Position, Token, TokenType};
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

/// Синтаксический анализатор
pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    /// Текущий токен (не consume)
    fn peek(&self) -> &Token {
        &self.tokens[self.pos.min(self.tokens.len() - 1)]
    }

    /// Предыдущий токен
    fn previous(&self) -> &Token {
        &self.tokens[(self.pos - 1).max(0)]
    }

    /// Достигли конца?
    fn is_at_end(&self) -> bool {
        matches!(self.peek().token_type, TokenType::Eof)
    }

    /// Сдвинуться на один токен вперёд
    fn advance(&mut self) -> &Token {
        if !self.is_at_end() {
            self.pos += 1;
        }
        self.previous()
    }

    /// Проверить тип текущего токена (без учёта данных внутри)
    fn check(&self, token_type: &TokenType) -> bool {
        if self.is_at_end() {
            return false;
        }
        std::mem::discriminant(&self.peek().token_type) == std::mem::discriminant(token_type)
    }

    /// Если текущий токен подходит — съедаем и возвращаем true
    fn match_token(&mut self, types: &[TokenType]) -> bool {
        for t in types {
            if self.check(t) {
                self.advance();
                return true;
            }
        }
        false
    }

    /// Ожидаем конкретный токен, иначе ошибка
    fn expect(&mut self, token_type: TokenType, msg: &str) -> Result<(), ParserError> {
        if self.check(&token_type) {
            self.advance();
            Ok(())
        } else {
            Err(ParserError::UnexpectedToken {
                expected: msg.to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            })
        }
    }

    /// Ожидаем идентификатор, возвращаем его имя
    fn expect_identifier(&mut self) -> Result<String, ParserError> {
        let token = self.peek();
        if let TokenType::Identifier(name) = &token.token_type {
            let name = name.clone();
            self.advance();
            Ok(name)
        } else {
            Err(ParserError::UnexpectedToken {
                expected: "identifier".to_string(),
                found: token.token_type.clone(),
                pos: token.pos,
            })
        }
    }

    /// Ожидаем идентификатор или ключевое слово, возвращаем его имя
    fn expect_identifier_or_keyword(&mut self) -> Result<String, ParserError> {
        let token = self.peek();
        match &token.token_type {
            TokenType::Identifier(name) => {
                let name = name.clone();
                self.advance();
                Ok(name)
            }
            TokenType::Test => {
                self.advance();
                Ok("test".to_string())
            }
            TokenType::New => {
                self.advance();
                Ok("new".to_string())
            }
            TokenType::Ai => {
                self.advance();
                Ok("ai".to_string())
            }
            TokenType::Case => {
                self.advance();
                Ok("case".to_string())
            }
            _ => Err(ParserError::UnexpectedToken {
                expected: "identifier or keyword".to_string(),
                found: token.token_type.clone(),
                pos: token.pos,
            }),
        }
    }

    /// Точка входа — парсинг всей программы
    pub fn parse(&mut self) -> Result<Program, ParserError> {
        let mut statements = Vec::new();
        while !self.is_at_end() {
            statements.push(self.parse_declaration()?);
        }
        Ok(Program { statements })
    }

    /// Парсинг объявления верхнего уровня
    fn parse_declaration(&mut self) -> Result<Stmt, ParserError> {
        if self.check(&TokenType::At) {
            self.parse_decorator()
        } else if self.check(&TokenType::Let) {
            self.parse_let()
        } else if self.check(&TokenType::Fn) {
            self.parse_fn()
        } else if self.check(&TokenType::Class) {
            self.parse_class()
        } else if self.check(&TokenType::Test) {
            self.parse_test()
        } else {
            self.parse_statement()
        }
    }

    /// Парсинг инструкции внутри блока
    fn parse_statement(&mut self) -> Result<Stmt, ParserError> {
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
        } else {
            self.parse_expr_statement()
        }
    }

    /// Парсинг let
    fn parse_let(&mut self) -> Result<Stmt, ParserError> {
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
    fn parse_fn(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
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
            kind: StmtKind::Fn { name, params, ret_ty, body },
            pos,
        })
    }

    /// Парсинг параметров функции
    fn parse_params(&mut self) -> Result<Vec<Param>, ParserError> {
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
    fn parse_block(&mut self) -> Result<Vec<Stmt>, ParserError> {
        let mut stmts = Vec::new();
        while !self.check(&TokenType::RBrace) && !self.is_at_end() {
            stmts.push(self.parse_declaration()?);
        }
        self.expect(TokenType::RBrace, "}")?;
        Ok(stmts)
    }

    /// Парсинг типа
    fn parse_type(&mut self) -> Result<Type, ParserError> {
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
            self.expect(TokenType::LBrace, "{")?;
            Some(self.parse_block()?)
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

    /// Парсинг for
    fn parse_for(&mut self) -> Result<Stmt, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::For, "for")?;
        self.expect(TokenType::LParen, "(")?;
        self.expect(TokenType::Let, "let")?;
        let var = self.expect_identifier()?;
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
        self.expect(TokenType::LBrace, "{")?;
        let body = self.parse_block()?;
        Ok(Stmt {
            kind: StmtKind::Spawn(body),
            pos,
        })
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
        self.expect(TokenType::LParen, "(")?;

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

        self.expect(TokenType::RParen, ")")?;
        self.expect(TokenType::LBrace, "{")?;
        let body = self.parse_block()?;

        Ok(Stmt {
            kind: StmtKind::Test { name, body },
            pos,
        })
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

    /// Pratt parser для выражений
    fn parse_expression(&mut self, min_bp: u8) -> Result<Expr, ParserError> {
        let pos = self.peek().pos;

        // Префиксные операнды
        let mut lhs = match &self.peek().token_type {
            TokenType::Number(n) => {
                let n = *n;
                self.advance();
                Expr { kind: ExprKind::Number(n), pos }
            }
            TokenType::String(s) => {
                let s = s.clone();
                self.advance();
                Expr { kind: ExprKind::String(s), pos }
            }
            TokenType::Bool(b) => {
                let b = *b;
                self.advance();
                Expr { kind: ExprKind::Bool(b), pos }
            }
            TokenType::Null => {
                self.advance();
                Expr { kind: ExprKind::Null, pos }
            }
            TokenType::Identifier(name) => {
                let name = name.clone();
                self.advance();
                Expr { kind: ExprKind::Identifier(name), pos }
            }
            TokenType::Ai => {
                self.advance();
                Expr { kind: ExprKind::Identifier("ai".to_string()), pos }
            }
            TokenType::Minus => {
                self.advance();
                let rhs = self.parse_expression(95)?;
                Expr {
                    kind: ExprKind::Unary { op: UnaryOp::Neg, operand: Box::new(rhs) },
                    pos,
                }
            }
            TokenType::Not => {
                self.advance();
                let rhs = self.parse_expression(95)?;
                Expr {
                    kind: ExprKind::Unary { op: UnaryOp::Not, operand: Box::new(rhs) },
                    pos,
                }
            }
            TokenType::ChannelSend => {
                self.advance();
                let ch = self.parse_expression(95)?;
                Expr { kind: ExprKind::ChannelRecv(Box::new(ch)), pos }
            }
            TokenType::Await => {
                self.advance();
                let expr = self.parse_expression(95)?;
                Expr { kind: ExprKind::Await(Box::new(expr)), pos }
            }
            TokenType::LParen => {
                self.advance();
                let expr = self.parse_expression(0)?;
                self.expect(TokenType::RParen, ")")?;
                expr
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
                Expr { kind: ExprKind::Array(elements), pos }
            }
            TokenType::Fn => {
                self.parse_lambda()?
            }
            TokenType::Match => {
                self.parse_match_expr()?
            }
            TokenType::Identifier(name) if name == "ai_generate" => {
                self.advance();
                self.expect(TokenType::Not, "!")?;
                self.expect(TokenType::LParen, "(")?;
                let prompt = if let TokenType::String(s) = &self.peek().token_type {
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
                self.expect(TokenType::RParen, ")")?;
                Expr { kind: ExprKind::AiGenerate { prompt }, pos }
            }
            _ => {
                return Err(ParserError::UnexpectedToken {
                    expected: "expression".to_string(),
                    found: self.peek().token_type.clone(),
                    pos,
                });
            }
        };

        // Инфиксные и постфиксные операторы
        loop {
            let pos = self.peek().pos;

            let op_info = match &self.peek().token_type {
                TokenType::Assign => Some((OpCategory::Assign, 2, 1)),
                TokenType::ChannelSend => Some((OpCategory::ChannelSend, 2, 1)),
                TokenType::Or => Some((OpCategory::Binary(BinaryOp::Or), 10, 11)),
                TokenType::And => Some((OpCategory::Binary(BinaryOp::And), 20, 21)),
                TokenType::Eq => Some((OpCategory::Binary(BinaryOp::Eq), 30, 31)),
                TokenType::NotEq => Some((OpCategory::Binary(BinaryOp::NotEq), 30, 31)),
                TokenType::Lt => Some((OpCategory::Binary(BinaryOp::Lt), 40, 41)),
                TokenType::Gt => Some((OpCategory::Binary(BinaryOp::Gt), 40, 41)),
                TokenType::LtEq => Some((OpCategory::Binary(BinaryOp::LtEq), 40, 41)),
                TokenType::GtEq => Some((OpCategory::Binary(BinaryOp::GtEq), 40, 41)),
                TokenType::BitOr => Some((OpCategory::Binary(BinaryOp::BitOr), 50, 51)),
                TokenType::BitXor => Some((OpCategory::Binary(BinaryOp::BitXor), 50, 51)),
                TokenType::BitAnd => Some((OpCategory::Binary(BinaryOp::BitAnd), 60, 61)),
                TokenType::Shl => Some((OpCategory::Binary(BinaryOp::Shl), 70, 71)),
                TokenType::Shr => Some((OpCategory::Binary(BinaryOp::Shr), 70, 71)),
                TokenType::Plus => Some((OpCategory::Binary(BinaryOp::Add), 80, 81)),
                TokenType::Minus => Some((OpCategory::Binary(BinaryOp::Sub), 80, 81)),
                TokenType::Star => Some((OpCategory::Binary(BinaryOp::Mul), 90, 91)),
                TokenType::Slash => Some((OpCategory::Binary(BinaryOp::Div), 90, 91)),
                TokenType::Percent => Some((OpCategory::Binary(BinaryOp::Mod), 90, 91)),
                _ => None,
            };

            if let Some((category, left_bp, right_bp)) = op_info {
                if left_bp < min_bp {
                    break;
                }
                self.advance();

                let rhs = self.parse_expression(right_bp)?;
                let lhs_pos = lhs.pos;

                lhs = match category {
                    OpCategory::Assign => Expr {
                        kind: ExprKind::Assign {
                            target: Box::new(lhs),
                            value: Box::new(rhs),
                        },
                        pos: lhs_pos,
                    },
                    OpCategory::ChannelSend => Expr {
                        kind: ExprKind::ChannelSend {
                            channel: Box::new(lhs),
                            value: Box::new(rhs),
                        },
                        pos: lhs_pos,
                    },
                    OpCategory::Binary(op) => Expr {
                        kind: ExprKind::Binary {
                            op,
                            left: Box::new(lhs),
                            right: Box::new(rhs),
                        },
                        pos: lhs_pos,
                    },
                };
                continue;
            }

            // Постфиксные операторы
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
                    lhs = Expr {
                        kind: ExprKind::Call {
                            callee: Box::new(lhs),
                            args,
                        },
                        pos: lhs_pos,
                    };
                }
                TokenType::LBracket => {
                    self.advance();
                    let index = self.parse_expression(0)?;
                    self.expect(TokenType::RBracket, "]")?;
                    let lhs_pos = lhs.pos;
                    lhs = Expr {
                        kind: ExprKind::Index {
                            object: Box::new(lhs),
                            index: Box::new(index),
                        },
                        pos: lhs_pos,
                    };
                }
                TokenType::Dot => {
                    self.advance();
                    let field = self.expect_identifier()?;
                    let lhs_pos = lhs.pos;
                    lhs = Expr {
                        kind: ExprKind::Field {
                            object: Box::new(lhs),
                            field,
                        },
                        pos: lhs_pos,
                    };
                }
                _ => break,
            }
        }

        Ok(lhs)
    }

    /// Парсинг лямбды
    fn parse_lambda(&mut self) -> Result<Expr, ParserError> {
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

        self.expect(TokenType::Arrow, "=>")?;
        let body = self.parse_expression(0)?;

        Ok(Expr {
            kind: ExprKind::Lambda {
                params,
                ret_ty,
                body: Box::new(body),
            },
            pos,
        })
    }

    /// Парсинг match выражения
    fn parse_match_expr(&mut self) -> Result<Expr, ParserError> {
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
    fn parse_pattern(&mut self) -> Result<Pattern, ParserError> {
        if self.check(&TokenType::Case) {
            self.advance();
        }

        if self.check(&TokenType::Identifier(String::new())) {
            let name = self.expect_identifier()?;
            if self.check(&TokenType::LParen) {
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
}

/// Категория оператора для Pratt parser
enum OpCategory {
    Assign,
    ChannelSend,
    Binary(BinaryOp),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::Lexer;

    fn parse(source: &str) -> Result<Program, ParserError> {
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize().unwrap();
        let mut parser = Parser::new(tokens);
        parser.parse()
    }

    #[test]
    fn test_simple_let() {
        let program = parse("let x = 42;").unwrap();
        assert_eq!(program.statements.len(), 1);
        match &program.statements[0].kind {
            StmtKind::Let { name, value, .. } => {
                assert_eq!(name, "x");
                assert!(matches!(value.kind, ExprKind::Number(42.0)));
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_operator_precedence() {
        let program = parse("let x = a + b * c;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::Binary { op: BinaryOp::Add, left, right } => {
                        assert!(matches!(left.kind, ExprKind::Identifier(ref name) if name == "a"));
                        assert!(matches!(right.kind, ExprKind::Binary { op: BinaryOp::Mul, .. }));
                    }
                    _ => panic!("Expected Add at top level"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_function_declaration() {
        let program = parse("fn add(a: int, b: int) -> int { return a + b; }").unwrap();
        assert_eq!(program.statements.len(), 1);
        match &program.statements[0].kind {
            StmtKind::Fn { name, params, ret_ty, body } => {
                assert_eq!(name, "add");
                assert_eq!(params.len(), 2);
                assert!(ret_ty.is_some());
                assert_eq!(body.len(), 1);
            }
            _ => panic!("Expected function declaration"),
        }
    }

    #[test]
    fn test_method_call_chain() {
        let program = parse(r#"let x = ai.load("gpt-4");"#).unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::Call { callee, args } => {
                        assert_eq!(args.len(), 1);
                        assert!(matches!(args[0].kind, ExprKind::String(ref s) if s == "gpt-4"));
                        match &callee.kind {
                            ExprKind::Field { object, field } => {
                                assert!(matches!(object.kind, ExprKind::Identifier(ref name) if name == "ai"));
                                assert_eq!(field, "load");
                            }
                            _ => panic!("Expected field access"),
                        }
                    }
                    _ => panic!("Expected call"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_lambda() {
        let program = parse("let double = fn(x: int) => x * 2;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::Lambda { params, body, .. } => {
                        assert_eq!(params.len(), 1);
                        assert!(matches!(body.kind, ExprKind::Binary { op: BinaryOp::Mul, .. }));
                    }
                    _ => panic!("Expected lambda"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_if_else() {
        let program = parse("if (x > 0) { print(x); } else { print(0); }").unwrap();
        match &program.statements[0].kind {
            StmtKind::If { cond, then_branch, else_branch } => {
                assert!(matches!(cond.kind, ExprKind::Binary { op: BinaryOp::Gt, .. }));
                assert_eq!(then_branch.len(), 1);
                assert!(else_branch.is_some());
            }
            _ => panic!("Expected if statement"),
        }
    }

    #[test]
    fn test_while() {
        let program = parse("while (i < 10) { i = i + 1; }").unwrap();
        match &program.statements[0].kind {
            StmtKind::While { cond, body } => {
                assert!(matches!(cond.kind, ExprKind::Binary { op: BinaryOp::Lt, .. }));
                assert_eq!(body.len(), 1);
            }
            _ => panic!("Expected while statement"),
        }
    }

    #[test]
    fn test_for() {
        let program = parse("for (let item in items) { print(item); }").unwrap();
        match &program.statements[0].kind {
            StmtKind::For { var, iterable, body } => {
                assert_eq!(var, "item");
                assert!(matches!(iterable.kind, ExprKind::Identifier(ref name) if name == "items"));
                assert_eq!(body.len(), 1);
            }
            _ => panic!("Expected for statement"),
        }
    }

    #[test]
    fn test_array_literal() {
        let program = parse("let arr = [1, 2, 3];").unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::Array(elements) => {
                        assert_eq!(elements.len(), 3);
                    }
                    _ => panic!("Expected array"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_index_access() {
        let program = parse("let x = arr[0];").unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::Index { object, index } => {
                        assert!(matches!(object.kind, ExprKind::Identifier(ref name) if name == "arr"));
                        assert!(matches!(index.kind, ExprKind::Number(0.0)));
                    }
                    _ => panic!("Expected index access"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_assignment() {
        let program = parse("x = 42;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Expr(expr) => {
                match &expr.kind {
                    ExprKind::Assign { target, value } => {
                        assert!(matches!(target.kind, ExprKind::Identifier(ref name) if name == "x"));
                        assert!(matches!(value.kind, ExprKind::Number(42.0)));
                    }
                    _ => panic!("Expected assignment"),
                }
            }
            _ => panic!("Expected expression statement"),
        }
    }

    #[test]
    fn test_return() {
        let program = parse("return 42;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Return(Some(expr)) => {
                assert!(matches!(expr.kind, ExprKind::Number(42.0)));
            }
            _ => panic!("Expected return statement"),
        }
    }

    #[test]
    fn test_spawn() {
        let program = parse("spawn { print(1); }").unwrap();
        match &program.statements[0].kind {
            StmtKind::Spawn(body) => {
                assert_eq!(body.len(), 1);
            }
            _ => panic!("Expected spawn statement"),
        }
    }

    #[test]
    fn test_decorator() {
        let program = parse("@test(\"name\") fn foo() { }").unwrap();
        match &program.statements[0].kind {
            StmtKind::Decorator { name, args, target } => {
                assert_eq!(name, "test");
                assert_eq!(args.len(), 1);
                assert!(matches!(target.kind, StmtKind::Fn { .. }));
            }
            _ => panic!("Expected decorator"),
        }
    }

    #[test]
    fn test_class() {
        let program = parse("class Point { x: int; y: int; fn new(x: int, y: int) { } }").unwrap();
        match &program.statements[0].kind {
            StmtKind::Class { name, fields, methods } => {
                assert_eq!(name, "Point");
                assert_eq!(fields.len(), 2);
                assert_eq!(methods.len(), 1);
            }
            _ => panic!("Expected class declaration"),
        }
    }

    #[test]
    fn test_match() {
        let program = parse("match x { case 1: print(1), case _: print(0) };").unwrap();
        match &program.statements[0].kind {
            StmtKind::Expr(expr) => {
                match &expr.kind {
                    ExprKind::Match { scrutinee, arms } => {
                        assert!(matches!(scrutinee.kind, ExprKind::Identifier(ref name) if name == "x"));
                        assert_eq!(arms.len(), 2);
                    }
                    _ => panic!("Expected match expression"),
                }
            }
            _ => panic!("Expected expression statement"),
        }
    }

    #[test]
    fn test_channel_send() {
        let program = parse("ch <- 42;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Expr(expr) => {
                match &expr.kind {
                    ExprKind::ChannelSend { channel, value } => {
                        assert!(matches!(channel.kind, ExprKind::Identifier(ref name) if name == "ch"));
                        assert!(matches!(value.kind, ExprKind::Number(42.0)));
                    }
                    _ => panic!("Expected channel send"),
                }
            }
            _ => panic!("Expected expression statement"),
        }
    }

    #[test]
    fn test_channel_recv() {
        let program = parse("let x = <-ch;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::ChannelRecv(ch) => {
                        assert!(matches!(ch.kind, ExprKind::Identifier(ref name) if name == "ch"));
                    }
                    _ => panic!("Expected channel receive"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_await() {
        let program = parse("let x = await promise;").unwrap();
        match &program.statements[0].kind {
            StmtKind::Let { value, .. } => {
                match &value.kind {
                    ExprKind::Await(expr) => {
                        assert!(matches!(expr.kind, ExprKind::Identifier(ref name) if name == "promise"));
                    }
                    _ => panic!("Expected await"),
                }
            }
            _ => panic!("Expected let statement"),
        }
    }

    #[test]
    fn test_missing_semicolon() {
        let result = parse("let x = 42");
        assert!(result.is_err());
    }

    #[test]
    fn test_complex_program() {
        let source = r#"
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

fn main() {
    let result = factorial(5);
    print(result);
}
"#;
        let program = parse(source).unwrap();
        assert_eq!(program.statements.len(), 2);
    }
}
