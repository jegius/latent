//! Дополнительные тесты покрытия: инструкции, функции, выражения.

use super::*;

// ---- Инструкции и функции -------------------------------------------------

#[test]
fn test_statement_variants() {
    let wasm = compile(
        r#"
fn void_fn() { print("v"); }
fn main() -> int {
    let a = 0;
    let b: int = 1;
    if (a > b) { a = 1; } else if (a == b) { a = 2; } else { a = 3; }
    while (a > 0) { a = a - 1; }
    for (let i = 0; i < 2; i = i + 1) { a = a + i; }
    for (let x in [1, 2]) { a = a + x; }
    void_fn();
    return a + b;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_spawn_select_yield_test_decorator() {
    let wasm = compile(
        r#"
fn worker(ch) -> int {
    yield;
    select { case v <- ch: { print(v); } }
    return 0;
}
fn main() -> int {
    spawn { print(1); }
    spawn worker(0);
    let ch = 0;
    select {
        case v <- ch: { print(v); }
        default: { print(0); }
    }
    test "t" { assert(true); }
    return 0;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_void_and_unannotated_functions() {
    let wasm = compile(
        r#"
fn no_result() { }
fn implicit_int() { return 5; }
fn implicit_void() { let x = 1; }
fn annotated_void() -> void { }
fn main() -> int {
    no_result();
    return implicit_int() + 0;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_float_class_field_store_load() {
    let wasm = compile(
        r#"
class Box { value: float; flag: int; }
fn main() -> int {
    let b = new Box(1.5);
    let f = b.value + 0.5;
    return int(f) + b.flag;
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_for_c_loop_variants() {
    let wasm = compile(
        r#"
fn main() -> int {
    let s = 0;
    for (;;) { s = s + 1; if (s > 2) { return s; } }
}"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_await_and_async_passthrough() {
    let wasm = compile(
        r#"
async fn value() -> int { return 3; }
fn main() -> int { return await value(); }"#,
    );
    assert_well_formed(&wasm);
}

#[test]
fn test_program_without_main() {
    let wasm = compile("fn helper() -> int { return 1; }");
    assert_well_formed(&wasm);
    assert!(!wasm.windows(4).any(|w| w == b"main"));
}
