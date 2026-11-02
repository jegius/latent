package dev.latent.idea.highlight;

import com.intellij.openapi.editor.colors.TextAttributesKey;
import dev.latent.idea.lexer.LatentTokenKind;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

/** Проверяет соответствие «вид лексемы → ключ подсветки». */
public class LatentHighlightingKeysTest {

    @Test
    public void keywordsAndSoftKeywords() {
        assertEquals(LatentHighlightingKeys.KEYWORD,
                LatentHighlightingKeys.keysFor(LatentTokenKind.LET)[0]);
        assertEquals(LatentHighlightingKeys.SOFT_KEYWORD,
                LatentHighlightingKeys.keysFor(LatentTokenKind.TEST)[0]);
        assertEquals(LatentHighlightingKeys.BOOLEAN,
                LatentHighlightingKeys.keysFor(LatentTokenKind.TRUE)[0]);
    }

    @Test
    public void literalsAndTypes() {
        assertEquals(LatentHighlightingKeys.STRING,
                LatentHighlightingKeys.keysFor(LatentTokenKind.STRING)[0]);
        assertEquals(LatentHighlightingKeys.NUMBER,
                LatentHighlightingKeys.keysFor(LatentTokenKind.NUMBER)[0]);
        assertEquals(LatentHighlightingKeys.TYPE,
                LatentHighlightingKeys.keysFor(LatentTokenKind.TYPE_NAME)[0]);
    }

    @Test
    public void commentsAndOperators() {
        assertEquals(LatentHighlightingKeys.COMMENT,
                LatentHighlightingKeys.keysFor(LatentTokenKind.LINE_COMMENT)[0]);
        assertEquals(LatentHighlightingKeys.OPERATOR,
                LatentHighlightingKeys.keysFor(LatentTokenKind.PLUS)[0]);
        assertEquals(LatentHighlightingKeys.ANNOTATION,
                LatentHighlightingKeys.keysFor(LatentTokenKind.AT)[0]);
    }

    @Test
    public void badTokensIncludeErrorKey() {
        TextAttributesKey[] keys = LatentHighlightingKeys.keysFor(LatentTokenKind.BAD_CHARACTER);
        assertEquals(1, keys.length);
        assertEquals(LatentHighlightingKeys.ERROR, keys[0]);
    }

    @Test
    public void whitespaceHasNoKeys() {
        assertEquals(0, LatentHighlightingKeys.keysFor(LatentTokenKind.WHITESPACE).length);
    }
}
