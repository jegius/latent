//! Дополнительные тесты покрытия: редко исполняемые ветки кодогена.
//!
//! Часть веток недостижима из `compile_source` (тайпчекер отсекает раньше),
//! поэтому здесь есть «сырой» путь: парсинг без типизации → `WasmCodegen`.

use super::*;
use crate::ast::Program;

/// Парсит программу, но НЕ запускает typechecker — чтобы дойти до веток
/// кодогенерации, которые обычно отсекаются фронтендом.
fn parse_only(source: &str) -> Program {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    parser.parse().unwrap()
}

fn compile_raw(source: &str) -> Result<Vec<u8>, String> {
    let program = parse_only(source);
    let mut codegen = WasmCodegen::new();
    codegen.compile(&program)
}

fn raw_err(source: &str) -> String {
    compile_raw(source).unwrap_err()
}

// ---- Ветки ошибок кодогена -------------------------------------------------

#[test]
fn test_unknown_function_error() {
    assert!(raw_err("fn main() -> int { return nope(1); }").contains("Unknown function"));
}

#[test]
fn test_undefined_variable_error() {
    assert!(
        raw_err("fn main() -> int { return x; }").contains("Undefined variable"),
        "raw codegen даёт собственное сообщение"
    );
}

#[test]
fn test_push_arity_error() {
    assert!(raw_err("fn main() -> int { return push(1); }").contains("push expects"));
}

#[test]
fn test_complex_assignment_error() {
    let src = "fn main() -> int { let a = 1; a.b.c = 2; return 0; }";
    assert!(raw_err(src).contains("Unknown"));
}

#[test]
fn test_unknown_class_field_assign_error() {
    let src = "fn main() -> int { let x = 1; x.y = 2; return 0; }";
    assert!(raw_err(src).contains("Unknown class"));
}

#[test]
fn test_host_builtins_are_rejected() {
    for name in [
        "tensor", "semantic", "matmul", "cosine_similarity", "dot", "magnitude",
        "zeros", "ones", "snapshot", "ai_contract", "enforce_contract",
        "ai_infer", "ai_embed", "ai_stream", "stream_next", "channel",
    ] {
        let src = format!("fn main() -> int {{ let v = {}(); return 0; }}", name);
        let err = raw_err(&src);
        assert!(err.contains("host"), "{name}: {err}");
    }
}

#[test]
fn test_enum_arity_and_unknown_variant_errors() {
    assert!(raw_err("fn main() -> int { let v = Some(1, 2); return 0; }")
        .contains("expects 1 field"));
    assert!(raw_err(
        "fn main() -> int { let v = match 1 { case Nope(1): 1, }; return v; }"
    ).contains("Unknown enum variant"));
    assert!(raw_err(
        "fn main() -> int { let v = match Some(1) { case Some(a, b): 1, default: 0, }; return v; }"
    ).contains("expects 1 field"));
}

// ---- Встроенные функции: варианты вызова ----------------------------------

#[test]
fn test_builtins_without_arguments() {
    // Typechecker не пропускает вызовы без аргументов, а кодоген — умеет.
    let wasm = compile_raw(
        r#"
fn main() -> int {
    let a = len();
    let b = str();
    let c = int();
    let d = float();
    let e = sqrt();
    assert();
    assert_eq();
    return a + b + c + d + e;
}"#,
    )
    .unwrap();
    assert_well_formed(&wasm);
}

#[test]
fn test_builtin_conversions_on_all_static_types() {
    let wasm = compile(
        r#"
fn main() -> int {
    let f = 1.5;
    let s = str(f) + str("x") + str(7) + str(true);
    let a = int(f) + int("42") + int(7);
    let b = float(f) + float("8") + float(9);
    let c = sqrt(f) + sqrt(9);
    print(s, a, b, c);
    return 0;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_memory_builtins_with_missing_arguments() {
    // L05: missing builtin arguments are a type error now, not a codegen case.
    let source = r#"
fn main() -> int {
    let p = alloc();
    let a = load8();
    let b = load32();
    store8();
    store32();
    memcopy();
    return p + a + b;
}"#;
    let mut lexer = crate::lexer::Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    let mut parser = crate::parser::Parser::new(tokens);
    let ast = parser.parse().unwrap();
    let mut checker = TypeChecker::new();
    assert!(checker.check_program(&ast).is_err());
}

#[test]
fn test_memory_builtins_roundtrip() {
    let wasm = compile(
        r#"
fn main() -> int {
    let p = alloc(16);
    store8(p, 3);
    store32(p + 4, 9);
    memcopy(p + 8, p, 4);
    return load8(p) + load32(p + 4) + load8(p + 8);
}"#,
    );
    assert_well_formed(&wasm);
}

// ---- Методы ---------------------------------------------------------------

#[test]
fn test_builtin_methods_cover_branches() {
    let wasm = compile(
        r#"
fn main() -> int {
    let arr = [1, 2, 3];
    arr.push(4);
    let top = arr.pop();
    let n = arr.length();
    let s = "x";
    let a = s.length();
    let b = 5.to_str();
    let c = 5.toString();
    let d = "6".to_int();
    let e = 6.toInt();
    let f = 1.5.to_str();
    let g = 1.5.to_int();
    print(top, n, a, b, c, d, e, f, g);
    return n;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_unsupported_method_error() {
    let err = raw_err("fn main() -> int { let x = 1; return x.unknown_m(); }");
    assert!(err.contains("не поддерживается"), "{err}");
}

#[test]
fn test_class_method_dispatch_and_unknown_class() {
    let wasm = compile(
        r#"
class Counter {
    n: int;
    fn init() { this.n = 0; }
    fn inc() { this.n = this.n + 1; return this.n; }
}
fn main() -> int {
    let c = new Counter();
    c.inc();
    return c.inc();
}"#,
    );
    assert_well_formed(&wasm);
    // Класс без init — ветка поиска конструктора `_new`.
    let wasm2 = compile(
        r#"
class Empty { }
fn main() -> int { let e = new Empty(); return 0; }"#,
    );
    assert_well_formed(&wasm2);
}

// ---- Операторы и выражения ------------------------------------------------

#[test]
fn test_all_binary_operator_variants() {
    let wasm = compile(
        r#"
fn mix(a: int, b: int, x: float, y: float, s: string) -> int {
    let r = 0;
    r = r + (a - b) + (a * b) + (a / b) + (a % b);
    r = r + (x + y) * 1 + (x - y) * 1;
    let q = x * y + x / y + x % y;
    let cmp = a == b || a != b || a < b || a > b || a <= b || a >= b;
    let bits = (a & b) | (a ^ b) | (a << 1) | (a >> 1);
    let logic = (a & b) + (a | b);
    let str = s + a + x + true;
    let str_eq = s == "x" || s != "y";
    if (cmp && !logic) { r = r + 1; }
    print(q, bits, str, str_eq);
    return r;
}
fn main() -> int { return mix(7, 3, 1.5, 2.5, "s"); }"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_unary_on_float_and_int() {
    let wasm = compile(
        r#"
fn main() -> int {
    let x = 1.5;
    let y = -x;
    let a = 5;
    let b = -a;
    if (!true) { return 0; }
    return b + int(y * 2.0);
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_index_and_field_access_variants() {
    let wasm = compile(
        r#"
fn main() -> int {
    let arr = [10, 20];
    arr[0] = 1;
    let s = "abc";
    let ch = s[1];
    let n = arr[1] + ch;
    let m = arr.length + s.length;
    return n + m;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_static_types_via_print_and_match() {
    let wasm = compile(
        r#"
fn classify(v: int) -> int {
    return match v { case 0: 1, case 1: 2, default: 3, };
}
fn main() -> int {
    let a = classify(1);
    let f = 1.5;
    let s = "text";
    let arr = [1];
    let l = fn(x) => x;
    let n = null;
    print(a, f, s, arr, l, n);
    let v = match a { case x: x + 1, };
    return v;
}"#,
    );
    assert_well_formed(&wasm);
}
