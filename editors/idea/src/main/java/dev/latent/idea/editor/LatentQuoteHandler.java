package dev.latent.idea.editor;

import com.intellij.codeInsight.editorActions.QuoteHandler;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.highlighter.HighlighterIterator;
import com.intellij.psi.tree.IElementType;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.lexer.LatentTokenTypes;

/** Автозакрытие и «перепрыгивание» двойных кавычек в строках Latent. */
public final class LatentQuoteHandler implements QuoteHandler {

    @Override
    public boolean isClosingQuote(HighlighterIterator iterator, int offset) {
        IElementType type = iterator.getTokenType();
        if (!isString(type)) {
            return false;
        }
        CharSequence text = iterator.getDocument().getCharsSequence();
        return offset == iterator.getEnd() - 1
                && offset >= 0 && offset < text.length()
                && text.charAt(offset) == '"';
    }

    @Override
    public boolean isOpeningQuote(HighlighterIterator iterator, int offset) {
        IElementType type = iterator.getTokenType();
        if (!isString(type)) {
            return false;
        }
        CharSequence text = iterator.getDocument().getCharsSequence();
        return offset == iterator.getStart()
                && offset >= 0 && offset < text.length()
                && text.charAt(offset) == '"';
    }

    @Override
    public boolean hasNonClosedLiteral(Editor editor, HighlighterIterator iterator, int offset) {
        if (!isString(iterator.getTokenType())) {
            return false;
        }
        CharSequence text = iterator.getDocument().getCharsSequence();
        int quotes = 0;
        for (int i = iterator.getStart(); i < offset && i < text.length(); i++) {
            if (text.charAt(i) == '"' && (i == 0 || text.charAt(i - 1) != '\\')) {
                quotes++;
            }
        }
        return quotes % 2 == 1;
    }

    @Override
    public boolean isInsideLiteral(HighlighterIterator iterator) {
        return isString(iterator.getTokenType());
    }

    private static boolean isString(IElementType type) {
        LatentTokenKind kind = LatentTokenTypes.kindOf(type);
        return kind != null && kind.isStringLiteral();
    }
}
