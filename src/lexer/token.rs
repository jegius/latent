//! Токены Latent: типы токенов и структура лексемы.

use super::position::Position;

/// Типы токенов Latent
#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    // Литералы
    Number(f64),
    String(String),
    Bool(bool),
    Null,

    // Идентификаторы
    Identifier(String),

    // Ключевые слова
    Let, Fn, If, Else, While, For, In, Return,
    Class, New, This, Async, Await,
    Spawn, Channel, Select, Case, Default, Yield, Match,
    Enum,

    // AI-ключевые слова
    Ai, Model, Agent, Embedding, Tensor, Semantic,

    // Тестовые ключевые слова
    Test, Assert, AssertEq, Forall, Snapshot,
    AiContract, EnforceContract,

    // Операторы
    Plus, Minus, Star, Slash, Percent,
    Assign, Eq, NotEq, Lt, Gt, LtEq, GtEq,
    And, Or, Not, BitAnd, BitOr, BitXor, Shl, Shr,
    Arrow,              // => (fat arrow для лямбд)
    ThinArrow,          // -> (тип возврата функции)
    ChannelSend,        // <- (отправка в канал)

    // Пунктуация
    LParen, RParen, LBrace, RBrace,
    LBracket, RBracket, Semicolon, Comma, Dot, Colon, ColonColon,
    At,                 // @ (декораторы)

    // Специальные
    Eof,
    Comment(String),
}

/// Токен — лексема с типом и позицией
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub token_type: TokenType,
    pub lexeme: String,
    pub pos: Position,
}

impl Token {
    pub fn new(token_type: TokenType, lexeme: &str, pos: Position) -> Self {
        Self {
            token_type,
            lexeme: lexeme.to_string(),
            pos,
        }
    }
}

impl TokenType {
    /// Лексема, если токен является «мягким» ключевым словом, которое можно
    /// использовать и как обычный идентификатор.
    ///
    /// Лексер помечает такие слова отдельными типами (`Test`, `Assert`,
    /// `Model` и т.п.), но синтаксически они остаются валидными именами:
    /// `let test = 5;`, `fn model() {}`, `obj.agent`. Без этого объявление
    /// переменной `test` падало с «ожидалось 'identifier', найдено Test».
    pub fn soft_keyword_lexeme(&self) -> Option<&'static str> {
        match self {
            TokenType::Test => Some("test"),
            TokenType::Assert => Some("assert"),
            TokenType::AssertEq => Some("assert_eq"),
            TokenType::Forall => Some("forall"),
            TokenType::Snapshot => Some("snapshot"),
            TokenType::AiContract => Some("ai_contract"),
            TokenType::EnforceContract => Some("enforce_contract"),
            TokenType::Model => Some("model"),
            TokenType::Agent => Some("agent"),
            TokenType::Embedding => Some("embedding"),
            TokenType::Tensor => Some("tensor"),
            TokenType::Semantic => Some("semantic"),
            TokenType::Case => Some("case"),
            _ => None,
        }
    }
}