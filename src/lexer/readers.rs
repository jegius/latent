//! Чтение составных лексем: чисел, идентификаторов, строк и комментариев.

use super::error::LexerError;
use super::position::Position;
use super::scanner::Lexer;
use super::token::{Token, TokenType};

impl<'a> Lexer<'a> {
    /// Читает числовой литерал (целое, дробное, с экспонентой).
    pub(super) fn read_number(
        &mut self,
        start_pos: Position,
        start_offset: usize,
    ) -> Result<Token, LexerError> {
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

    /// Читает идентификатор или ключевое слово.
    pub(super) fn read_identifier(
        &mut self,
        start_pos: Position,
        start_offset: usize,
    ) -> Result<Token, LexerError> {
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

    /// Читает строковый литерал с поддержкой escape-последовательностей.
    pub(super) fn read_string(&mut self, start_pos: Position) -> Result<Token, LexerError> {
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

    /// Читает строчный комментарий `// ...` (без завершающего перевода строки).
    pub(super) fn read_line_comment(&mut self, start_pos: Position) -> Result<Token, LexerError> {
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

    /// Читает блочный комментарий `/* ... */` с поддержкой вложенности.
    pub(super) fn read_block_comment(&mut self, start_pos: Position) -> Result<Token, LexerError> {
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
}