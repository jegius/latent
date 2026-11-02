package dev.latent.idea;

import com.intellij.openapi.util.IconLoader;

import javax.swing.Icon;

/** Иконки плагина. */
public final class LatentIcons {

    public static final Icon FILE = IconLoader.getIcon("/icons/latentFile.svg", LatentIcons.class);
    public static final Icon PLUGIN = IconLoader.getIcon("/icons/latent.svg", LatentIcons.class);

    private LatentIcons() {
    }
}
