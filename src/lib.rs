//! Latent — AI-native язык программирования, компилируемый в WebAssembly.
//!
//! Часть I: Концепция, синтаксис и архитектура.
//! Этот модуль содержит базовые типы и структуры данных языка Latent.

pub mod ai;
pub mod ast;
pub mod codegen;
pub mod fp;
pub mod lexer;
pub mod parser;
pub mod runtime;
pub mod syntax;
pub mod typechecker;
pub mod types;

/// Версия компилятора
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Проверяет, что строка является валидным идентификатором Latent
pub fn is_valid_identifier(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let first = name.chars().next().unwrap();
    if !first.is_ascii_alphabetic() && first != '_' {
        return false;
    }
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Проверяет, что строка является ключевым словом Latent
pub fn is_keyword(word: &str) -> bool {
    matches!(
        word,
        "let" | "fn" | "if" | "else" | "while" | "for" | "in" | "return"
            | "class" | "new" | "this" | "async" | "await" | "spawn" | "channel"
            | "select" | "case" | "default" | "yield" | "match" | "enum" | "true" | "false"
            | "null" | "ai" | "model" | "agent" | "embedding" | "tensor" | "semantic"
            | "test" | "assert" | "assert_eq" | "forall" | "snapshot" | "ai_contract"
            | "enforce_contract"
    )
}

/// Проверяет, что строка является встроенным типом Latent
pub fn is_builtin_type(name: &str) -> bool {
    matches!(name, "int" | "float" | "bool" | "string" | "void" | "unit")
}

/// Единая точка входа компилятора: source → WASM-байты.
///
/// Это тот самый контракт `String → Vec<u8>`, который использует движок №2
/// в браузере (см. Часть X). Чистая функция: никаких системных вызовов,
/// поэтому собирается под `wasm32-unknown-unknown` без WASI.
///
/// # Errors
/// Возвращает строку с описанием первой ошибки лексинга/парсинга/типизации/
/// кодогенерации.
pub fn compile_source(source: &str) -> Result<Vec<u8>, String> {
    let mut lexer = lexer::Lexer::new(source);
    let tokens = lexer.tokenize().map_err(|e| e.to_string())?;
    let mut parser = parser::Parser::new(tokens);
    let program = parser.parse().map_err(|e| e.to_string())?;
    let mut checker = typechecker::TypeChecker::new();
    checker.check_program(&program)
        .map_err(|errs| errs.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("; "))?;
    let mut codegen = codegen::WasmCodegen::new();
    codegen.compile(&program)
}

// ============================================================================
// C-ABI для браузера (движок №2: компилятор-as-WASM)
// ============================================================================
//
// `compile_source` работает со `&str`/`Vec<u8>`, но WASM-хост в JS не умеет
// передавать такие типы. Эти экспорты реализуют простой контракт через
// линейную память:
//
//  1. JS: ptr = latent_alloc(len); записывает исходник в memory[ptr..ptr+len]
//  2. JS: res = latent_compile(ptr, len)
//  3. res указывает на буфер [status u32][len u32][payload...]:
//       status = 1 → payload это .wasm байты;
//       status = 0 → payload это UTF-8 сообщение об ошибке.
//  4. JS: читает status/len/payload, освобождает буферы latent_free.
//
// Указатели 32-битные (wasm32), LEB128 здесь не нужен — JS читает u32 LE.

/// Выделяет `size` байт в линейной памяти модуля и возвращает указатель.
#[no_mangle]
pub extern "C" fn latent_alloc(size: usize) -> *mut u8 {
    let mut buf = vec![0u8; size];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Освобождает буфер, ранее выделенный `latent_alloc` или возвращённый
/// `latent_compile`. `size` — фактическая ёмкость (для compile — полный размер).
#[no_mangle]
pub extern "C" fn latent_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, size);
    }
}

/// Компилирует исходник из линейной памяти. Возвращает указатель на буфер
/// ответа `[status u32 LE][len u32 LE][payload...]`.
///
/// # Safety
/// `src_ptr` должен указывать на валидный участок памяти длиной `src_len`,
/// записанный хостом.
#[no_mangle]
pub extern "C" fn latent_compile(src_ptr: *const u8, src_len: usize) -> *mut u8 {
    let source = unsafe {
        if src_ptr.is_null() || src_len == 0 {
            String::new()
        } else {
            let bytes = std::slice::from_raw_parts(src_ptr, src_len);
            String::from_utf8_lossy(bytes).into_owned()
        }
    };

    let (status, payload): (u32, Vec<u8>) = match compile_source(&source) {
        Ok(wasm) => (1, wasm),
        Err(msg) => (0, msg.into_bytes()),
    };

    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&status.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&payload);
    let ptr = out.as_mut_ptr();
    std::mem::forget(out);
    ptr
}

/// Возвращает версию компилятора как указатель на буфер `[len u32][utf8...]`.
/// Хост читает длину и строку. Полезно для диагностики «какой движок загружен».
#[no_mangle]
pub extern "C" fn latent_version() -> *mut u8 {
    let text = format!("latent {}", VERSION);
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(4 + bytes.len());
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    let ptr = out.as_mut_ptr();
    std::mem::forget(out);
    ptr
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_identifiers() {
        assert!(is_valid_identifier("x"));
        assert!(is_valid_identifier("myVar"));
        assert!(is_valid_identifier("_temp"));
        assert!(is_valid_identifier("a1"));
        assert!(!is_valid_identifier("1abc"));
        assert!(!is_valid_identifier(""));
        assert!(!is_valid_identifier("hello world"));
    }

    #[test]
    fn test_keywords() {
        assert!(is_keyword("let"));
        assert!(is_keyword("fn"));
        assert!(is_keyword("ai"));
        assert!(is_keyword("spawn"));
        assert!(is_keyword("channel"));
        assert!(!is_keyword("hello"));
        assert!(!is_keyword("world"));
    }

    #[test]
    fn test_builtin_types() {
        assert!(is_builtin_type("int"));
        assert!(is_builtin_type("float"));
        assert!(is_builtin_type("bool"));
        assert!(is_builtin_type("string"));
        assert!(!is_builtin_type("custom"));
    }

    #[test]
    fn test_compile_source_pipeline() {
        let wasm = compile_source("fn main() -> int { return 42; }").unwrap();
        assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
        assert!(wasm.len() > 20);
    }

    #[test]
    fn test_compile_source_reports_lex_error() {
        // `#` — невалидный символ → ошибка лексера, не паника.
        let err = compile_source("fn main() { # }").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn test_compile_source_reports_parse_error() {
        let err = compile_source("fn main() { let x = ; }").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn test_compile_source_skips_leading_comment() {
        // Регрессия: ведущий комментарий раньше валил парсер.
        let src = "// header comment\nfn main() -> int { return 7; }";
        let wasm = compile_source(src).unwrap();
        assert_eq!(&wasm[0..4], &[0x00, 0x61, 0x73, 0x6D]);
    }

    #[test]
    fn test_compile_source_inline_comments() {
        let src = "fn main() -> int {\n  // inline\n  let x = 1; /* block */\n  return x;\n}";
        assert!(compile_source(src).is_ok());
    }

    #[test]
    fn test_cabi_alloc_compile_free() {
        // Проверяем низкоуровневый контракт, который использует движок №2 в JS.
        let src = "fn main() -> int { return 5; }";
        let bytes = src.as_bytes();
        let ptr = latent_alloc(bytes.len());
        assert!(!ptr.is_null());
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()); }
        let res = latent_compile(ptr, bytes.len());
        assert!(!res.is_null());
        let status = unsafe { std::ptr::read_unaligned(res as *const u32) };
        let len = unsafe { std::ptr::read_unaligned((res as *const u32).add(1)) } as usize;
        assert_eq!(status, 1);
        let payload = unsafe { std::slice::from_raw_parts(res.add(8), len) };
        assert_eq!(&payload[0..4], &[0x00, 0x61, 0x73, 0x6D]);
        latent_free(ptr, bytes.len());
        latent_free(res, 8 + len);
    }

    #[test]
    fn test_cabi_compile_error_status_zero() {
        let src = "fn main() { let x = ; }";
        let bytes = src.as_bytes();
        let ptr = latent_alloc(bytes.len());
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()); }
        let res = latent_compile(ptr, bytes.len());
        let status = unsafe { std::ptr::read_unaligned(res as *const u32) };
        let len = unsafe { std::ptr::read_unaligned((res as *const u32).add(1)) } as usize;
        assert_eq!(status, 0);
        assert!(len > 0);
        latent_free(ptr, bytes.len());
        latent_free(res, 8 + len);
    }
}





