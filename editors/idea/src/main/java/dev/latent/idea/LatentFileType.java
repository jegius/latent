package dev.latent.idea;

import com.intellij.openapi.fileTypes.LanguageFileType;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;

/** Файловый тип {@code *.lat}. */
public final class LatentFileType extends LanguageFileType {

    public static final LatentFileType INSTANCE = new LatentFileType();

    public LatentFileType() {
        super(LatentLanguage.INSTANCE);
    }

    @Override
    public @NotNull String getName() {
        return "Latent";
    }

    @Override
    public @NotNull String getDescription() {
        return "Latent source file";
    }

    @Override
    public @NotNull String getDefaultExtension() {
        return "lat";
    }

    @Override
    public @Nullable Icon getIcon() {
        return LatentIcons.FILE;
    }
}
