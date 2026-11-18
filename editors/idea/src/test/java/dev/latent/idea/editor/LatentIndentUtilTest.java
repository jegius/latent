package dev.latent.idea.editor;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

/** Тесты чистой логики отступов. */
public class LatentIndentUtilTest {

    @Test
    public void afterOpeningBraceIndentsByFour() {
        String text = "fn main() {\n";
        int lineStart = text.length();
        assertEquals(4, LatentIndentUtil.computeIndent(text, lineStart, lineStart));
    }

    @Test
    public void keepsIndentOnBlankLineInsideBlock() {
        String text = "fn main() {\n    let x = 1;\n";
        int lineStart = text.length();
        assertEquals(4, LatentIndentUtil.computeIndent(text, lineStart, lineStart));
    }

    @Test
    public void closingBraceDedents() {
        String text = "fn main() {\n    let x = 1;\n}\n";
        int lineStart = text.indexOf("}");
        assertEquals(0, LatentIndentUtil.computeIndent(text, lineStart, lineStart));
    }

    @Test
    public void typingClosingBraceDedentsInsideBlock() {
        String text = "fn main() {\n    if (true) {\n        let x = 1;\n    }";
        int lineStart = text.lastIndexOf('\n') + 1;
        assertEquals(4, LatentIndentUtil.computeIndent(text, lineStart, lineStart));
    }

    @Test
    public void tabsCountAsFourSpaces() {
        String text = "fn main() {\n\tlet x = 1;\n";
        int lineStart = text.length();
        assertEquals(4, LatentIndentUtil.computeIndent(text, lineStart, lineStart));
    }
}
