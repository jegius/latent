//! Тесты покрытия: ветки ошибок парсера (диагностика).

use super::*;

/// Возвращает Some(текст ошибки) если парсинг упал; лексические ошибки и
/// панику считаем тоже ошибкой (но проверяем, что паники нет).
fn parse_err(source: &str) -> Option<String> {
    let mut lexer = Lexer::new(source);
    let tokens = match lexer.tokenize() {
        Ok(t) => t,
        Err(e) => return Some(e.to_string()),
    };
    let mut parser = Parser::new(tokens);
    match parser.parse() {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    }
}

#[test]
fn test_missing_tokens_and_delimiters() {
    let cases = [
        "let x = ;",
        "let = 5;",
        "fn f( { }",
        "fn f() -> { }",
        "fn f() { let x = 1; ",
        "if (1 > 0 { }",
        "if (1 > 0) { } else ",
        "while (1 > 0 { }",
        "for (let x in ) { }",
        "class { }",
        "class P { x: }",
        "enum E { A( }",
        "match x { case 1 2, };",
        "let f = fn( => 1;",
        "x = ;",
        "1 + ;",
        "(1 + 2;",
        "arr[;",
        "obj.;",
        "select { case <- : }",
        "test { }",
    ];
    let errors = cases.iter().filter(|src| parse_err(src).is_some()).count();
    assert_eq!(errors, cases.len(), "не все битые программы дали ошибку");
}

#[test]
fn test_error_text_is_nonempty() {
    for src in ["let x = ;", "fn f( { }", "if (1 > 0 { }"] {
        let err = parse_err(src).unwrap();
        assert!(!err.is_empty());
    }
}

#[test]
fn test_unexpected_and_eof_errors() {
    assert!(parse_err("fn f() -> int { return 1 }").is_some());
    assert!(parse_err("}").is_some());
    assert!(parse_err("let x: int = 1; extra := 2;").is_some());
    assert!(parse_err("fn f() -> int { return 1; } garbage").is_some());
}

#[test]
fn test_expression_error_branches() {
    let cases = [
        "let x = 1.2.3;",
        "let x = 'a';",
        "let x = new;",
        "let x = new P;",
        "let x = ch <- ;",
        "let x = <-;",
        "let x = await;",
        "let x = match { };",
        "let x = select { };",
        "class P { fn m(a: int { } }",
        "class P { x: int }",
        "let x = fn(x) => ;",
        "let x = [1, 2;",
        "let x = {1: 2};",
        "let x = 1 ? 2 : 3;",
    ];
    let mut errors = 0;
    for src in cases {
        if parse_err(src).is_some() {
            errors += 1;
        }
    }
    // Большинство конструкций вне грамматики Latent — ошибки.
    assert!(errors >= 10, "ошибок только {errors}");
}

#[test]
fn test_valid_edge_syntax_parses() {
    let cases = [
        "let e = [];",
        "let o = [1, [2, 3]];",
        "let l = fn() => 1;",
        "fn f(a: [int], b: fn(int) -> int) { }",
        "enum E { A, B(int), C(string) }",
        "class P { x: int; fn init(x) { this.x = x; } }",
        "let x = (1 + 2) * 3;",
        "let x = a.b.c[0];",
        "for (let x in arr) { }",
        "while (true) { }",
        "test \"n\" { assert(true); }",
        "async fn f() -> int { return 1; }",
        "@test(\"n\") fn g() { }",
        "let x = 1e3;",
        "let x = 0.5;",
    ];
    for src in cases {
        let mut lexer = Lexer::new(src);
        let tokens = lexer.tokenize().unwrap();
        let mut parser = Parser::new(tokens);
        assert!(parser.parse().is_ok(), "не разобрано: {src:?}");
    }
}
