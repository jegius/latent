//! Лексический анализатор (lexer) для языка Latent.
//!
//! Превращает исходный код в последовательность токенов.
//! Реализован как конечный автомат (FSM) с отслеживанием позиций.

use std::collections::HashMap;
use std::fmt;

/// Позиция в исходном коде
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
    pub offset: usize,
}

impl Position {
    pub fn new(line: usize, column: usize, offset: usize) -> Self {
        Self { line, column, offset }
    }
}

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

/// Ошибки лексера
#[derive(Debug, Clone, PartialEq)]
pub enum LexerError {
    UnexpectedCharacter { ch: char, pos: Position },
    UnterminatedString { pos: Position },
    InvalidEscapeSequence { sequence: String, pos: Position },
    InvalidNumberFormat { text: String, pos: Position },
    UnterminatedBlockComment { pos: Position },
}

impl fmt::Display for LexerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LexerError::UnexpectedCharacter { ch, pos } => {
                write!(f, "Неожиданный символ '{}' на строке {}:{}", ch, pos.line, pos.column)
            }
            LexerError::UnterminatedString { pos } => {
                write!(f, "Незавершённая строка на строке {}:{}", pos.line, pos.column)
            }
            LexerError::InvalidEscapeSequence { sequence, pos } => {
                write!(f, "Неверная escape-последовательность '{}' на строке {}:{}", sequence, pos.line, pos.column)
            }
            LexerError::InvalidNumberFormat { text, pos } => {
                write!(f, "Неверный формат числа '{}' на строке {}:{}", text, pos.line, pos.column)
            }
            LexerError::UnterminatedBlockComment { pos } => {
                write!(f, "Незавершённый блочный комментарий на строке {}:{}", pos.line, pos.column)
            }
        }
    }
}

/// Лексический анализатор
pub struct Lexer<'a> {
    source: &'a str,
    chars: std::str::Chars<'a>,
    current: Option<char>,
    pos: Position,
    keywords: HashMap<String, TokenType>,
}

impl<'a> Lexer<'a> {
    pub fn new(source: &'a str) -> Self {
        let mut lexer = Self {
            source,
            chars: source.chars(),
            current: None,
            pos: Position::new(1, 1, 0),
            keywords: HashMap::new(),
        };
        lexer.init_keywords();
        lexer.advance();
        lexer
    }

    fn init_keywords(&mut self) {
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
        for (word, token) in kw {
            self.keywords.insert(word.to_string(), token);
        }
    }

    fn advance(&mut self) {
        self.current = self.chars.next();
        if let Some(ch) = self.current {
            self.pos.offset += ch.len_utf8();
            if ch == '\n' {
                self.pos.line += 1;
                self.pos.column = 1;
            } else {
                self.pos.column += 1;
            }
        }
    }

    fn peek(&self) -> Option<char> {
        self.current
    }

    fn peek_next(&self) -> Option<char> {
        self.chars.clone().next()
    }

    fn skip_whitespace(&mut self) {
        while let Some(ch) = self.peek() {
            if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
                self.advance();
            } else {
                break;
            }
        }
    }

    pub fn next_token(&mut self) -> Result<Token, LexerError> {
        self.skip_whitespace();
        // start_pos — это позиция ПОСЛЕ текущего символа.
        // Вычитаем длину текущего символа, чтобы получить начало токена.
        let char_len = self.current.map(|c| c.len_utf8()).unwrap_or(0);
        let start_pos = Position::new(
            self.pos.line,
            self.pos.column - char_len,
            self.pos.offset - char_len,
        );
        let start_offset = start_pos.offset;

        match self.peek() {
            None => Ok(Token::new(TokenType::Eof, "", start_pos)),

            // Числа
            Some(ch) if ch.is_ascii_digit() => self.read_number(start_pos, start_offset),

            // Идентификаторы и ключевые слова
            Some(ch) if ch.is_ascii_alphabetic() || ch == '_' => {
                self.read_identifier(start_pos, start_offset)
            }

            // Строки
            Some('"') => self.read_string(start_pos),

            // Комментарии и операторы
            Some('/') => {
                self.advance();
                match self.peek() {
                    Some('/') => self.read_line_comment(start_pos),
                    Some('*') => self.read_block_comment(start_pos),
                    Some('=') => {
                        self.advance();
                        Ok(Token::new(TokenType::Assign, "/=", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Slash, "/", start_pos)),
                }
            }

            // Операторы
            Some('=') => {
                self.advance();
                match self.peek() {
                    Some('=') => {
                        self.advance();
                        Ok(Token::new(TokenType::Eq, "==", start_pos))
                    }
                    Some('>') => {
                        self.advance();
                        Ok(Token::new(TokenType::Arrow, "=>", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Assign, "=", start_pos)),
                }
            }

            Some('<') => {
                self.advance();
                match self.peek() {
                    Some('=') => {
                        self.advance();
                        Ok(Token::new(TokenType::LtEq, "<=", start_pos))
                    }
                    Some('-') => {
                        self.advance();
                        Ok(Token::new(TokenType::ChannelSend, "<-", start_pos))
                    }
                    Some('<') => {
                        self.advance();
                        Ok(Token::new(TokenType::Shl, "<<", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Lt, "<", start_pos)),
                }
            }

            Some('>') => {
                self.advance();
                match self.peek() {
                    Some('=') => {
                        self.advance();
                        Ok(Token::new(TokenType::GtEq, ">=", start_pos))
                    }
                    Some('>') => {
                        self.advance();
                        Ok(Token::new(TokenType::Shr, ">>", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Gt, ">", start_pos)),
                }
            }

            Some('!') => {
                self.advance();
                match self.peek() {
                    Some('=') => {
                        self.advance();
                        Ok(Token::new(TokenType::NotEq, "!=", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Not, "!", start_pos)),
                }
            }

            Some('&') => {
                self.advance();
                match self.peek() {
                    Some('&') => {
                        self.advance();
                        Ok(Token::new(TokenType::And, "&&", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::BitAnd, "&", start_pos)),
                }
            }

            Some('|') => {
                self.advance();
                match self.peek() {
                    Some('|') => {
                        self.advance();
                        Ok(Token::new(TokenType::Or, "||", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::BitOr, "|", start_pos)),
                }
            }

            Some('^') => {
                self.advance();
                Ok(Token::new(TokenType::BitXor, "^", start_pos))
            }

            Some('+') => {
                self.advance();
                Ok(Token::new(TokenType::Plus, "+", start_pos))
            }

            Some('-') => {
                self.advance();
                match self.peek() {
                    Some('>') => {
                        self.advance();
                        Ok(Token::new(TokenType::ThinArrow, "->", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Minus, "-", start_pos)),
                }
            }

            Some('*') => {
                self.advance();
                Ok(Token::new(TokenType::Star, "*", start_pos))
            }

            Some('%') => {
                self.advance();
                Ok(Token::new(TokenType::Percent, "%", start_pos))
            }

            // Пунктуация
            Some('(') => {
                self.advance();
                Ok(Token::new(TokenType::LParen, "(", start_pos))
            }
            Some(')') => {
                self.advance();
                Ok(Token::new(TokenType::RParen, ")", start_pos))
            }
            Some('{') => {
                self.advance();
                Ok(Token::new(TokenType::LBrace, "{", start_pos))
            }
            Some('}') => {
                self.advance();
                Ok(Token::new(TokenType::RBrace, "}", start_pos))
            }
            Some('[') => {
                self.advance();
                Ok(Token::new(TokenType::LBracket, "[", start_pos))
            }
            Some(']') => {
                self.advance();
                Ok(Token::new(TokenType::RBracket, "]", start_pos))
            }
            Some(';') => {
                self.advance();
                Ok(Token::new(TokenType::Semicolon, ";", start_pos))
            }
            Some(',') => {
                self.advance();
                Ok(Token::new(TokenType::Comma, ",", start_pos))
            }
            Some('.') => {
                self.advance();
                Ok(Token::new(TokenType::Dot, ".", start_pos))
            }
            Some(':') => {
                self.advance();
                match self.peek() {
                    Some(':') => {
                        self.advance();
                        Ok(Token::new(TokenType::ColonColon, "::", start_pos))
                    }
                    _ => Ok(Token::new(TokenType::Colon, ":", start_pos)),
                }
            }
            Some('@') => {
                self.advance();
                Ok(Token::new(TokenType::At, "@", start_pos))
            }

            // Ошибка
            Some(ch) => Err(LexerError::UnexpectedCharacter { ch, pos: start_pos }),
        }
    }

    fn read_number(&mut self, start_pos: Position, start_offset: usize) -> Result<Token, LexerError> {
        // Целая часть
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                self.advance();
            } else {
                break;
            }
        }

        // Дробная часть: 3.14
        if self.peek() == Some('.') {
            if let Some(next) = self.peek_next() {
                if next.is_ascii_digit() {
                    self.advance(); // '.'
                    while let Some(ch) = self.peek() {
                        if ch.is_ascii_digit() {
                            self.advance();
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Экспонента: 1e10, 1.5e-3
        if let Some('e') | Some('E') = self.peek() {
            self.advance(); // 'e'
            if self.peek() == Some('+') || self.peek() == Some('-') {
                self.advance();
            }
            if !matches!(self.peek(), Some(ch) if ch.is_ascii_digit()) {
                return Err(LexerError::InvalidNumberFormat {
                    text: self.source[start_offset..self.pos.offset - 1].to_string(),
                    pos: start_pos,
                });
            }
            while let Some(ch) = self.peek() {
                if ch.is_ascii_digit() {
                    self.advance();
                } else {
                    break;
                }
            }
        }

        // self.pos.offset указывает на символ ПОСЛЕ последнего символа числа.
        // Но если текущий символ — EOF, то advance() не вызывался, и offset не увеличился.
        // В этом случае не вычитаем 1.
        let end_offset = if self.current.is_some() {
            self.pos.offset - 1
        } else {
            self.pos.offset
        };
        let lexeme = &self.source[start_offset..end_offset];
        let value: f64 = lexeme.parse().map_err(|_| LexerError::InvalidNumberFormat {
            text: lexeme.to_string(),
            pos: start_pos,
        })?;

        Ok(Token::new(TokenType::Number(value), lexeme, start_pos))
    }

    fn read_identifier(&mut self, start_pos: Position, start_offset: usize) -> Result<Token, LexerError> {
        while let Some(ch) = self.peek() {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                self.advance();
            } else {
                break;
            }
        }

        // self.pos.offset указывает на символ ПОСЛЕ последнего символа идентификатора.
        // Но если текущий символ — EOF, то advance() не вызывался, и offset не увеличился.
        // В этом случае не вычитаем 1.
        let end_offset = if self.current.is_some() {
            self.pos.offset - 1
        } else {
            self.pos.offset
        };
        let lexeme = &self.source[start_offset..end_offset];

        if let Some(token_type) = self.keywords.get(lexeme) {
            Ok(Token::new(token_type.clone(), lexeme, start_pos))
        } else {
            Ok(Token::new(
                TokenType::Identifier(lexeme.to_string()),
                lexeme,
                start_pos,
            ))
        }
    }

    fn read_string(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        // start_pos.offset — это offset начала токена (включая открывающую кавычку).
        let start_offset = start_pos.offset;
        self.advance(); // consume opening '"'

        let mut result = String::new();

        while let Some(ch) = self.peek() {
            match ch {
                '"' => {
                    self.advance(); // closing '"'
                    let lexeme = &self.source[start_offset..self.pos.offset];
                    return Ok(Token::new(TokenType::String(result), lexeme, start_pos));
                }
                '\\' => {
                    self.advance(); // '\'
                    match self.peek() {
                        Some('n') => {
                            result.push('\n');
                            self.advance();
                        }
                        Some('t') => {
                            result.push('\t');
                            self.advance();
                        }
                        Some('\\') => {
                            result.push('\\');
                            self.advance();
                        }
                        Some('"') => {
                            result.push('"');
                            self.advance();
                        }
                        Some(other) => {
                            return Err(LexerError::InvalidEscapeSequence {
                                sequence: format!("\\{}", other),
                                pos: self.pos,
                            });
                        }
                        None => {
                            return Err(LexerError::UnterminatedString { pos: start_pos });
                        }
                    }
                }
                '\n' => {
                    return Err(LexerError::UnterminatedString { pos: start_pos });
                }
                _ => {
                    result.push(ch);
                    self.advance();
                }
            }
        }

        Err(LexerError::UnterminatedString { pos: start_pos })
    }

    fn read_line_comment(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        // start_pos.offset — это offset начала токена (включая первый '/').
        let start_offset = start_pos.offset;
        self.advance(); // consume second '/'

        while let Some(ch) = self.peek() {
            if ch == '\n' {
                break;
            }
            self.advance();
        }

        // self.pos.offset указывает на '\n' или EOF.
        // Не включаем '\n' в комментарий.
        let end_offset = if self.current == Some('\n') {
            self.pos.offset - 1
        } else {
            self.pos.offset
        };
        let text = self.source[start_offset..end_offset].to_string();
        Ok(Token::new(TokenType::Comment(text.clone()), &text, start_pos))
    }

    fn read_block_comment(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        // start_pos.offset — это offset начала токена (включая первый '/').
        let start_offset = start_pos.offset;
        self.advance(); // consume '*'

        let mut depth = 1;

        while let Some(ch) = self.peek() {
            if ch == '*' {
                self.advance();
                if self.peek() == Some('/') {
                    self.advance();
                    depth -= 1;
                    if depth == 0 {
                        // self.pos.offset указывает на символ ПОСЛЕ '/'.
                        // Не включаем его в комментарий.
                        let end_offset = self.pos.offset - 1;
                        let text = self.source[start_offset..end_offset].to_string();
                        return Ok(Token::new(TokenType::Comment(text.clone()), &text, start_pos));
                    }
                }
            } else if ch == '/' {
                self.advance();
                if self.peek() == Some('*') {
                    self.advance();
                    depth += 1;
                }
            } else {
                self.advance();
            }
        }

        Err(LexerError::UnterminatedBlockComment { pos: start_pos })
    }

    pub fn tokenize(&mut self) -> Result<Vec<Token>, LexerError> {
        let mut tokens = Vec::new();

        loop {
            let token = self.next_token()?;
            let is_eof = matches!(token.token_type, TokenType::Eof);
            tokens.push(token);
            if is_eof {
                break;
            }
        }

        Ok(tokens)
    }
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn test_position_tracking() {
        let source = "let\n  x = 42;";
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize().unwrap();

        assert_eq!(tokens[0].pos, Position::new(1, 1, 0)); // let
        assert_eq!(tokens[1].pos, Position::new(2, 3, 6)); // x
        assert_eq!(tokens[2].pos, Position::new(2, 5, 8)); // =
        assert_eq!(tokens[3].pos, Position::new(2, 7, 10)); // 42
    }

    #[test]
    fn test_unterminated_string() {
        let source = r#""hello"#;
        let mut lexer = Lexer::new(source);
        let result = lexer.tokenize();
        assert!(matches!(result, Err(LexerError::UnterminatedString { .. })));
    }

    #[test]
    fn test_invalid_escape() {
        let source = r#""hello\z""#;
        let mut lexer = Lexer::new(source);
        let result = lexer.tokenize();
        assert!(matches!(result, Err(LexerError::InvalidEscapeSequence { .. })));
    }

    #[test]
    fn test_unterminated_block_comment() {
        let source = "/* hello";
        let mut lexer = Lexer::new(source);
        let result = lexer.tokenize();
        assert!(matches!(result, Err(LexerError::UnterminatedBlockComment { .. })));
    }

    #[test]
    fn test_complex_program() {
        let source = r#"@test("sorting works")
fn testSort() {
    let input = [3, 1, 4];
    let sorted = quicksort(input);
    assert_eq(sorted, [1, 3, 4]);
}"#;

        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize().unwrap();

        assert!(matches!(tokens[0].token_type, TokenType::At));
        assert!(matches!(tokens[1].token_type, TokenType::Test));
        assert!(matches!(tokens[5].token_type, TokenType::Fn));
        assert!(tokens.len() > 20);
    }

    #[test]
    fn test_ai_contract_program() {
        let source = r#"@ai_contract("sorting")
fn sortingContract(f: fn([int]) -> [int]) {
    @forall("array")
    fn sorted(arr: [int]) {
        assert(true);
    }
}"#;

        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize().unwrap();

        for (i, token) in tokens.iter().enumerate() {
            println!("{}: {:?} = {:?}", i, token.token_type, token.lexeme);
        }

        assert!(matches!(tokens[0].token_type, TokenType::At));
        assert!(matches!(tokens[1].token_type, TokenType::AiContract));
        assert!(matches!(tokens[5].token_type, TokenType::Fn));
        assert!(matches!(tokens[16].token_type, TokenType::ThinArrow));
    }
}
