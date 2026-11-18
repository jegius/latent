package dev.latent.idea.structureview;

import com.intellij.ide.structureView.StructureView;
import com.intellij.ide.structureView.StructureViewBuilder;
import com.intellij.ide.structureView.StructureViewModelBase;
import com.intellij.ide.structureView.StructureViewTreeElement;
import com.intellij.ide.structureView.newStructureView.StructureViewComponent;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiManager;
import dev.latent.idea.psi.LatentFile;
import dev.latent.idea.structure.LatentStructureParser;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/** Structure View для файла Latent: функции, классы (с методами) и enum (с вариантами). */
public final class LatentStructureViewBuilder implements StructureViewBuilder {

    @Override
    public @Nullable StructureView createStructureView(@NotNull FileEditor fileEditor,
                                                       @NotNull Project project) {
        VirtualFile virtualFile = fileEditor.getFile();
        if (virtualFile == null) {
            return null;
        }
        PsiFile psiFile = PsiManager.getInstance(project).findFile(virtualFile);
        if (!(psiFile instanceof LatentFile)) {
            return null;
        }
        StructureViewTreeElement root = new LatentStructureViewElement(
                psiFile, LatentStructureParser.parse(psiFile.getText()));
        StructureViewModelBase model = new StructureViewModelBase(psiFile, root);
        return new StructureViewComponent(fileEditor, model, project, false);
    }
}
