//! Таблица ключевых слов Latent.

use super::token::TokenType;
use std::collections::HashMap;

/// Возвращает отображение «ключевое слово → тип токена».
pub(super) fn keyword_map() -> HashMap<String, TokenType> {
    let kw = [
        ("let", TokenType::Let),
        ("fn", TokenType::Fn),
        ("if", TokenType::If),
        ("else", TokenType::Else),
        ("while", TokenType::While),
        ("for", TokenType::For),
        ("in", TokenType::In),
        ("return", TokenType::Return),
        ("class", TokenType::Class),
        ("new", TokenType::New),
        ("this", TokenType::This),
        ("async", TokenType::Async),
        ("await", TokenType::Await),
        ("spawn", TokenType::Spawn),
        ("channel", TokenType::Channel),
        ("select", TokenType::Select),
        ("case", TokenType::Case),
        ("default", TokenType::Default),
        ("yield", TokenType::Yield),
        ("match", TokenType::Match),
        ("enum", TokenType::Enum),
        ("true", TokenType::Bool(true)),
        ("false", TokenType::Bool(false)),
        ("null", TokenType::Null),
        // AI
        ("ai", TokenType::Ai),
        ("model", TokenType::Model),
        ("agent", TokenType::Agent),
        ("embedding", TokenType::Embedding),
        ("tensor", TokenType::Tensor),
        ("semantic", TokenType::Semantic),
        // Тесты
        ("test", TokenType::Test),
        ("assert", TokenType::Assert),
        ("assert_eq", TokenType::AssertEq),
        ("forall", TokenType::Forall),
        ("snapshot", TokenType::Snapshot),
        ("ai_contract", TokenType::AiContract),
        ("enforce_contract", TokenType::EnforceContract),
    ];

    let mut map = HashMap::new();
    for (word, token) in kw {
        map.insert(word.to_string(), token);
    }
    map
}