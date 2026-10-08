//! Разбор одного токена: диспетчер по текущему символу.

use super::error::LexerError;
use super::position::Position;
use super::scanner::Lexer;
use super::token::{Token, TokenType};

impl<'a> Lexer<'a> {
    /// Читает следующий токен, начиная с текущей позиции.
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

            // Комментарии и операторы деления
            Some('/') => {
                self.advance();
                match self.peek() {
                    Some('/') => self.read_line_comment(start_pos),
                    Some('*') => self.read_block_comment(start_pos),
                    // `/=` — составное присваивание не поддерживается: отдаём `/`
                    // отдельным токеном, `=` разберётся на следующем шаге.
                    _ => Ok(Token::new(TokenType::Slash, "/", start_pos)),
                }
            }

            // Операторы
            Some('=') => self.read_eq_family(start_pos),
            Some('<') => self.read_lt_family(start_pos),
            Some('>') => self.read_gt_family(start_pos),
            Some('!') => self.read_bang_family(start_pos),
            Some('&') => self.read_amp_family(start_pos),
            Some('|') => self.read_pipe_family(start_pos),
            Some('^') => self.single(TokenType::BitXor, "^", start_pos),
            Some('+') => self.single(TokenType::Plus, "+", start_pos),
            Some('-') => self.read_minus_family(start_pos),
            Some('*') => self.single(TokenType::Star, "*", start_pos),
            Some('%') => self.single(TokenType::Percent, "%", start_pos),

            // Пунктуация
            Some('(') => self.single(TokenType::LParen, "(", start_pos),
            Some(')') => self.single(TokenType::RParen, ")", start_pos),
            Some('{') => self.single(TokenType::LBrace, "{", start_pos),
            Some('}') => self.single(TokenType::RBrace, "}", start_pos),
            Some('[') => self.single(TokenType::LBracket, "[", start_pos),
            Some(']') => self.single(TokenType::RBracket, "]", start_pos),
            Some(';') => self.single(TokenType::Semicolon, ";", start_pos),
            Some(',') => self.single(TokenType::Comma, ",", start_pos),
            Some('.') => self.single(TokenType::Dot, ".", start_pos),
            Some(':') => self.read_colon_family(start_pos),
            Some('@') => self.single(TokenType::At, "@", start_pos),

            // Ошибка
            Some(ch) => Err(LexerError::UnexpectedCharacter { ch, pos: start_pos }),
        }
    }

    /// Потребляет один символ и возвращает готовый токен.
    fn single(
        &mut self,
        token_type: TokenType,
        lexeme: &str,
        start_pos: Position,
    ) -> Result<Token, LexerError> {
        self.advance();
        Ok(Token::new(token_type, lexeme, start_pos))
    }

    /// `=` / `==` / `=>`
    fn read_eq_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
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

    /// `<` / `<=` / `<-` / `<<`
    fn read_lt_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
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

    /// `>` / `>=` / `>>`
    fn read_gt_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
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

    /// `!` / `!=`
    fn read_bang_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        self.advance();
        match self.peek() {
            Some('=') => {
                self.advance();
                Ok(Token::new(TokenType::NotEq, "!=", start_pos))
            }
            _ => Ok(Token::new(TokenType::Not, "!", start_pos)),
        }
    }

    /// `&` / `&&`
    fn read_amp_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        self.advance();
        match self.peek() {
            Some('&') => {
                self.advance();
                Ok(Token::new(TokenType::And, "&&", start_pos))
            }
            _ => Ok(Token::new(TokenType::BitAnd, "&", start_pos)),
        }
    }

    /// `|` / `||`
    fn read_pipe_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        self.advance();
        match self.peek() {
            Some('|') => {
                self.advance();
                Ok(Token::new(TokenType::Or, "||", start_pos))
            }
            _ => Ok(Token::new(TokenType::BitOr, "|", start_pos)),
        }
    }

    /// `-` / `->`
    fn read_minus_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        self.advance();
        match self.peek() {
            Some('>') => {
                self.advance();
                Ok(Token::new(TokenType::ThinArrow, "->", start_pos))
            }
            _ => Ok(Token::new(TokenType::Minus, "-", start_pos)),
        }
    }

    /// `:` / `::`
    fn read_colon_family(&mut self, start_pos: Position) -> Result<Token, LexerError> {
        self.advance();
        match self.peek() {
            Some(':') => {
                self.advance();
                Ok(Token::new(TokenType::ColonColon, "::", start_pos))
            }
            _ => Ok(Token::new(TokenType::Colon, ":", start_pos)),
        }
    }
}