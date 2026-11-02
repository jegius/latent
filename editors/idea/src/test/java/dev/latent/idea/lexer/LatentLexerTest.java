package dev.latent.idea.lexer;

import com.intellij.psi.tree.IElementType;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

/** Тесты IntelliJ-обёртки лексера (без запуска IDE). */
public class LatentLexerTest {

    private static LatentTokenKind nextKind(LatentLexer lexer) {
        IElementType type = lexer.getTokenType();
        return type == null ? null : LatentTokenTypes.kindOf(type);
    }

    @Test
    public void lexerWalksAllTokens() {
        String source = "let x: int = 42;";
        LatentLexer lexer = new LatentLexer();
        lexer.start(source, 0, source.length(), 0);
        assertEquals(LatentTokenKind.LET, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.WHITESPACE, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.IDENTIFIER, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.COLON, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.WHITESPACE, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.TYPE_NAME, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.WHITESPACE, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.EQ, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.WHITESPACE, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.NUMBER, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.SEMICOLON, nextKind(lexer));
        lexer.advance();
        assertNull(nextKind(lexer));
    }

    @Test
    public void lexerSupportsArbitraryStartOffset() {
        String source = "let x = 1;";
        LatentLexer lexer = new LatentLexer();
        lexer.start(source, source.indexOf('x'), source.length(), 0);
        assertEquals(LatentTokenKind.IDENTIFIER, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.WHITESPACE, nextKind(lexer));
        lexer.advance();
        assertEquals(LatentTokenKind.EQ, nextKind(lexer));
    }
}
