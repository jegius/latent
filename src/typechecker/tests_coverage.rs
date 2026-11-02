//! Дополнительные тесты покрытия тайпчекера: ошибки и редкие ветки.

use super::*;
use crate::lexer::Lexer;
use crate::parser::Parser;

fn check(source: &str) -> Result<(), Vec<TypeError>> {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    let program = parser.parse().unwrap();
    let mut checker = TypeChecker::new();
    checker.check_program(&program)
}

fn assert_type_error(source: &str) -> String {
    let errs = check(source).unwrap_err();
    assert!(!errs.is_empty(), "нет ошибки типизации");
    errs.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("; ")
}

#[test]
fn test_undefined_variable_errors() {
    assert!(assert_type_error("fn main() -> int { return missing; }").contains("Неопределённая"));
    assert!(assert_type_error("fn main() -> int { missing = 1; return 0; }").contains("Неопределённая"));
}

#[test]
fn test_type_mismatch_errors() {
    assert!(assert_type_error("fn f(x: int) -> int { return x; } fn main() -> int { return f(\"s\"); }").contains("Несовпадение"));
    assert!(assert_type_error("fn f() -> int { return \"s\"; }").contains("Несовпадение"));
    assert!(assert_type_error("fn f() -> string { return 1; }").contains("Несовпадение"));
}

#[test]
fn test_duplicate_and_arity_errors() {
    // Дубликат функции не диагностируется (фиксируем текущее поведение).
    assert!(check("fn f() -> int { return 1; } fn f() -> int { return 2; } fn main() -> int { return f(); }").is_ok());
    // Арность обычной функции проверяется через унификацию.
    assert!(check("fn f(a: int) -> int { return a; } fn main() -> int { return f(1, 2); }").is_err());
}

#[test]
fn test_condition_and_assignment_errors() {
    assert!(check("fn main() -> int { if (1 == 1) { } return 0; }").is_ok());
    // Условие не-bool — ошибка типизации.
    assert!(check("fn main() -> int { if (1) { } return 0; }").is_err());
    // Присваивание значения другого типа в переменную.
    assert!(assert_type_error("fn main() -> int { let x = 1; x = \"s\"; return 0; }").contains("Несовпадение"));
}

#[test]
fn test_call_type_errors() {
    assert!(assert_type_error("fn main() -> int { let x = 1; return x(1); }").contains(""));
    assert!(assert_type_error("fn main() -> int { return await 1; }").contains(""));
    assert!(assert_type_error("fn main() -> int { let m = not_a_model; return ai_infer(m, 1); }").contains(""));
}

#[test]
fn test_async_return_promise_mismatch() {
    // async fn объявляет Promise<T>, но тело возвращает T — допустимо.
    assert!(check("async fn f() -> int { return 1; } fn main() -> int { let x = await f(); return x; }").is_ok());
}

#[test]
fn test_class_and_enum_typechecking() {
    assert!(check(
        "class P { x: int; fn init(x: int) { this.x = x; } fn get() -> int { return this.x; } }
         fn main() -> int { let p = new P(1); return p.get(); }"
    ).is_ok());
    assert!(check(
        "enum E { A, B(int) } fn main() -> int { let e = B(1); return match e { case B(x): x, default: 0, }; }"
    ).is_ok());
}
