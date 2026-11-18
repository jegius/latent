//! Pratt parser: разбор выражения и диспетчер инфиксных/постфиксных операторов.

use super::super::error::ParserError;
use super::super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

/// Категория оператора для Pratt parser
pub(super) enum OpCategory {
    Assign,
    ChannelSend,
    Binary(BinaryOp),
}

impl Parser {
    /// Pratt parser для выражений
    pub(crate) fn parse_expression(&mut self, min_bp: u8) -> Result<Expr, ParserError> {
        let pos = self.peek().pos;

        // Префиксные операнды
        let mut lhs = self.parse_prefix(pos)?;

        // Инфиксные и постфиксные операторы
        loop {
            let _pos = self.peek().pos;

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
                    OpCategory::Assign => {
                        // Цель присваивания должна быть именем, индексом или полем
                        match &lhs.kind {
                            ExprKind::Identifier(_)
                            | ExprKind::Index { .. }
                            | ExprKind::Field { .. } => {}
                            _ => {
                                return Err(ParserError::InvalidAssignmentTarget { pos: lhs_pos });
                            }
                        }
                        Expr {
                            kind: ExprKind::Assign {
                                target: Box::new(lhs),
                                value: Box::new(rhs),
                            },
                            pos: lhs_pos,
                        }
                    }
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
            if !self.parse_postfix(&mut lhs)? {
                break;
            }
        }

        Ok(lhs)
    }
}
