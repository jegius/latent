package dev.latent.idea.structureview;

import com.intellij.icons.AllIcons;
import com.intellij.ide.structureView.StructureViewTreeElement;
import com.intellij.ide.util.treeView.smartTree.TreeElement;
import com.intellij.navigation.ItemPresentation;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiFile;
import dev.latent.idea.LatentIcons;
import dev.latent.idea.structure.LatentStructureSymbol;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;
import java.util.ArrayList;
import java.util.List;

/** Элемент дерева Structure View: файл, функции, классы, enum и их методы. */
public final class LatentStructureViewElement implements StructureViewTreeElement {

    private final PsiFile file;
    private final LatentStructureSymbol symbol;
    private final List<LatentStructureViewElement> children = new ArrayList<>();

    public LatentStructureViewElement(@NotNull PsiFile file, @Nullable LatentStructureSymbol symbol) {
        this.file = file;
        this.symbol = symbol;
        if (symbol != null) {
            for (LatentStructureSymbol child : symbol.getChildren()) {
                children.add(new LatentStructureViewElement(file, child));
            }
        }
    }

    /** Корневой элемент файла со списком объявлений верхнего уровня. */
    public LatentStructureViewElement(@NotNull PsiFile file,
                                      @NotNull List<LatentStructureSymbol> topLevel) {
        this.file = file;
        this.symbol = null;
        for (LatentStructureSymbol child : topLevel) {
            children.add(new LatentStructureViewElement(file, child));
        }
    }

    @Override
    public Object getValue() {
        return symbol == null ? file : symbol;
    }

    @Override
    public @NotNull TreeElement @NotNull [] getChildren() {
        return children.toArray(TreeElement.EMPTY_ARRAY);
    }

    @Override
    public @NotNull ItemPresentation getPresentation() {
        String name = symbol == null ? file.getName() : symbol.getName();
        String location = symbol == null ? null : symbol.getKind().getRussianName();
        Icon icon = symbol == null ? LatentIcons.FILE : iconFor(symbol.getKind());
        return new LatentItemPresentation(name, location, icon);
    }

    private static Icon iconFor(LatentStructureSymbol.Kind kind) {
        switch (kind) {
            case FUNCTION:
                return AllIcons.Nodes.Function;
            case CLASS:
            case ENUM:
                return AllIcons.Nodes.Class;
            case VARIANT:
            default:
                return AllIcons.Nodes.Field;
        }
    }

    @Override
    public void navigate(boolean requestFocus) {
        int offset = symbol == null ? 0 : symbol.getOffset();
        VirtualFile virtualFile = file.getVirtualFile();
        if (virtualFile == null) {
            return;
        }
        Project project = file.getProject();
        new OpenFileDescriptor(project, virtualFile, offset).navigate(requestFocus);
    }

    @Override
    public boolean canNavigate() {
        return file.getVirtualFile() != null;
    }

    @Override
    public boolean canNavigateToSource() {
        return canNavigate();
    }

    private static final class LatentItemPresentation implements ItemPresentation {
        private final String name;
        private final String location;
        private final Icon icon;

        private LatentItemPresentation(String name, @Nullable String location, Icon icon) {
            this.name = name;
            this.location = location;
            this.icon = icon;
        }

        @Override
        public @NotNull String getPresentableText() {
            return name;
        }

        @Override
        public @Nullable String getLocationString() {
            return location;
        }

        @Override
        public @Nullable Icon getIcon(boolean unused) {
            return icon;
        }
    }
}
