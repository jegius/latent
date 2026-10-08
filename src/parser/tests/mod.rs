//! Тесты синтаксического анализатора.

use super::{Parser, ParserError};
use crate::ast::*;
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
        StmtKind::Fn { name, params, ret_ty, body, .. } => {
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

mod stmts_exprs;
