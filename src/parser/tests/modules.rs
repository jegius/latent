//! Тесты разбора модульных объявлений (`import`/`export`).

use super::super::{Parser, ParserError};
use crate::ast::*;
use crate::lexer::Lexer;

fn parse(source: &str) -> Result<Program, ParserError> {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().unwrap();
    Parser::new(tokens).parse()
}

#[test]
fn test_import_named() {
    let program = parse(r#"import { a, b as c } from "./x.lat";"#).unwrap();
    assert_eq!(program.imports.len(), 1);
    let import = &program.imports[0];
    assert_eq!(import.path, "./x.lat");
    assert_eq!(import.pos.line, 1);
    match &import.specifiers {
        ImportSpecifiers::Named(items) => {
            assert_eq!(items.len(), 2);
            assert_eq!(items[0].name, "a");
            assert_eq!(items[0].alias, None);
            assert_eq!(items[1].name, "b");
            assert_eq!(items[1].alias.as_deref(), Some("c"));
        }
        _ => panic!("expected named import"),
    }
    assert!(program.statements.is_empty());
}

#[test]
fn test_import_side_effect() {
    let program = parse(r#"import "./util.lat";"#).unwrap();
    assert_eq!(program.imports.len(), 1);
    assert_eq!(program.imports[0].path, "./util.lat");
    assert!(matches!(program.imports[0].specifiers, ImportSpecifiers::SideEffect));
}

#[test]
fn test_export_fn_class_enum() {
    let src = "export fn f() -> int { return 1; }\n\
               export class C { x: int; }\n\
               export enum E { A, B(int) }";
    let program = parse(src).unwrap();
    assert_eq!(program.statements.len(), 3);
    assert_eq!(program.exports.len(), 3);
    assert_eq!(program.exports[0].name, "f");
    assert_eq!(program.exports[1].name, "C");
    assert_eq!(program.exports[2].name, "E");
    // export — позиция ключевого слова, у каждого объявления своя строка.
    assert_eq!(program.exports[0].pos.line, 1);
    assert_eq!(program.exports[1].pos.line, 2);
    assert_eq!(program.exports[2].pos.line, 3);
}

#[test]
fn test_export_async_fn() {
    let program = parse("export async fn f() -> int { return 1; }").unwrap();
    assert_eq!(program.exports.len(), 1);
    assert!(matches!(program.statements[0].kind, StmtKind::Fn { is_async: true, .. }));
}

#[test]
fn test_export_only_allowed_for_named_decls() {
    let err = parse("export let x = 1;").unwrap_err();
    let text = err.to_string();
    assert!(text.contains("export"), "{text}");
}

#[test]
fn test_nested_import_is_error() {
    let err = parse("fn main() { import { a } from \"./x.lat\"; }").unwrap_err();
    let text = err.to_string();
    assert!(text.contains("верхнем уровне"), "{text}");
}

#[test]
fn test_nested_export_is_error() {
    let err = parse("fn main() { export fn g() {} }").unwrap_err();
    let text = err.to_string();
    assert!(text.contains("верхнем уровне"), "{text}");
}

#[test]
fn test_import_requires_from() {
    assert!(parse("import { a } \"./x.lat\";").is_err());
}

#[test]
fn test_import_requires_semicolon() {
    assert!(parse(r#"import { a } from "./x.lat""#).is_err());
}

#[test]
fn test_empty_import_list_is_error() {
    assert!(parse(r#"import { } from "./x.lat";"#).is_err());
}

#[test]
fn test_import_inside_decorator_target_is_error() {
    assert!(parse("@test(1) import { a } from \"./x.lat\";").is_err());
}

#[test]
fn test_one_file_program_has_no_module_decls() {
    let program = parse("fn main() -> int { return 0; }").unwrap();
    assert!(program.imports.is_empty());
    assert!(program.exports.is_empty());
    assert_eq!(program.statements.len(), 1);
}

#[test]
fn test_from_and_as_usable_as_identifiers() {
    let program = parse("fn from(as: int) -> int { return as; }").unwrap();
    assert_eq!(program.statements.len(), 1);
    match &program.statements[0].kind {
        StmtKind::Fn { name, params, .. } => {
            assert_eq!(name, "from");
            assert_eq!(params[0].name, "as");
        }
        _ => panic!("expected fn"),
    }
}
