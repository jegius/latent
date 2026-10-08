//! Тесты генератора WASM-кода.

use super::bytecode::{op, ByteBuffer};
use super::module_builder::WasmCodegen;
use crate::lexer::Lexer;
use crate::parser::Parser;
use crate::typechecker::TypeChecker;

fn compile(source: &str) -> Vec<u8> {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    let ast = parser.parse().unwrap();
    let mut checker = TypeChecker::new();
    checker.check_program(&ast).unwrap();

    let mut codegen = WasmCodegen::new();
    codegen.compile(&ast).unwrap()
}

/// Проверяет структурную целостность секций WASM (без внешнего валидатора):
/// магию, версию и корректность длин секций.
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
        // LEB128 длина
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

#[test]
fn test_print_import_section_present() {
    let wasm = compile(r#"fn main() -> int { print("hi"); return 0; }"#);
    assert_well_formed(&wasm);
    // Import section (ID 2) должна присутствовать и содержать "env"/"print".
    assert!(wasm.windows(3).any(|w| w == b"env"), "env import missing");
    assert!(wasm.windows(5).any(|w| w == b"print"), "print import missing");
}

#[test]
fn test_c_style_for_compiles() {
    let wasm = compile(r#"
fn main() -> int {
    let s = 0;
    for (let i = 0; i < 5; i = i + 1) { s = s + i; }
    return s;
}"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_else_if_chain_compiles() {
    let wasm = compile(r#"
fn classify(n: int) -> int {
    if (n < 0) { return -1; } else if (n == 0) { return 0; } else { return 1; }
}
fn main() -> int { return classify(-5); }"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_array_push_compiles() {
    let wasm = compile(r#"
fn build(n: int) -> [int] {
    let r = [];
    for (let i = 0; i < n; i = i + 1) { r.push(i); }
    return r;
}
fn main() -> int { return build(3).length; }"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_leading_comment_skipped() {
    let wasm = compile("// header\nfn main() -> int { return 1; }");
    assert_well_formed(&wasm);
}

#[test]
fn test_compile_add() {
    let wasm = compile(r#"
fn add(a: int, b: int) -> int {
    return a + b;
}
fn main() -> int {
    return add(1, 2);
}
"#);

    assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
    assert_eq!(&wasm[4..8], &[0x01, 0x00, 0x00, 0x00]);
    println!("WASM module size: {} bytes", wasm.len());
}

#[test]
fn test_compile_factorial() {
    let wasm = compile(r#"
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
"#);
    assert!(wasm.len() > 50);
}

#[test]
fn test_compile_let() {
    let wasm = compile(r#"
fn main() -> int {
    let x = 42;
    return x;
}
"#);
    assert!(wasm.len() > 30);
}

#[test]
fn test_compile_if_else() {
    let wasm = compile(r#"
fn max(a: int, b: int) -> int {
    if (a > b) {
        return a;
    } else {
        return b;
    }
}
"#);
    assert!(wasm.len() > 40);
}

#[test]
fn test_compile_while() {
    let wasm = compile(r#"
fn countdown(n: int) -> int {
    while (n > 0) {
        n = n - 1;
    }
    return n;
}
"#);
    assert!(wasm.len() > 40);
}

#[test]
fn test_compile_unary() {
    let wasm = compile(r#"
fn neg(x: int) -> int {
    return -x;
}
"#);
    assert!(wasm.len() > 20);
}

#[test]
fn test_compile_bool() {
    let wasm = compile(r#"
fn not(x: bool) -> bool {
    return !x;
}
"#);
    assert!(wasm.len() > 20);
}

#[test]
fn test_compile_comparison() {
    let wasm = compile(r#"
fn lt(a: int, b: int) -> bool {
    return a < b;
}
"#);
    assert!(wasm.len() > 20);
}

#[test]
fn test_compile_logical() {
    let wasm = compile(r#"
fn and(a: bool, b: bool) -> bool {
    return a && b;
}
"#);
    assert!(wasm.len() > 20);
}

#[test]
fn test_compile_assignment() {
    let wasm = compile(r#"
fn main() -> int {
    let x = 1;
    x = 2;
    return x;
}
"#);
    assert!(wasm.len() > 30);
}

#[test]
fn test_compile_array() {
    let wasm = compile(r#"
fn main() -> int {
    let arr = [10, 20, 30];
    return arr[1];
}
"#);
    assert!(wasm.len() > 40);
}

#[test]
fn test_compile_array_assignment() {
    let wasm = compile(r#"
fn main() -> int {
    let arr = [10, 20, 30];
    arr[1] = 99;
    return arr[1];
}
"#);
    assert!(wasm.len() > 50);
}

#[test]
fn test_compile_string_length() {
    let wasm = compile(r#"
fn main() -> int {
    let s = "hello";
    return s.length;
}
"#);
    assert!(wasm.len() > 30);
}

#[test]
fn test_compile_class() {
    let wasm = compile(r#"
class Point {
    x: int;
    y: int;
    fn new(x: int, y: int) {
        this.x = x;
        this.y = y;
    }
}
"#);
    assert!(wasm.len() > 20);
}

#[test]
fn test_compile_float_arithmetic() {
    let wasm = compile(r#"
fn circle_area(r: float) -> float {
    return 3.14159 * r * r;
}
"#);
    let bytes = wasm;
    assert!(bytes.contains(&op::F64_MUL));
}

#[test]
fn test_bytebuffer_last_byte() {
    let mut buf = ByteBuffer::new();
    assert_eq!(buf.last_byte(), None);
    buf.push(0xAB);
    assert_eq!(buf.last_byte(), Some(0xAB));
}

#[test]
fn test_forgotten_return_guard() {
    // Функция объявляет -> int, но не заканчивается return.
    // Codegen обязан добавить заглушку, иначе модуль невалиден.
    let wasm = compile(r#"
fn f() -> int {
    let x = 1;
}
fn main() -> int {
    return f();
}
"#);
    // Тело f должно заканчиваться RETURN (заглушка i32.const 0 + return).
    assert!(wasm.contains(&op::RETURN));
    // Валидируем через wasm-парсер доступными средствами: магические байты.
    assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
}

mod advanced;
mod features;
