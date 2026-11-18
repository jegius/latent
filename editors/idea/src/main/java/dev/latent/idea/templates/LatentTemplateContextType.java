package dev.latent.idea.templates;

import com.intellij.codeInsight.template.TemplateContextType;
import com.intellij.psi.PsiFile;
import dev.latent.idea.psi.LatentFile;
import org.jetbrains.annotations.NotNull;

/** Контекст live templates для файлов Latent (id {@code LATENT}). */
public final class LatentTemplateContextType extends TemplateContextType {

    public static final String ID = "LATENT";

    public LatentTemplateContextType() {
        super(ID, "Latent");
    }

    @Override
    public boolean isInContext(@NotNull PsiFile file, int offset) {
        return file instanceof LatentFile;
    }
}
