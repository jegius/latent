//! Тесты парсера для конструкций, добавленных в «новых» фичах:
//! select/yield/async, классы с методами, match-выражения, лямбды.

use super::*;

#[test]
fn test_parse_select_with_default() {
    let program = parse(
        "fn main() -> int { let ch = channel(); select { case v <- ch: { print(v); } default: { print(0); } } return 0; }",
    ).unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { body, .. } => {
            assert!(body.iter().any(|s| matches!(&s.kind, StmtKind::Select { arms, default_branch }
                if arms.len() == 1 && arms[0].var.as_deref() == Some("v") && default_branch.is_some())));
        }
        other => panic!("Expected fn, got {other:?}"),
    }
}

#[test]
fn test_parse_select_without_default() {
    let program = parse(
        "fn main() -> int { select { case <- ch: { print(1); } } return 0; }",
    ).unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { body, .. } => {
            assert!(body.iter().any(|s| matches!(&s.kind, StmtKind::Select { arms, default_branch }
                if arms.len() == 1 && arms[0].var.is_none() && default_branch.is_none())));
        }
        other => panic!("Expected fn, got {other:?}"),
    }
}

#[test]
fn test_parse_yield() {
    let program = parse("fn main() -> int { yield; return 0; }").unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { body, .. } => {
            assert!(body.iter().any(|s| matches!(s.kind, StmtKind::Yield)));
        }
        other => panic!("Expected fn, got {other:?}"),
    }
}

#[test]
fn test_parse_async_fn_flag() {
    let program = parse("async fn f() -> int { return 1; } fn g() -> int { return 2; }").unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { is_async, .. } => assert!(*is_async),
        other => panic!("Expected fn, got {other:?}"),
    }
    match &program.statements[1].kind {
        StmtKind::Fn { is_async, .. } => assert!(!*is_async),
        other => panic!("Expected fn, got {other:?}"),
    }
}

#[test]
fn test_parse_class_fields_and_methods() {
    let program = parse("class Point { x: int; y: int; fn norm() -> int { return x; } }").unwrap();
    match &program.statements[0].kind {
        StmtKind::Class { name, fields, methods } => {
            assert_eq!(name, "Point");
            assert_eq!(fields.len(), 2);
            assert_eq!(methods.len(), 1);
        }
        other => panic!("Expected class, got {other:?}"),
    }
}

#[test]
fn test_parse_match_expression() {
    let program = parse("fn f(n: int) -> int { return match n { case 1: 10, default: 99, }; }").unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { body, .. } => {
            assert!(body.iter().any(|s| matches!(&s.kind, StmtKind::Return(Some(e))
                if matches!(e.kind, ExprKind::Match { .. }))));
        }
        other => panic!("Expected fn, got {other:?}"),
    }
}

#[test]
fn test_parse_lambda() {
    let program = parse("let f = fn(x: int) -> int => x * 2;").unwrap();
    match &program.statements[0].kind {
        StmtKind::Let { value, .. } => {
            assert!(matches!(value.kind, ExprKind::Lambda { .. }));
        }
        other => panic!("Expected let, got {other:?}"),
    }
}

#[test]
fn test_parse_channel_receive_and_send() {
    let program = parse("fn w(ch: channel) { ch <- 1; } fn main() -> int { let v = <- ch; return v; }").unwrap();
    assert_eq!(program.statements.len(), 2);
}

#[test]
fn test_parse_for_in() {
    let program = parse("fn main() -> int { for (let x in [1, 2]) { print(x); } return 0; }").unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { body, .. } => {
            assert!(body.iter().any(|s| matches!(&s.kind, StmtKind::For { var, .. } if var == "x")));
        }
        other => panic!("Expected fn, got {other:?}"),
    }
}
