package dev.latent.idea.templates;

import com.intellij.ide.fileTemplates.FileTemplateDescriptor;
import com.intellij.ide.fileTemplates.FileTemplateGroupDescriptor;
import com.intellij.ide.fileTemplates.FileTemplateGroupDescriptorFactory;
import dev.latent.idea.LatentIcons;

/** Группа «Latent» в диалоге New → File: шаблон main-файла. */
public final class LatentFileTemplateGroupFactory implements FileTemplateGroupDescriptorFactory {

    public static final String MAIN_TEMPLATE = "Latent Main.lat";

    @Override
    public FileTemplateGroupDescriptor getFileTemplatesDescriptor() {
        FileTemplateGroupDescriptor group =
                new FileTemplateGroupDescriptor("Latent", LatentIcons.FILE);
        group.addTemplate(new FileTemplateDescriptor(MAIN_TEMPLATE, LatentIcons.FILE));
        return group;
    }
}
