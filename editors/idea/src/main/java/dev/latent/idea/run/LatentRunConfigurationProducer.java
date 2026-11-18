package dev.latent.idea.run;

import com.intellij.execution.actions.ConfigurationContext;
import com.intellij.execution.actions.RunConfigurationProducer;
import com.intellij.openapi.util.Ref;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiFile;
import dev.latent.idea.psi.LatentFile;
import dev.latent.idea.structure.LatentStructureParser;
import org.jetbrains.annotations.NotNull;

/** Позволяет запускать текущий .lat-файл из контекстного меню и зелёной кнопки Run. */
public final class LatentRunConfigurationProducer extends RunConfigurationProducer<LatentRunConfiguration> {

    public LatentRunConfigurationProducer() {
        super(LatentRunConfigurationType.getInstance());
    }

    @Override
    protected boolean setupConfigurationFromContext(@NotNull LatentRunConfiguration configuration,
                                                    @NotNull ConfigurationContext context,
                                                    @NotNull Ref<PsiElement> sourceElement) {
        PsiFile file = context.getPsiLocation() == null
                ? null : context.getPsiLocation().getContainingFile();
        if (!(file instanceof LatentFile)) {
            return false;
        }
        VirtualFile virtualFile = file.getVirtualFile();
        if (virtualFile == null) {
            return false;
        }
        // Достаточно, чтобы это был Latent-файл: запуск без main просто ничего не напечатает.
        LatentStructureParser.findMain(file.getText());
        configuration.setFilePath(virtualFile.getPath());
        configuration.setName("Latent " + file.getName());
        sourceElement.set(file);
        return true;
    }

    @Override
    public boolean isConfigurationFromContext(@NotNull LatentRunConfiguration configuration,
                                              @NotNull ConfigurationContext context) {
        PsiFile file = context.getPsiLocation() == null
                ? null : context.getPsiLocation().getContainingFile();
        if (!(file instanceof LatentFile) || file.getVirtualFile() == null) {
            return false;
        }
        return file.getVirtualFile().getPath().equals(configuration.getFilePath());
    }
}
