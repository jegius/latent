//! Тесты лексического анализатора.

use super::*;

fn assert_token(source: &str, expected: Vec<TokenType>) {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    let actual: Vec<TokenType> = tokens.into_iter().map(|t| t.token_type).collect();
    assert_eq!(actual, expected);
}

#[test]
fn test_empty() {
    assert_token("", vec![TokenType::Eof]);
}

#[test]
fn test_whitespace() {
    assert_token("   \n\t  ", vec![TokenType::Eof]);
}

#[test]
fn test_simple_let() {
    assert_token(
        "let x = 42;",
        vec![
            TokenType::Let,
            TokenType::Identifier("x".to_string()),
            TokenType::Assign,
            TokenType::Number(42.0),
            TokenType::Semicolon,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_function_declaration() {
    assert_token(
        "fn add(a: int, b: int) -> int { return a + b; }",
        vec![
            TokenType::Fn,
            TokenType::Identifier("add".to_string()),
            TokenType::LParen,
            TokenType::Identifier("a".to_string()),
            TokenType::Colon,
            TokenType::Identifier("int".to_string()),
            TokenType::Comma,
            TokenType::Identifier("b".to_string()),
            TokenType::Colon,
            TokenType::Identifier("int".to_string()),
            TokenType::RParen,
            TokenType::ThinArrow,
            TokenType::Identifier("int".to_string()),
            TokenType::LBrace,
            TokenType::Return,
            TokenType::Identifier("a".to_string()),
            TokenType::Plus,
            TokenType::Identifier("b".to_string()),
            TokenType::Semicolon,
            TokenType::RBrace,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_numbers() {
    assert_token(
        "42 3.14 1e10 1.5e-3",
        vec![
            TokenType::Number(42.0),
            TokenType::Number(3.14),
            TokenType::Number(1e10),
            TokenType::Number(1.5e-3),
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_strings() {
    assert_token(
        r#""hello" "world\n" "tab\there""#,
        vec![
            TokenType::String("hello".to_string()),
            TokenType::String("world\n".to_string()),
            TokenType::String("tab\there".to_string()),
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_operators() {
    assert_token(
        "+ - * / % == != < > <= >= && || ! & | ^ << >>",
        vec![
            TokenType::Plus,
            TokenType::Minus,
            TokenType::Star,
            TokenType::Slash,
            TokenType::Percent,
            TokenType::Eq,
            TokenType::NotEq,
            TokenType::Lt,
            TokenType::Gt,
            TokenType::LtEq,
            TokenType::GtEq,
            TokenType::And,
            TokenType::Or,
            TokenType::Not,
            TokenType::BitAnd,
            TokenType::BitOr,
            TokenType::BitXor,
            TokenType::Shl,
            TokenType::Shr,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_channel_send() {
    assert_token(
        "ch <- 42",
        vec![
            TokenType::Identifier("ch".to_string()),
            TokenType::ChannelSend,
            TokenType::Number(42.0),
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_keywords() {
    assert_token(
        "let fn if else while for in return class new this async await spawn channel select case default yield match",
        vec![
            TokenType::Let,
            TokenType::Fn,
            TokenType::If,
            TokenType::Else,
            TokenType::While,
            TokenType::For,
            TokenType::In,
            TokenType::Return,
            TokenType::Class,
            TokenType::New,
            TokenType::This,
            TokenType::Async,
            TokenType::Await,
            TokenType::Spawn,
            TokenType::Channel,
            TokenType::Select,
            TokenType::Case,
            TokenType::Default,
            TokenType::Yield,
            TokenType::Match,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_ai_keywords() {
    assert_token(
        "ai model agent embedding tensor semantic",
        vec![
            TokenType::Ai,
            TokenType::Model,
            TokenType::Agent,
            TokenType::Embedding,
            TokenType::Tensor,
            TokenType::Semantic,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_test_keywords() {
    assert_token(
        "test assert assert_eq forall snapshot ai_contract enforce_contract",
        vec![
            TokenType::Test,
            TokenType::Assert,
            TokenType::AssertEq,
            TokenType::Forall,
            TokenType::Snapshot,
            TokenType::AiContract,
            TokenType::EnforceContract,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_booleans_and_null() {
    assert_token(
        "true false null",
        vec![
            TokenType::Bool(true),
            TokenType::Bool(false),
            TokenType::Null,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_comments() {
    assert_token(
        "// hello\nlet x = 1; // world",
        vec![
            TokenType::Comment("// hello".to_string()),
            TokenType::Let,
            TokenType::Identifier("x".to_string()),
            TokenType::Assign,
            TokenType::Number(1.0),
            TokenType::Semicolon,
            TokenType::Comment("// world".to_string()),
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_block_comments() {
    assert_token(
        "/* hello */ let x = 1;",
        vec![
            TokenType::Comment("/* hello */".to_string()),
            TokenType::Let,
            TokenType::Identifier("x".to_string()),
            TokenType::Assign,
            TokenType::Number(1.0),
            TokenType::Semicolon,
            TokenType::Eof,
        ],
    );
}

#[test]
fn test_nested_block_comments() {
    assert_token(
        "/* outer /* inner */ outer */ let x = 1;",
        vec![
            TokenType::Comment("/* outer /* inner */ outer */".to_string()),
            TokenType::Let,
            TokenType::Identifier("x".to_string()),
            TokenType::Assign,
            TokenType::Number(1.0),
            TokenType::Semicolon,
            TokenType::Eof,
        ],
    );
}

mod positions_errors;
