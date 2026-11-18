//! Ошибка AI-подсистемы.

/// Ошибка AI
#[derive(Debug, Clone)]
pub enum Error {
    NotSupported,
    FunctionNotFound,
    NetworkError(String),
    ParseError(String),
}