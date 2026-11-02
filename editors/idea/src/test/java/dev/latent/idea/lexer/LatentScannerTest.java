package dev.latent.idea.lexer;

import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/** Тесты рукописного сканера (без IntelliJ Platform). */
public class LatentScannerTest {

    private static List<LatentScanner.Token> scan(String text) {
        return LatentScanner.tokenize(text);
    }

    private static LatentTokenKind kindAt(List<LatentScanner.Token> tokens, int index) {
        return tokens.get(index).getKind();
    }

    @Test
    public void allThirtySevenKeywordsAreRecognized() {
        String source = "let fn if else while for in return class new this async await spawn "
                + "channel select case default yield match enum true false null ai model agent "
                + "embedding tensor semantic test assert assert_eq forall snapshot ai_contract "
                + "enforce_contract";
        List<LatentScanner.Token> tokens = scan(source);
        List<LatentScanner.Token> words = new java.util.ArrayList<>();
        for (LatentScanner.Token token : tokens) {
            if (!token.getKind().isWhitespace()) {
                words.add(token);
            }
        }
        assertEquals(37, words.size());
        for (LatentScanner.Token token : words) {
            assertTrue("должно быть ключевым словом: " + token.getKind(),
                    token.getKind().isKeyword());
        }
        assertEquals(LatentTokenKind.CASE, words.get(16).getKind());
        assertEquals(LatentTokenKind.AI_CONTRACT, words.get(35).getKind());
    }

    @Test
    public void softKeywordsAreMarkedAsSoft() {
        assertTrue(LatentTokenKind.TEST.isSoftKeyword());
        assertTrue(LatentTokenKind.CASE.isSoftKeyword());
        assertTrue(!LatentTokenKind.LET.isSoftKeyword());
        assertTrue(LatentTokenKind.LET.isKeyword());
    }

    @Test
    public void nestedBlockCommentIsSingleToken() {
        List<LatentScanner.Token> tokens = scan("/* a /* b */ c */ x");
        assertEquals(3, tokens.size());
        assertEquals(LatentTokenKind.BLOCK_COMMENT, kindAt(tokens, 0));
        assertEquals("/* a /* b */ c */",
                tokens.get(0).getText("/* a /* b */ c */ x"));
    }

    @Test
    public void unterminatedBlockComment() {
        List<LatentScanner.Token> tokens = scan("/* a /* b */");
        assertEquals(1, tokens.size());
        assertEquals(LatentTokenKind.BLOCK_COMMENT_UNTERMINATED, kindAt(tokens, 0));
    }

    @Test
    public void lineCommentStopsAtNewline() {
        List<LatentScanner.Token> tokens = scan("// x\nlet");
        assertEquals(3, tokens.size());
        assertEquals(LatentTokenKind.LINE_COMMENT, kindAt(tokens, 0));
        assertEquals("\n", tokens.get(1).getText("// x\nlet"));
        assertEquals(LatentTokenKind.LET, kindAt(tokens, 2));
    }

    @Test
    public void stringEscapes() {
        List<LatentScanner.Token> tokens = scan("\"a\\n\\t\\\\\\\"b\"");
        assertEquals(1, tokens.size());
        assertEquals(LatentTokenKind.STRING, kindAt(tokens, 0));
    }

    @Test
    public void unterminatedStringDoesNotConsumeNewline() {
        List<LatentScanner.Token> tokens = scan("\"abc\nlet");
        assertEquals(LatentTokenKind.STRING_UNTERMINATED, kindAt(tokens, 0));
        assertEquals(LatentTokenKind.WHITESPACE, kindAt(tokens, 1));
        assertEquals(LatentTokenKind.LET, kindAt(tokens, 2));
    }

    @Test
    public void invalidEscapeIsReportedButStringContinues() {
        List<LatentScanner.Token> tokens = scan("\"a\\qb\"");
        assertEquals(1, tokens.size());
        assertEquals(LatentTokenKind.STRING_INVALID_ESCAPE, kindAt(tokens, 0));
    }

    @Test
    public void numbers() {
        List<LatentScanner.Token> tokens = scan("42 3.14 1e10 1.5e-3");
        assertEquals(7, tokens.size());
        assertEquals(LatentTokenKind.NUMBER, kindAt(tokens, 0));
        assertEquals("3.14", tokens.get(2).getText("42 3.14 1e10 1.5e-3"));
        assertEquals("1e10", tokens.get(4).getText("42 3.14 1e10 1.5e-3"));
        assertEquals("1.5e-3", tokens.get(6).getText("42 3.14 1e10 1.5e-3"));
    }

    @Test
    public void dotAfterNumberIsSeparateToken() {
        List<LatentScanner.Token> tokens = scan("1.foo");
        assertEquals(LatentTokenKind.NUMBER, kindAt(tokens, 0));
        assertEquals(LatentTokenKind.DOT, kindAt(tokens, 1));
        assertEquals(LatentTokenKind.IDENTIFIER, kindAt(tokens, 2));
    }

    @Test
    public void badExponent() {
        List<LatentScanner.Token> tokens = scan("1e+");
        assertEquals(1, tokens.size());
        assertEquals(LatentTokenKind.NUMBER_INVALID, kindAt(tokens, 0));
    }

    @Test
    public void operators() {
        String source = "=> -> <- && || == != <= >= << >> & | ^ ! % :: = + - * /";
        List<LatentScanner.Token> tokens = scan(source);
        LatentTokenKind[] expected = {
                LatentTokenKind.FAT_ARROW, LatentTokenKind.THIN_ARROW,
                LatentTokenKind.CHANNEL_ARROW, LatentTokenKind.AMPAMP,
                LatentTokenKind.PIPEPIPE, LatentTokenKind.EQEQ, LatentTokenKind.NEQ,
                LatentTokenKind.LTEQ, LatentTokenKind.GTEQ, LatentTokenKind.SHL,
                LatentTokenKind.SHR, LatentTokenKind.AMP, LatentTokenKind.PIPE,
                LatentTokenKind.CARET, LatentTokenKind.NOT, LatentTokenKind.PERCENT,
                LatentTokenKind.COLONCOLON, LatentTokenKind.EQ, LatentTokenKind.PLUS,
                LatentTokenKind.MINUS, LatentTokenKind.STAR, LatentTokenKind.SLASH,
        };
        int index = 0;
        for (LatentTokenKind kind : expected) {
            assertEquals(kind, tokens.get(index).getKind());
            index += 2;
        }
    }

    @Test
    public void decoratorTokens() {
        List<LatentScanner.Token> tokens = scan("@test(\"x\")");
        assertEquals(LatentTokenKind.AT, kindAt(tokens, 0));
        assertEquals(LatentTokenKind.TEST, kindAt(tokens, 1));
        assertEquals(LatentTokenKind.LPAREN, kindAt(tokens, 2));
        assertEquals(LatentTokenKind.STRING, kindAt(tokens, 3));
        assertEquals(LatentTokenKind.RPAREN, kindAt(tokens, 4));
    }

    @Test
    public void identifiersAndTypeNames() {
        List<LatentScanner.Token> tokens = scan("int _x x1 Promise");
        assertEquals(LatentTokenKind.TYPE_NAME, kindAt(tokens, 0));
        assertEquals(LatentTokenKind.IDENTIFIER, kindAt(tokens, 2));
        assertEquals(LatentTokenKind.TYPE_NAME, kindAt(tokens, 6));
    }

    @Test
    public void nonAsciiIdentifierIsBadCharacter() {
        List<LatentScanner.Token> tokens = scan("let имя = 1;");
        assertEquals(LatentTokenKind.LET, kindAt(tokens, 0));
        assertEquals(LatentTokenKind.BAD_CHARACTER, kindAt(tokens, 2));
    }

    @Test
    public void tokenizeCoversWholeSourceWithoutGaps() {
        String source = "// comment\n"
                + "fn main() -> int {\n"
                + "    let xs: [int] = [1, 2, 3];\n"
                + "    for (let x in xs) { print(\"v\", x); }\n"
                + "    if (xs[0] >= 1 && true) { return 0; } else { return 1; }\n"
                + "}\n";
        List<LatentScanner.Token> tokens = scan(source);
        StringBuilder rebuilt = new StringBuilder();
        int expectedStart = 0;
        for (LatentScanner.Token token : tokens) {
            assertEquals(expectedStart, token.getStart());
            assertTrue(token.getEnd() > token.getStart());
            expectedStart = token.getEnd();
            rebuilt.append(token.getText(source));
        }
        assertEquals(source.length(), expectedStart);
        assertEquals(source, rebuilt.toString());
        for (LatentScanner.Token token : tokens) {
            assertNotNull(token.getKind());
            assertTrue("неожиданный BAD_CHARACTER", token.getKind() != LatentTokenKind.BAD_CHARACTER);
        }
    }
}
