package dev.latent.idea.folding;

import com.intellij.lang.ASTNode;
import com.intellij.lang.folding.FoldingBuilder;
import com.intellij.lang.folding.FoldingDescriptor;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.util.TextRange;
import com.intellij.psi.tree.IElementType;
import dev.latent.idea.lexer.LatentTokenKind;
import dev.latent.idea.lexer.LatentTokenTypes;
import dev.latent.idea.psi.LatentElementTypes;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;

/** Сворачивание блоков {@code { ... }}, классов/enum и многострочных комментариев. */
public final class LatentFoldingBuilder implements FoldingBuilder {

    @Override
    public FoldingDescriptor @NotNull [] buildFoldRegions(@NotNull ASTNode node,
                                                          @NotNull Document document) {
        List<FoldingDescriptor> result = new ArrayList<>();
        collect(node, result);
        return result.toArray(FoldingDescriptor.EMPTY_ARRAY);
    }

    private void collect(ASTNode node, List<FoldingDescriptor> out) {
        IElementType type = node.getElementType();
        TextRange range = node.getTextRange();
        if (type == LatentElementTypes.BLOCK) {
            addIfUseful(node, range, "{ ... }", out);
        } else if (type == LatentElementTypes.CLASS || type == LatentElementTypes.ENUM) {
            addIfUseful(node, range, "{ ... }", out);
        } else if (type == LatentTokenTypes.of(LatentTokenKind.BLOCK_COMMENT)) {
            if (range.getLength() > 4 && node.getText().contains("\n")) {
                addIfUseful(node, range, "/* ... */", out);
            }
        }
        for (ASTNode child = node.getFirstChildNode(); child != null; child = child.getTreeNext()) {
            collect(child, out);
        }
    }

    private void addIfUseful(ASTNode node, TextRange range, String placeholder,
                             List<FoldingDescriptor> out) {
        if (range.getLength() <= 2) {
            return;
        }
        FoldingDescriptor descriptor = new FoldingDescriptor(node, range);
        descriptor.setPlaceholderText(placeholder);
        out.add(descriptor);
    }

    @Override
    public @Nullable String getPlaceholderText(@NotNull ASTNode node) {
        return null;
    }

    @Override
    public boolean isCollapsedByDefault(@NotNull ASTNode node) {
        return false;
    }
}
