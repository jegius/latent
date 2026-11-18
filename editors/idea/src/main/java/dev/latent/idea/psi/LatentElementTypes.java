package dev.latent.idea.psi;

import com.intellij.psi.tree.IFileElementType;
import com.intellij.psi.tree.IElementType;
import dev.latent.idea.LatentLanguage;

/** Составные элементы PSI-дерева Latent. */
public final class LatentElementTypes {

    public static final IFileElementType FILE =
            new IFileElementType("LATENT_FILE", LatentLanguage.INSTANCE);

    public static final IElementType FUNCTION =
            new IElementType("LATENT_FUNCTION", LatentLanguage.INSTANCE);
    public static final IElementType CLASS =
            new IElementType("LATENT_CLASS", LatentLanguage.INSTANCE);
    public static final IElementType ENUM =
            new IElementType("LATENT_ENUM", LatentLanguage.INSTANCE);
    public static final IElementType BLOCK =
            new IElementType("LATENT_BLOCK", LatentLanguage.INSTANCE);

    private LatentElementTypes() {
    }
}
