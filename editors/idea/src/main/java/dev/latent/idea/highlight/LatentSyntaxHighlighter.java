package dev.latent.idea.highlight;

import com.intellij.lexer.Lexer;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.openapi.fileTypes.SyntaxHighlighterBase;
import com.intellij.psi.tree.IElementType;
import dev.latent.idea.lexer.LatentLexer;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.lexer.LatentTokenTypes;
import org.jetbrains.annotations.NotNull;

/** Подсветка синтаксиса Latent на уровне токенов. */
public final class LatentSyntaxHighlighter extends SyntaxHighlighterBase {

    @Override
    public @NotNull Lexer getHighlightingLexer() {
        return new LatentLexer();
    }

    @Override
    public TextAttributesKey @NotNull [] getTokenHighlights(IElementType tokenType) {
        LatentTokenKind kind = LatentTokenTypes.kindOf(tokenType);
        if (kind == null) {
            return EMPTY;
        }
        return LatentHighlightingKeys.keysFor(kind);
    }
}
