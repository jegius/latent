//! Абстрактное синтаксическое дерево (AST) для языка Latent.
//!
//! Определяет структуры данных для представления программы после парсинга.

use crate::lexer::Position;

/// Программа — корневой узел AST
#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub statements: Vec<Stmt>,
}

/// Инструкция (statement)
#[derive(Debug, Clone, PartialEq)]
pub struct Stmt {
    pub kind: StmtKind,
    pub pos: Position,
}

/// Типы инструкций
#[derive(Debug, Clone, PartialEq)]
pub enum StmtKind {
    /// let name: Type = value;
    Let {
        name: String,
        ty: Option<Type>,
        value: Expr,
    },

    /// fn name(params) -> Type { body }
    Fn {
        name: String,
        params: Vec<Param>,
        ret_ty: Option<Type>,
        body: Vec<Stmt>,
    },

    /// class Name { fields... methods... }
    Class {
        name: String,
        fields: Vec<ClassField>,
        methods: Vec<Stmt>,
    },

    /// if (cond) { ... } else { ... }
    If {
        cond: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Option<Vec<Stmt>>,
    },

    /// while (cond) { ... }
    While {
        cond: Expr,
        body: Vec<Stmt>,
    },

    /// for (let var in iterable) { ... }
    For {
        var: String,
        iterable: Expr,
        body: Vec<Stmt>,
    },

    /// return value;
    Return(Option<Expr>),

    /// spawn { ... }
    Spawn(Vec<Stmt>),

    /// @decorator(args) target
    Decorator {
        name: String,
        args: Vec<Expr>,
        target: Box<Stmt>,
    },

    /// @test("name") { ... }
    Test {
        name: String,
        body: Vec<Stmt>,
    },

    /// ai_generate!("prompt")
    AiGenerate {
        prompt: String,
    },

    /// expression as statement: foo();
    Expr(Expr),
}

/// Выражение (expression)
#[derive(Debug, Clone, PartialEq)]
pub struct Expr {
    pub kind: ExprKind,
    pub pos: Position,
}

/// Типы выражений
#[derive(Debug, Clone, PartialEq)]
pub enum ExprKind {
    Number(f64),
    String(String),
    Bool(bool),
    Null,
    Identifier(String),

    /// a + b, a == b, a && b
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },

    /// -a, !a
    Unary {
        op: UnaryOp,
        operand: Box<Expr>,
    },

    /// foo(a, b)
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
    },

    /// arr[0]
    Index {
        object: Box<Expr>,
        index: Box<Expr>,
    },

    /// obj.field
    Field {
        object: Box<Expr>,
        field: String,
    },

    /// fn(x) => x * 2
    Lambda {
        params: Vec<Param>,
        ret_ty: Option<Type>,
        body: Box<Expr>,
    },

    /// [1, 2, 3]
    Array(Vec<Expr>),

    /// target = value
    Assign {
        target: Box<Expr>,
        value: Box<Expr>,
    },

    /// ch <- value (send to channel)
    ChannelSend {
        channel: Box<Expr>,
        value: Box<Expr>,
    },

    /// <-ch (receive from channel)
    ChannelRecv(Box<Expr>),

    /// match x { case ... }
    Match {
        scrutinee: Box<Expr>,
        arms: Vec<MatchArm>,
    },

    /// await expr
    Await(Box<Expr>),

    /// AI-примитивы
    AiLoad(String),
    AiInfer {
        model: Box<Expr>,
        input: Box<Expr>,
    },
    AiEmbed(Box<Expr>),
    AiAgent {
        name: String,
        config: Vec<(String, Expr)>,
    },
    AiAgentCall {
        agent: Box<Expr>,
        input: Box<Expr>,
    },
    AiGenerate {
        prompt: String,
    },
}

/// Параметр функции
#[derive(Debug, Clone, PartialEq)]
pub struct Param {
    pub name: String,
    pub ty: Option<Type>,
}

/// Поле класса
#[derive(Debug, Clone, PartialEq)]
pub struct ClassField {
    pub name: String,
    pub ty: Option<Type>,
}

/// Ветка pattern matching
#[derive(Debug, Clone, PartialEq)]
pub struct MatchArm {
    pub pattern: Pattern,
    pub body: Box<Expr>,
}

/// Паттерн для match
#[derive(Debug, Clone, PartialEq)]
pub enum Pattern {
    Wildcard,
    Literal(ExprKind),
    Identifier(String),
    Constructor(String, Vec<Pattern>),
}

/// Тип
#[derive(Debug, Clone, PartialEq)]
pub enum Type {
    Named(String),
    Array(Box<Type>),
    Fn(Vec<Type>, Box<Type>),
    Union(Vec<Type>),
    Generic(String, Vec<Type>),
    Unit,
}

/// Бинарные операторы
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Add, Sub, Mul, Div, Mod,
    Eq, NotEq, Lt, Gt, LtEq, GtEq,
    And, Or,
    BitAnd, BitOr, BitXor, Shl, Shr,
}

/// Унарные операторы
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Neg, Not,
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
