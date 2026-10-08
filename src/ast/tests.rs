//! Тесты AST.

use super::*;
use crate::lexer::Position;

#[test]
fn test_program_creation() {
    let program = Program {
        statements: vec![
            Stmt {
                kind: StmtKind::Let {
                    name: "x".to_string(),
                    ty: None,
                    value: Expr {
                        kind: ExprKind::Number(42.0),
                        pos: Position::new(1, 1, 0),
                    },
                },
                pos: Position::new(1, 1, 0),
            },
        ],
    };
    assert_eq!(program.statements.len(), 1);
}

#[test]
fn test_binary_expr() {
    let expr = Expr {
        kind: ExprKind::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr {
                kind: ExprKind::Number(1.0),
                pos: Position::new(1, 1, 0),
            }),
            right: Box::new(Expr {
                kind: ExprKind::Number(2.0),
                pos: Position::new(1, 5, 4),
            }),
        },
        pos: Position::new(1, 3, 2),
    };
    match expr.kind {
        ExprKind::Binary { op, .. } => assert_eq!(op, BinaryOp::Add),
        _ => panic!("Expected binary expression"),
    }
}

#[test]
fn test_fn_decl() {
    let func = Stmt {
        kind: StmtKind::Fn {
            name: "add".to_string(),
            params: vec![
                Param {
                    name: "a".to_string(),
                    ty: Some(Type::Named("int".to_string())),
                },
                Param {
                    name: "b".to_string(),
                    ty: Some(Type::Named("int".to_string())),
                },
            ],
            ret_ty: Some(Type::Named("int".to_string())),
            body: vec![Stmt {
                kind: StmtKind::Return(Some(Expr {
                    kind: ExprKind::Binary {
                        op: BinaryOp::Add,
                        left: Box::new(Expr {
                            kind: ExprKind::Identifier("a".to_string()),
                            pos: Position::new(2, 12, 11),
                        }),
                        right: Box::new(Expr {
                            kind: ExprKind::Identifier("b".to_string()),
                            pos: Position::new(2, 16, 15),
                        }),
                    },
                    pos: Position::new(2, 14, 13),
                })),
                pos: Position::new(2, 5, 4),
            }],
            is_async: false,
        },
        pos: Position::new(1, 1, 0),
    };
    match func.kind {
        StmtKind::Fn { name, params, .. } => {
            assert_eq!(name, "add");
            assert_eq!(params.len(), 2);
        }
        _ => panic!("Expected function declaration"),
    }
}

#[test]
fn test_type_display() {
    let ty = Type::Fn(
        vec![Type::Named("int".to_string()), Type::Named("int".to_string())],
        Box::new(Type::Named("int".to_string())),
    );
    match ty {
        Type::Fn(args, ret) => {
            assert_eq!(args.len(), 2);
            assert!(matches!(*ret, Type::Named(_)));
        }
        _ => panic!("Expected function type"),
    }
}