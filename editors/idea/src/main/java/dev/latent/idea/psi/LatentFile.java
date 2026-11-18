package dev.latent.idea.psi;

import com.intellij.extapi.psi.PsiFileBase;
import com.intellij.openapi.fileTypes.FileType;
import com.intellij.psi.FileViewProvider;
import dev.latent.idea.LatentFileType;
import dev.latent.idea.LatentIcons;
import dev.latent.idea.LatentLanguage;
import org.jetbrains.annotations.NotNull;

import javax.swing.Icon;

/** Корневой PSI-элемент файла Latent. */
public class LatentFile extends PsiFileBase {

    public LatentFile(@NotNull FileViewProvider viewProvider) {
        super(viewProvider, LatentLanguage.INSTANCE);
    }

    @Override
    public @NotNull FileType getFileType() {
        return LatentFileType.INSTANCE;
    }

    @Override
    public Icon getIcon(int flags) {
        return LatentIcons.FILE;
    }

    @Override
    public String toString() {
        return "LatentFile:" + getName();
    }
}
