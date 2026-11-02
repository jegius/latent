//! Разбор модульных объявлений верхнего уровня: `import` и `export`.
//!
//! Грамматика v1:
//! * `import { a, b as c } from "./x.lat";`
//! * `import "./x.lat";`
//! * `export fn|class|enum ...`
//!
//! Импорт/экспорт допустимы только на верхнем уровне: внутри блока
//! [`Parser::parse_declaration`] сразу сообщает об ошибке.

use super::error::ParserError;
use super::Parser;
use crate::ast::*;
use crate::lexer::TokenType;

impl Parser {
    /// Разбор объявления `import` (верхний уровень).
    pub(super) fn parse_import(&mut self) -> Result<ImportDecl, ParserError> {
        let pos = self.peek().pos;
        self.expect(TokenType::Import, "import")?;

        // `import "./x.lat";`
        if let TokenType::String(path) = &self.peek().token_type {
            let path = path.clone();
            self.advance();
            self.expect(TokenType::Semicolon, ";")?;
            return Ok(ImportDecl {
                path,
                specifiers: ImportSpecifiers::SideEffect,
                pos,
            });
        }

        // `import { a, b as c } from "./x.lat";`
        self.expect(TokenType::LBrace, "{")?;
        let mut specifiers = Vec::new();
        while !self.check(&TokenType::RBrace) {
            let name_pos = self.peek().pos;
            let name = self.expect_identifier()?;
            let alias = if self.check(&TokenType::As) {
                self.advance();
                Some(self.expect_identifier()?)
            } else {
                None
            };
            specifiers.push(ImportSpecifier { name, alias, pos: name_pos });
            if self.check(&TokenType::Comma) {
                self.advance();
            } else {
                break;
            }
        }
        if specifiers.is_empty() {
            return Err(ParserError::UnexpectedToken {
                expected: "imported name".to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            });
        }
        self.expect(TokenType::RBrace, "}")?;
        self.expect(TokenType::From, "from")?;
        let path = self.expect_string_literal()?;
        self.expect(TokenType::Semicolon, ";")?;

        Ok(ImportDecl {
            path,
            specifiers: ImportSpecifiers::Named(specifiers),
            pos,
        })
    }

    /// Разбор `export fn|class|enum`: возвращает само объявление, а флаг
    /// экспорта складывает в `self.exports` (см. [`Parser::parse`]).
    pub(super) fn parse_export(&mut self) -> Result<Stmt, ParserError> {
        let export_pos = self.peek().pos;
        self.expect(TokenType::Export, "export")?;

        if !(self.check(&TokenType::Fn)
            || self.check(&TokenType::Async)
            || self.check(&TokenType::Class)
            || self.check(&TokenType::Enum))
        {
            return Err(ParserError::UnexpectedToken {
                expected: "fn, class or enum after export".to_string(),
                found: self.peek().token_type.clone(),
                pos: self.peek().pos,
            });
        }

        let stmt = self.parse_declaration()?;
        let name = match &stmt.kind {
            StmtKind::Fn { name, .. }
            | StmtKind::Class { name, .. }
            | StmtKind::Enum { name, .. } => name.clone(),
            // Проверено условием выше; защита от будущих изменений AST.
            _ => {
                return Err(ParserError::UnexpectedToken {
                    expected: "fn, class or enum after export".to_string(),
                    found: TokenType::Export,
                    pos: export_pos,
                })
            }
        };
        self.exports.push(ExportFlag { name, pos: export_pos });
        Ok(stmt)
    }

    /// Ошибка «import/export только на верхнем уровне».
    pub(super) fn reject_nested_module_decl(&self) -> ParserError {
        ParserError::UnexpectedToken {
            expected: "declaration (import/export допустимы только на верхнем уровне)"
                .to_string(),
            found: self.peek().token_type.clone(),
            pos: self.peek().pos,
        }
    }
}
