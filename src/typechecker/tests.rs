//! Тесты семантического анализатора.

use super::types::{unify, Type, TypeError};
use super::TypeChecker;
use crate::lexer::Lexer;
use crate::parser::Parser;

fn check(source: &str) -> Result<(), Vec<TypeError>> {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    let ast = parser.parse().unwrap();
    let mut checker = TypeChecker::new();
    checker.check_program(&ast)
}

#[test]
fn test_simple_let() {
    assert!(check("let x = 42;").is_ok());
    assert!(check("let x: int = 42;").is_ok());
    assert!(check("let x: string = 42;").is_err());
}

#[test]
fn test_undefined_variable() {
    let result = check("let x = y;");
    assert!(result.is_err());
}

#[test]
fn test_generalize_applies_substitution() {
    // `id` должен обобщиться как ∀T. T -> T, а не ∀T1 T2. T1 -> T2.
    // Проверяем напрямую: свободных переменных в обобщённом теле, кроме
    // связанной, быть не должно, а аргумент и результат должны совпадать.
    let mut checker = TypeChecker::new();
    let raw = Type::Fn(vec![Type::Var("$T1".into())], Box::new(Type::Var("$T2".into())));
    checker.subst.insert("$T2".into(), Type::Var("$T1".into()));
    let poly = checker.generalize(&raw);
    match poly {
        Type::Poly { vars, body } => {
            // $T2 уже развёрнут в $T1, значит обобщается ровно одна переменная.
            assert_eq!(vars.len(), 1, "id должен иметь один связанный параметр: {:?}", vars);
            match *body {
                Type::Fn(args, ret) => {
                    assert_eq!(args[0], *ret, "аргумент и результат должны совпадать");
                }
                other => panic!("ожидался Fn, получено {:?}", other),
            }
        }
        other => panic!("ожидался Poly, получено {:?}", other),
    }
}

#[test]
fn test_named_types_unify() {
    assert!(unify(&Type::Named("Point".into()), &Type::Named("Point".into())).is_ok());
    assert!(unify(&Type::Named("Point".into()), &Type::Named("Circle".into())).is_err());
}

#[test]
fn test_function_inference() {
    let source = r#"
fn add(a, b) {
    return a + b;
}
let x = add(1, 2);
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_polymorphic_id() {
    let source = r#"
let id = fn(x) => x;
let a = id(5);
let b = id("hello");
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_string_number_concat_is_allowed() {
    // Конкатенация строки и числа разрешена — числа коэрцятся (как в engine #1).
    let source = r#"
let x = "hello";
let y = x + 5;
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_type_mismatch() {
    // Реальная ошибка типов: вызов не-функции.
    let source = r#"
let x = 5;
let y = x("nope");
"#;
    let result = check(source);
    assert!(result.is_err());
}

#[test]
fn test_nested_functions() {
    let source = r#"
fn makeAdder(n) {
    return fn(x) => x + n;
}
let add5 = makeAdder(5);
let result = add5(10);
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_array_inference() {
    let source = r#"
let arr = [1, 2, 3];
let first = arr[0];
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_lambda_inference() {
    let source = r#"
let apply = fn(f, x) => f(x);
let result = apply(fn(n) => n * 2, 5);
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_if_condition_must_be_bool() {
    let source = r#"
if (42) {
    print("yes");
}
"#;
    let result = check(source);
    assert!(result.is_err());
}

#[test]
fn test_while_condition_must_be_bool() {
    let source = r#"
while (42) {
    print("yes");
}
"#;
    let result = check(source);
    assert!(result.is_err());
}

#[test]
fn test_for_iterable_must_be_array() {
    let source = r#"
for (let x in 42) {
    print(x);
}
"#;
    let result = check(source);
    assert!(result.is_err());
}

#[test]
fn test_return_type_mismatch() {
    let source = r#"
fn f() -> int {
    return "hello";
}
"#;
    let result = check(source);
    if let Err(errors) = &result {
        for e in errors {
            println!("Error: {}", e);
        }
    }
    assert!(result.is_err());
}

#[test]
fn test_recursive_function() {
    let source = r#"
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_class_declaration() {
    let source = r#"
class Point {
    x: int;
    y: int;
    fn new(x: int, y: int) {
        this.x = x;
        this.y = y;
    }
}
"#;
    let result = check(source);
    if let Err(errors) = &result {
        for e in errors {
            println!("Error: {}", e);
        }
    }
    assert!(result.is_ok());
}

#[test]
fn test_spawn() {
    let source = r#"
spawn {
    print("hello");
}
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_decorator() {
    let source = r#"
@test("name")
fn foo() {
    assert(true);
}
"#;
    let result = check(source);
    if let Err(errors) = &result {
        for e in errors {
            println!("Error: {}", e);
        }
    }
    assert!(result.is_ok());
}

#[test]
fn test_match() {
    let source = r#"
let x = 42;
match x {
    case 1: print("one"),
    case _: print("other")
};
"#;
    assert!(check(source).is_ok());
}

#[test]
fn test_channel() {
    let source = r#"
let ch = channel<int>();
spawn {
    ch <- 42;
};
let x = <-ch;
"#;
    let result = check(source);
    if let Err(errors) = &result {
        for e in errors {
            println!("Error: {}", e);
        }
    }
    assert!(result.is_ok());
}

#[test]
fn test_await() {
    let source = r#"
async fn fetch() -> string {
    return "data";
}
let x = await fetch();
"#;
    let result = check(source);
    if let Err(errors) = &result {
        for e in errors {
            println!("Error: {}", e);
        }
    }
    assert!(result.is_ok());
}