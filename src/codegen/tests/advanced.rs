use super::*;

#[test]
fn test_global_section_emitted() {
    let wasm = compile(r#"
fn main() -> int {
    let a = [1, 2, 3];
    return a[0];
}
"#);
    // Секция Global (ID 6) должна присутствовать: 0x06
    // Проверяем грубо — наличие секции после memory (0x05).
    let mem_pos = wasm.iter().position(|&b| b == 0x05).unwrap_or(usize::MAX);
    let glob_pos = wasm.iter().position(|&b| b == 0x06).unwrap_or(usize::MAX);
    assert!(mem_pos < glob_pos, "Global section must follow memory section");
}

#[test]
fn test_compile_match_expression() {
    let wasm = compile(r#"
fn describe(n: int) -> int {
    return match n {
        case 1: 10,
        case 2: 20,
        default: 30,
    };
}
fn main() -> int {
    return describe(2);
}
"#);
    assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
    assert!(wasm.contains(&op::IF));
}

#[test]
fn test_load_store_have_memarg() {
    let wasm = compile(r#"
fn main() -> int {
    let a = [7];
    return a[0];
}
"#);
    // i32.store (0x36) должен сопровождаться align=2, offset=0.
    if let Some(pos) = wasm.iter().position(|&b| b == op::I32_STORE) {
        assert_eq!(wasm[pos + 1], 2, "i32.store align must be 2");
        assert_eq!(wasm[pos + 2], 0, "i32.store offset must be 0");
    } else {
        panic!("expected i32.store in module");
    }
}



#[test]
fn test_compile_select_and_yield() {
    // Канал передаётся параметром (движок №2 не создаёт channel() — host-фича).
    // select компилируется как тело первой ветки; yield — no-op.
    let wasm = compile(r#"
fn worker() -> int {
    yield;
    return 1;
}
fn consume(ch: channel) -> int {
    select {
        case v <- ch: { print(v); }
        default: { print(0); }
    }
    return 0;
}
fn main() -> int {
    return worker();
}
"#);
    assert_well_formed(&wasm);
    assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
}

#[test]
fn test_compile_async_await_passthrough() {
    // Движок №2: await — прозрачное разворачивание значения.
    let wasm = compile(r#"
async fn value() -> int { return 5; }
fn main() -> int { return await value(); }
"#);
    assert_well_formed(&wasm);
}

#[test]
fn test_compile_assert_and_len() {
    let wasm = compile(r#"
fn main() -> int {
    let a = [1, 2, 3];
    assert(len(a) == 3);
    assert_eq(1 + 1, 2);
    return 0;
}
"#);
    assert_well_formed(&wasm);
    // assert компилируется в UNREACHABLE при ложном условии.
    assert!(wasm.contains(&op::UNREACHABLE));
}

#[test]
fn test_host_builtin_gives_clear_error() {
    let mut lexer = Lexer::new("fn main() -> int { let t = tensor([1, 2]); return 0; }");
    let tokens = lexer.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    let ast = parser.parse().unwrap();
    let mut checker = TypeChecker::new();
    checker.check_program(&ast).unwrap();
    let mut codegen = WasmCodegen::new();
    let err = codegen.compile(&ast).unwrap_err();
    assert!(err.contains("tensor"), "unexpected error: {err}");
    assert!(err.contains("host"), "unexpected error: {err}");
}

#[test]
fn test_compile_for_in_loop() {
    let wasm = compile(r#"
fn main() -> int {
    let sum = 0;
    for (let x in [1, 2, 3]) {
        sum = sum + x;
    }
    return sum;
}
"#);
    assert_well_formed(&wasm);
}
