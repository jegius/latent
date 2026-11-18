package dev.latent.idea.lexer;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Рукописный сканер Latent без зависимостей от IntelliJ Platform.
 *
 * <p>Выделен из лексера намеренно: во-первых, его можно тестировать обычным JUnit без
 * инициализации платформы; во-вторых, его же использует структура файла, фолдинг и
 * эвристики запуска. Правила повторяют {@code src/lexer/} Rust-компилятора:</p>
 *
 * <ul>
 *   <li>комментарии {@code //} и вложенные {@code /* ... *&#47;};</li>
 *   <li>строки только в двойных кавычках, escape: {@code \n \t \\ \"};</li>
 *   <li>числа: {@code 42}, {@code 3.14}, {@code 1e10}, {@code 1.5e-3}; {@code 1.} — это
 *       число {@code 1} и точка;</li>
 *   <li>идентификаторы только ASCII: {@code [A-Za-z_][A-Za-z0-9_]*};</li>
 *   <li>операторы: {@code => -> <- && || == != <= >= << >> & | ^ ! %};</li>
 *   <li>{@code @} — начало декоратора; сам декоратор набирается как {@code AT + IDENTIFIER}.</li>
 * </ul>
 */
public final class LatentScanner {

    /** Один токен: вид и полуинтервал {@code [start, end)} в исходном тексте. */
    public static final class Token {
        private final LatentTokenKind kind;
        private final int start;
        private final int end;

        public Token(LatentTokenKind kind, int start, int end) {
            this.kind = kind;
            this.start = start;
            this.end = end;
        }

        public LatentTokenKind getKind() {
            return kind;
        }

        public int getStart() {
            return start;
        }

        public int getEnd() {
            return end;
        }

        public String getText(CharSequence source) {
            return source.subSequence(start, end).toString();
        }

        @Override
        public String toString() {
            return kind + "[" + start + "," + end + ")";
        }
    }

    private static final Map<String, LatentTokenKind> KEYWORDS = new HashMap<>();
    private static final Set<String> TYPE_NAMES = new HashSet<>();

    static {
        KEYWORDS.put("let", LatentTokenKind.LET);
        KEYWORDS.put("fn", LatentTokenKind.FN);
        KEYWORDS.put("if", LatentTokenKind.IF);
        KEYWORDS.put("else", LatentTokenKind.ELSE);
        KEYWORDS.put("while", LatentTokenKind.WHILE);
        KEYWORDS.put("for", LatentTokenKind.FOR);
        KEYWORDS.put("in", LatentTokenKind.IN);
        KEYWORDS.put("return", LatentTokenKind.RETURN);
        KEYWORDS.put("class", LatentTokenKind.CLASS);
        KEYWORDS.put("new", LatentTokenKind.NEW);
        KEYWORDS.put("this", LatentTokenKind.THIS);
        KEYWORDS.put("async", LatentTokenKind.ASYNC);
        KEYWORDS.put("await", LatentTokenKind.AWAIT);
        KEYWORDS.put("spawn", LatentTokenKind.SPAWN);
        KEYWORDS.put("channel", LatentTokenKind.CHANNEL);
        KEYWORDS.put("select", LatentTokenKind.SELECT);
        KEYWORDS.put("case", LatentTokenKind.CASE);
        KEYWORDS.put("default", LatentTokenKind.DEFAULT);
        KEYWORDS.put("yield", LatentTokenKind.YIELD);
        KEYWORDS.put("match", LatentTokenKind.MATCH);
        KEYWORDS.put("enum", LatentTokenKind.ENUM);
        KEYWORDS.put("true", LatentTokenKind.TRUE);
        KEYWORDS.put("false", LatentTokenKind.FALSE);
        KEYWORDS.put("null", LatentTokenKind.NULL);
        KEYWORDS.put("ai", LatentTokenKind.AI);
        KEYWORDS.put("model", LatentTokenKind.MODEL);
        KEYWORDS.put("agent", LatentTokenKind.AGENT);
        KEYWORDS.put("embedding", LatentTokenKind.EMBEDDING);
        KEYWORDS.put("tensor", LatentTokenKind.TENSOR);
        KEYWORDS.put("semantic", LatentTokenKind.SEMANTIC);
        KEYWORDS.put("test", LatentTokenKind.TEST);
        KEYWORDS.put("assert", LatentTokenKind.ASSERT);
        KEYWORDS.put("assert_eq", LatentTokenKind.ASSERT_EQ);
        KEYWORDS.put("forall", LatentTokenKind.FORALL);
        KEYWORDS.put("snapshot", LatentTokenKind.SNAPSHOT);
        KEYWORDS.put("ai_contract", LatentTokenKind.AI_CONTRACT);
        KEYWORDS.put("enforce_contract", LatentTokenKind.ENFORCE_CONTRACT);

        TYPE_NAMES.add("int");
        TYPE_NAMES.add("float");
        TYPE_NAMES.add("bool");
        TYPE_NAMES.add("string");
        TYPE_NAMES.add("void");
        TYPE_NAMES.add("unit");
        TYPE_NAMES.add("Promise");
        TYPE_NAMES.add("Model");
        TYPE_NAMES.add("Embedding");
        TYPE_NAMES.add("Tensor");
        TYPE_NAMES.add("Semantic");
        TYPE_NAMES.add("Contract");
        TYPE_NAMES.add("Channel");
        TYPE_NAMES.add("Array");
        TYPE_NAMES.add("Named");
        TYPE_NAMES.add("Variant");
    }

    private LatentScanner() {
    }

    public static Map<String, LatentTokenKind> keywords() {
        return KEYWORDS;
    }

    public static boolean isTypeName(String name) {
        return TYPE_NAMES.contains(name);
    }

    /** Разбирает весь текст на непрерывную последовательность токенов. */
    public static List<Token> tokenize(CharSequence text) {
        List<Token> tokens = new ArrayList<>();
        int offset = 0;
        int length = text.length();
        while (offset < length) {
            Token token = nextToken(text, offset);
            if (token == null || token.getEnd() <= offset) {
                break;
            }
            tokens.add(token);
            offset = token.getEnd();
        }
        return tokens;
    }

    /**
     * Возвращает следующий токен начиная с {@code offset}.
     * В отличие от компилятора, ошибки не бросаются: проблемные фрагменты получают
     * «плохой» вид токена, чтобы подсветка продолжала работать.
     */
    public static Token nextToken(CharSequence text, int offset) {
        int length = text.length();
        if (offset >= length) {
            return null;
        }
        int i = offset;
        char c = text.charAt(i);

        if (isWhitespace(c)) {
            while (i < length && isWhitespace(text.charAt(i))) {
                i++;
            }
            return new Token(LatentTokenKind.WHITESPACE, offset, i);
        }

        if (c == '/' && i + 1 < length) {
            char next = text.charAt(i + 1);
            if (next == '/') {
                i += 2;
                while (i < length) {
                    char ch = text.charAt(i);
                    if (ch == '\n' || ch == '\r') {
                        break;
                    }
                    i++;
                }
                return new Token(LatentTokenKind.LINE_COMMENT, offset, i);
            }
            if (next == '*') {
                return blockComment(text, offset);
            }
        }

        if (c == '"') {
            return string(text, offset);
        }

        if (isDigit(c)) {
            return number(text, offset);
        }

        if (isIdentifierStart(c)) {
            i++;
            while (i < length && isIdentifierPart(text.charAt(i))) {
                i++;
            }
            String word = text.subSequence(offset, i).toString();
            LatentTokenKind keyword = KEYWORDS.get(word);
            if (keyword != null) {
                return new Token(keyword, offset, i);
            }
            if (TYPE_NAMES.contains(word)) {
                return new Token(LatentTokenKind.TYPE_NAME, offset, i);
            }
            return new Token(LatentTokenKind.IDENTIFIER, offset, i);
        }

        return operatorOrBadCharacter(text, offset);
    }

    private static Token blockComment(CharSequence text, int offset) {
        int length = text.length();
        int i = offset + 2;
        int depth = 1;
        while (i < length) {
            char ch = text.charAt(i);
            if (ch == '/' && i + 1 < length && text.charAt(i + 1) == '*') {
                depth++;
                i += 2;
            } else if (ch == '*' && i + 1 < length && text.charAt(i + 1) == '/') {
                depth--;
                i += 2;
                if (depth == 0) {
                    return new Token(LatentTokenKind.BLOCK_COMMENT, offset, i);
                }
            } else {
                i++;
            }
        }
        return new Token(LatentTokenKind.BLOCK_COMMENT_UNTERMINATED, offset, length);
    }

    private static Token string(CharSequence text, int offset) {
        int length = text.length();
        int i = offset + 1;
        boolean invalidEscape = false;
        while (i < length) {
            char ch = text.charAt(i);
            if (ch == '\n' || ch == '\r') {
                return new Token(LatentTokenKind.STRING_UNTERMINATED, offset, i);
            }
            if (ch == '"') {
                return new Token(
                        invalidEscape ? LatentTokenKind.STRING_INVALID_ESCAPE : LatentTokenKind.STRING,
                        offset, i + 1);
            }
            if (ch == '\\') {
                if (i + 1 >= length) {
                    return new Token(LatentTokenKind.STRING_UNTERMINATED, offset, length);
                }
                char escaped = text.charAt(i + 1);
                if (escaped == 'n' || escaped == 't' || escaped == '\\' || escaped == '"') {
                    i += 2;
                } else if (escaped == '\n' || escaped == '\r') {
                    return new Token(LatentTokenKind.STRING_UNTERMINATED, offset, i);
                } else {
                    invalidEscape = true;
                    i += 2;
                }
            } else {
                i++;
            }
        }
        return new Token(LatentTokenKind.STRING_UNTERMINATED, offset, length);
    }

    private static Token number(CharSequence text, int offset) {
        int length = text.length();
        int i = offset;
        while (i < length && isDigit(text.charAt(i))) {
            i++;
        }
        if (i + 1 < length && text.charAt(i) == '.' && isDigit(text.charAt(i + 1))) {
            i++;
            while (i < length && isDigit(text.charAt(i))) {
                i++;
            }
        }
        if (i < length && (text.charAt(i) == 'e' || text.charAt(i) == 'E')) {
            int j = i + 1;
            if (j < length && (text.charAt(j) == '+' || text.charAt(j) == '-')) {
                j++;
            }
            if (j < length && isDigit(text.charAt(j))) {
                i = j;
                while (i < length && isDigit(text.charAt(i))) {
                    i++;
                }
            } else {
                return new Token(LatentTokenKind.NUMBER_INVALID, offset, Math.min(j, length));
            }
        }
        return new Token(LatentTokenKind.NUMBER, offset, i);
    }

    private static Token operatorOrBadCharacter(CharSequence text, int offset) {
        int length = text.length();
        char c = text.charAt(offset);
        boolean hasNext = offset + 1 < length;
        char next = hasNext ? text.charAt(offset + 1) : '\0';

        switch (c) {
            case '=':
                if (next == '=') {
                    return token(LatentTokenKind.EQEQ, offset, 2);
                }
                if (next == '>') {
                    return token(LatentTokenKind.FAT_ARROW, offset, 2);
                }
                return token(LatentTokenKind.EQ, offset, 1);
            case '-':
                if (next == '>') {
                    return token(LatentTokenKind.THIN_ARROW, offset, 2);
                }
                return token(LatentTokenKind.MINUS, offset, 1);
            case '<':
                if (next == '=') {
                    return token(LatentTokenKind.LTEQ, offset, 2);
                }
                if (next == '-') {
                    return token(LatentTokenKind.CHANNEL_ARROW, offset, 2);
                }
                if (next == '<') {
                    return token(LatentTokenKind.SHL, offset, 2);
                }
                return token(LatentTokenKind.LT, offset, 1);
            case '>':
                if (next == '=') {
                    return token(LatentTokenKind.GTEQ, offset, 2);
                }
                if (next == '>') {
                    return token(LatentTokenKind.SHR, offset, 2);
                }
                return token(LatentTokenKind.GT, offset, 1);
            case '!':
                if (next == '=') {
                    return token(LatentTokenKind.NEQ, offset, 2);
                }
                return token(LatentTokenKind.NOT, offset, 1);
            case '&':
                if (next == '&') {
                    return token(LatentTokenKind.AMPAMP, offset, 2);
                }
                return token(LatentTokenKind.AMP, offset, 1);
            case '|':
                if (next == '|') {
                    return token(LatentTokenKind.PIPEPIPE, offset, 2);
                }
                return token(LatentTokenKind.PIPE, offset, 1);
            case ':':
                if (next == ':') {
                    return token(LatentTokenKind.COLONCOLON, offset, 2);
                }
                return token(LatentTokenKind.COLON, offset, 1);
            case '+':
                return token(LatentTokenKind.PLUS, offset, 1);
            case '*':
                return token(LatentTokenKind.STAR, offset, 1);
            case '/':
                return token(LatentTokenKind.SLASH, offset, 1);
            case '%':
                return token(LatentTokenKind.PERCENT, offset, 1);
            case '^':
                return token(LatentTokenKind.CARET, offset, 1);
            case '.':
                return token(LatentTokenKind.DOT, offset, 1);
            case ',':
                return token(LatentTokenKind.COMMA, offset, 1);
            case ';':
                return token(LatentTokenKind.SEMICOLON, offset, 1);
            case '@':
                return token(LatentTokenKind.AT, offset, 1);
            case '(':
                return token(LatentTokenKind.LPAREN, offset, 1);
            case ')':
                return token(LatentTokenKind.RPAREN, offset, 1);
            case '{':
                return token(LatentTokenKind.LBRACE, offset, 1);
            case '}':
                return token(LatentTokenKind.RBRACE, offset, 1);
            case '[':
                return token(LatentTokenKind.LBRACKET, offset, 1);
            case ']':
                return token(LatentTokenKind.RBRACKET, offset, 1);
            default:
                int codePoint = Character.codePointAt(text, offset);
                int charCount = Character.charCount(codePoint);
                return new Token(LatentTokenKind.BAD_CHARACTER, offset,
                        Math.min(offset + charCount, length));
        }
    }

    private static Token token(LatentTokenKind kind, int offset, int length) {
        return new Token(kind, offset, offset + length);
    }

    private static boolean isWhitespace(char c) {
        return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f'
                || Character.isWhitespace(c);
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }

    private static boolean isIdentifierStart(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
    }

    private static boolean isIdentifierPart(char c) {
        return isIdentifierStart(c) || isDigit(c);
    }
}
