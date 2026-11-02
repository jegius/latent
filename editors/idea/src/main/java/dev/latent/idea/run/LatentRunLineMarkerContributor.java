package dev.latent.idea.run;

import com.intellij.execution.lineMarker.RunLineMarkerContributor;
import com.intellij.icons.AllIcons;
import com.intellij.psi.PsiElement;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.lexer.LatentTokenTypes;
import dev.latent.idea.structure.LatentStructureParser;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/** Зелёная кнопка Run в gutter напротив {@code fn main}. */
public final class LatentRunLineMarkerContributor extends RunLineMarkerContributor {

    @Override
    public @Nullable Info getInfo(@NotNull PsiElement element) {
        if (element.getNode() == null) {
            return null;
        }
        if (LatentTokenTypes.kindOf(element.getNode().getElementType()) != LatentTokenKind.FN) {
            return null;
        }
        PsiElement name = nextSignificant(element);
        if (name == null || !"main".equals(name.getText())) {
            return null;
        }
        if (!(element.getContainingFile() != null
                && LatentStructureParser.hasMain(element.getContainingFile().getText()))) {
            return null;
        }
        return withExecutorActions(AllIcons.RunConfigurations.TestState.Run);
    }

    private static PsiElement nextSignificant(PsiElement element) {
        PsiElement next = element.getNextSibling();
        while (next != null) {
            if (next.getNode() != null
                    && LatentTokenTypes.kindOf(next.getNode().getElementType()) != null) {
                LatentTokenKind kind = LatentTokenTypes.kindOf(next.getNode().getElementType());
                if (kind != LatentTokenKind.WHITESPACE && !kind.isComment()) {
                    return next;
                }
            }
            next = next.getNextSibling();
        }
        return null;
    }
}
