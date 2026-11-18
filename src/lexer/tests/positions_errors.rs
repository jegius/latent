use super::*;

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
