//! Тесты нового функционала: битовые операции, память и аллокатор,
//! печать/конверсии, unary, match без конструкторов, `new`, select,
//! тестовая декларация и 0-арные enum-варианты.
//!
//! Хелперы структурной валидации переиспользуются из [`super::features`].

use super::features::{assert_well_formed, compile_ok};
use super::*;

// ---- Битовые операции и сдвиги -------------------------------------------

#[test]
fn test_bitwise_and_shift_ops_emit_instructions() {
    let wasm = compile_ok(r#"
fn shl(a: int, b: int) -> int { return a << b; }
fn shr(a: int, b: int) -> int { return a >> b; }
fn band(a: int, b: int) -> int { return a & b; }
fn bor(a: int, b: int) -> int { return a | b; }
fn bxor(a: int, b: int) -> int { return a ^ b; }
fn main() -> int { return shl(1, 4) + shr(16, 2) + band(7, 3) + bor(1, 2) + bxor(5, 1); }
"#);
    assert_well_formed(&wasm);
    assert!(wasm.contains(&op::I32_SHL));
    assert!(wasm.contains(&op::I32_SHR_S));
    assert!(wasm.contains(&op::I32_XOR));
}

// ---- Память: рост ---------------------------------------------------------

#[test]
fn test_alloc_helper_emits_memory_grow() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let a = [1, 2, 3];
    return a[0];
}"#);
    assert_well_formed(&wasm);
    assert!(wasm.contains(&op::MEMORY_GROW), "alloc должен уметь растить память");
    assert!(wasm.contains(&op::I32_LOAD8_U), "mem_copy использует load8_u");
    assert!(wasm.contains(&op::I32_STORE8), "mem_copy использует store8");
}

#[test]
fn test_memory_has_multiple_pages() {
    let wasm = compile_ok("fn main() -> int { return 0; }");
    // Секция памяти (ID 5) должна объявлять > 1 страницы.
    let mut i = 8;
    while i < wasm.len() {
        let id = wasm[i]; i += 1;
        let mut size = 0u32; let mut shift = 0;
        loop {
            let b = wasm[i]; i += 1;
            size |= ((b & 0x7f) as u32) << shift;
            shift += 7;
            if b & 0x80 == 0 { break; }
        }
        if id == 5 {
            // [count][flags=0][min]
            assert_eq!(wasm[i], 1, "одна memory");
            assert_eq!(wasm[i + 1], 0, "limits: только min");
            let min = wasm[i + 2] as u32;
            assert!(min >= 16, "минимум страниц должен быть >= 16, получено {min}");
            return;
        }
        i += size as usize;
    }
    panic!("memory section not found");
}

// ---- Печать и конвертации -------------------------------------------------

#[test]
fn test_print_integer_coercion() {
    let wasm = compile_ok(r#"
fn main() -> int {
    print(42);
    return 0;
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_str_and_int_builtins() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let s = str(123);
    return int("7") + len(s);
}"#);
    assert_well_formed(&wasm);
}

// ---- Унарный минус --------------------------------------------------------

#[test]
fn test_unary_negation_codegen_order() {
    let wasm = compile_ok(r#"
fn main() -> int { return -7; }
"#);
    assert_well_formed(&wasm);
}

// ---- match без конструкторов (регресс) ------------------------------------

#[test]
fn test_match_literal_and_wildcard() {
    let wasm = compile_ok(r#"
fn describe(n: int) -> int {
    return match n {
        case 1: 10,
        case 2: 20,
        default: 30,
    };
}
fn main() -> int { return describe(2); }
"#);
    assert_well_formed(&wasm);
}

// ---- new / классы ---------------------------------------------------------

#[test]
fn test_new_expression_parses_and_compiles() {
    let wasm = compile_ok(r#"
class Point { x: int; y: int; }
fn main() -> int {
    let p = new Point();
    return 0;
}"#);
    assert_well_formed(&wasm);
}

// ---- select как выражение -------------------------------------------------

#[test]
fn test_select_expression_compiles() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let ch = 1;
    let first = select { case v <- ch: v };
    return first;
}"#);
    assert_well_formed(&wasm);
}

// ---- тестовая декларация без скобок --------------------------------------

#[test]
fn test_test_declaration_without_parens() {
    let wasm = compile_ok(r#"
test "arithmetic" {
    assert(1 + 1 == 2);
}
fn main() -> int { return 0; }
"#);
    assert_well_formed(&wasm);
}

// ---- enum 0-арный вариант как значение ------------------------------------

#[test]
fn test_zero_arity_variant_as_value() {
    let wasm = compile_ok(r#"
enum Color { Red, Green, Blue }
fn code(c: Color) -> int {
    return match c { case Red: 0, case Green: 1, case Blue: 2, default: 3 };
}
fn main() -> int { return code(Green); }"#);
    assert_well_formed(&wasm);
}
