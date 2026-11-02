package dev.latent.idea.lexer;

/**
 * Все виды лексем Latent.
 *
 * <p>Модель повторяет Rust-лексер ({@code src/lexer/}): 37 ключевых слов (24 «жёстких»
 * и 13 «мягких»), операторы, литералы, комментарии и ошибочные лексемы. Ошибочные лексемы
 * выделены в отдельные виды, чтобы IDE могла подсветить и объяснить проблему, не прерывая
 * разбор файла (в отличие от fail-fast лексера компилятора).</p>
 */
public enum LatentTokenKind {
    // Служебные
    WHITESPACE,
    LINE_COMMENT,
    BLOCK_COMMENT,
    BLOCK_COMMENT_UNTERMINATED,

    // Литералы
    STRING,
    STRING_UNTERMINATED,
    STRING_INVALID_ESCAPE,
    NUMBER,
    NUMBER_INVALID,

    // Идентификаторы и типы
    IDENTIFIER,
    TYPE_NAME,

    // Жёсткие ключевые слова (24)
    LET,
    FN,
    IF,
    ELSE,
    WHILE,
    FOR,
    IN,
    RETURN,
    CLASS,
    NEW,
    THIS,
    ASYNC,
    AWAIT,
    SPAWN,
    CHANNEL,
    SELECT,
    DEFAULT,
    YIELD,
    MATCH,
    ENUM,
    TRUE,
    FALSE,
    NULL,
    AI,

    // Мягкие ключевые слова (13): допустимы как обычные имена
    TEST,
    ASSERT,
    ASSERT_EQ,
    FORALL,
    SNAPSHOT,
    AI_CONTRACT,
    ENFORCE_CONTRACT,
    MODEL,
    AGENT,
    EMBEDDING,
    TENSOR,
    SEMANTIC,
    CASE,

    // Операторы
    FAT_ARROW,      // =>
    THIN_ARROW,     // ->
    CHANNEL_ARROW,  // <-
    EQ,             // =
    EQEQ,           // ==
    NEQ,            // !=
    LT,             // <
    LTEQ,           // <=
    GT,             // >
    GTEQ,           // >=
    SHL,            // <<
    SHR,            // >>
    PLUS,
    MINUS,
    STAR,
    SLASH,
    PERCENT,
    NOT,
    AMP,            // &
    AMPAMP,         // &&
    PIPE,           // |
    PIPEPIPE,       // ||
    CARET,          // ^
    DOT,
    COMMA,
    SEMICOLON,
    COLON,
    COLONCOLON,     // :: (лексится, но парсером не используется)
    AT,             // @
    LPAREN,
    RPAREN,
    LBRACE,
    RBRACE,
    LBRACKET,
    RBRACKET,

    // Неизвестный символ
    BAD_CHARACTER;

    public boolean isKeyword() {
        return (this.compareTo(LET) >= 0 && this.compareTo(AI) <= 0)
                || isSoftKeyword();
    }

    public boolean isSoftKeyword() {
        return this.compareTo(TEST) >= 0 && this.compareTo(CASE) <= 0;
    }

    public boolean isComment() {
        return this == LINE_COMMENT || this == BLOCK_COMMENT || this == BLOCK_COMMENT_UNTERMINATED;
    }

    public boolean isWhitespace() {
        return this == WHITESPACE;
    }

    public boolean isStringLiteral() {
        return this == STRING || this == STRING_UNTERMINATED || this == STRING_INVALID_ESCAPE;
    }

    public boolean isBad() {
        return this == BAD_CHARACTER || this == NUMBER_INVALID
                || this == STRING_UNTERMINATED || this == STRING_INVALID_ESCAPE
                || this == BLOCK_COMMENT_UNTERMINATED;
    }
}
