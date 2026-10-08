use super::*;

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

#[test]
fn test_soft_keyword_as_identifier() {
    // Регрессия: `test` (и другие soft-ключевые слова) — валидные имена.
    let program = parse("let test = 5; return test;").unwrap();
    match &program.statements[0].kind {
        StmtKind::Let { name, .. } => assert_eq!(name, "test"),
        other => panic!("Expected let, got {other:?}"),
    }
    match &program.statements[1].kind {
        StmtKind::Return(Some(expr)) => {
            assert!(matches!(expr.kind, ExprKind::Identifier(ref n) if n == "test"));
        }
        other => panic!("Expected return, got {other:?}"),
    }
}

#[test]
fn test_soft_keyword_as_function_name_and_call() {
    let program = parse("fn model() -> int { return 1; } fn main() -> int { return model(); }").unwrap();
    match &program.statements[0].kind {
        StmtKind::Fn { name, .. } => assert_eq!(name, "model"),
        other => panic!("Expected fn, got {other:?}"),
    }
}

#[test]
fn test_soft_keyword_field_access() {
    let program = parse("let x = obj.agent;").unwrap();
    match &program.statements[0].kind {
        StmtKind::Let { value, .. } => {
            assert!(matches!(&value.kind, ExprKind::Field { field, .. } if field == "agent"));
        }
        other => panic!("Expected let, got {other:?}"),
    }
}

#[test]
fn test_test_declaration_still_parses() {
    // `test("name") { ... }` остаётся объявлением теста.
    let program = parse("test(\"sorting\") { assert(true); }").unwrap();
    assert!(matches!(program.statements[0].kind, StmtKind::Test { .. }));
}

// ---------- Новые фичи: select, yield, async, классы, match, лямбды ----------

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
