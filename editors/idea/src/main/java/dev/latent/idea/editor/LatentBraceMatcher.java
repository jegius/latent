package dev.latent.idea.editor;

import com.intellij.lang.BracePair;
import com.intellij.lang.PairedBraceMatcher;
import com.intellij.psi.PsiFile;
import com.intellij.psi.tree.IElementType;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.lexer.LatentTokenTypes;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/** Парные скобки Latent: {@code {}}, {@code ()}, {@code []}. */
public final class LatentBraceMatcher implements PairedBraceMatcher {

    private static final BracePair[] PAIRS = {
            new BracePair(LatentTokenTypes.of(LatentTokenKind.LBRACE),
                    LatentTokenTypes.of(LatentTokenKind.RBRACE), true),
            new BracePair(LatentTokenTypes.of(LatentTokenKind.LPAREN),
                    LatentTokenTypes.of(LatentTokenKind.RPAREN), false),
            new BracePair(LatentTokenTypes.of(LatentTokenKind.LBRACKET),
                    LatentTokenTypes.of(LatentTokenKind.RBRACKET), false),
    };

    @Override
    public BracePair @NotNull [] getPairs() {
        return PAIRS;
    }

    @Override
    public boolean isPairedBracesAllowedBeforeType(@NotNull IElementType lbraceType,
                                                   @Nullable IElementType contextType) {
        return true;
    }

    @Override
    public int getCodeConstructStart(PsiFile file, int openingBraceOffset) {
        return openingBraceOffset;
    }
}
