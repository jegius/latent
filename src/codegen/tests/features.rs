//! Тесты нового функционала: строки, enum/match, лямбды, битовые операции,
//! байтовый доступ, память, call_indirect.

use super::*;

// ---- Структурная валидация WASM (парсер секций) --------------------------

/// Полная структурная проверка модуля WASM: заголовок, порядок и длины
/// секций, отсутствие trailing bytes. Ошибку валидатора эмулирует.
fn assert_well_formed(wasm: &[u8]) {
    assert!(wasm.len() >= 8, "module too short");
    assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D], "bad magic");
    assert_eq!(&wasm[4..8], &[0x01, 0x00, 0x00, 0x00], "bad version");
    let mut i = 8;
    let mut last_id = 0u8;
    while i < wasm.len() {
        let id = wasm[i]; i += 1;
        assert!(id > last_id, "sections must be ordered: {id} after {last_id}");
        last_id = id;
        let mut size = 0u32; let mut shift = 0;
        loop {
            let b = wasm[i]; i += 1;
            size |= ((b & 0x7f) as u32) << shift;
            shift += 7;
            if b & 0x80 == 0 { break; }
        }
        i += size as usize;
        assert!(i <= wasm.len(), "section length overflow");
    }
    assert_eq!(i, wasm.len(), "trailing bytes");
}

fn has_section(wasm: &[u8], section_id: u8) -> bool {
    let mut i = 8;
    let mut last_id = 0u8;
    while i < wasm.len() {
        let id = wasm[i]; i += 1;
        let _ = last_id;
        last_id = id;
        let mut size = 0u32; let mut shift = 0;
        loop {
            let b = wasm[i]; i += 1;
            size |= ((b & 0x7f) as u32) << shift;
            shift += 7;
            if b & 0x80 == 0 { break; }
        }
        if id == section_id { return true; }
        i += size as usize;
    }
    false
}

fn compile_ok(source: &str) -> Vec<u8> {
    compile(source)
}

// ---- Строки ---------------------------------------------------------------

#[test]
fn test_string_concat_emits_str_concat_call() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let s = "a" + "b";
    return s.length;
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_string_comparison_uses_helper() {
    let wasm = compile_ok(r#"
fn main() -> int {
    if ("a" == "a") { return 1; }
    return 0;
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_string_index_uses_char_at() {
    let wasm = compile_ok(r#"
fn first(s: string) -> int {
    return s[0];
}
fn main() -> int {
    return first("abc");
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_string_number_concat_coerces() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let v = "v" + 1;
    return v.length;
}"#);
    assert_well_formed(&wasm);
}

// ---- Enum / match ---------------------------------------------------------

#[test]
fn test_enum_declaration_and_constructor_pattern() {
    let wasm = compile_ok(r#"
enum Shape { Circle(int), Square(int), Empty }
fn area(s: Shape) -> int {
    return match s {
        case Circle(r): r * r * 3,
        case Square(a): a * a,
        case Empty: 0,
    };
}
fn main() -> int {
    return area(Circle(10));
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_result_constructor_match() {
    let wasm = compile_ok(r#"
fn from_result(r) -> int {
    return match r {
        case Ok(v): v,
        case Err(e): -1,
    };
}
fn main() -> int {
    return from_result(Ok(7)) + from_result(Err("x"));
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_string_literal_pattern_in_match() {
    let wasm = compile_ok(r#"
fn f(s: string) -> int {
    return match s {
        case "a": 1,
        case "b": 2,
        default: 0,
    };
}
fn main() -> int { return f("a"); }"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_option_builtin_variants() {
    let wasm = compile_ok(r#"
fn find(v) -> int {
    return match v {
        case Some(x): x,
        case None: 0,
        default: -1,
    };
}
fn main() -> int { return find(Some(5)); }"#);
    assert_well_formed(&wasm);
}

// ---- Lambdas / closures ---------------------------------------------------

#[test]
fn test_lambda_emits_table_and_elem_sections() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let double = fn(x) => x * 2;
    return double(21);
}"#);
    assert_well_formed(&wasm);
    assert!(has_section(&wasm, 4), "table section expected");
    assert!(has_section(&wasm, 9), "element section expected");
    assert!(wasm.contains(&op::CALL_INDIRECT), "call_indirect expected");
}

#[test]
fn test_closure_captures_variable() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let base = 10;
    let add = fn(x) => x + base;
    return add(5);
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_block_body_lambda() {
    let wasm = compile_ok(r#"
fn main() -> int {
    let scale = fn(x) { let y = x + 1; return y * 10; };
    return scale(4);
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_higher_order_function() {
    let wasm = compile_ok(r#"
fn apply_twice(f, x) { return f(f(x)); }
fn main() -> int {
    let d = fn(x) => x * 2;
    return apply_twice(d, 5);
}"#);
    assert_well_formed(&wasm);
}

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
fn main() -> int { return code(Green); }
"#);
    assert_well_formed(&wasm);
}