//! Latent — AI-native язык программирования, компилируемый в WebAssembly.
//!
//! Часть I: Концепция, синтаксис и архитектура.
//! Этот модуль содержит базовые типы и структуры данных языка Latent.

pub mod ast;
pub mod lexer;
pub mod parser;
pub mod syntax;
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
            | "select" | "case" | "default" | "yield" | "match" | "true" | "false"
            | "null" | "ai" | "model" | "agent" | "embedding" | "tensor" | "semantic"
            | "test" | "assert" | "assert_eq" | "forall" | "snapshot" | "ai_contract"
            | "enforce_contract"
    )
}

/// Проверяет, что строка является встроенным типом Latent
pub fn is_builtin_type(name: &str) -> bool {
    matches!(name, "int" | "float" | "bool" | "string" | "void" | "unit")
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
}
