package dev.latent.idea;

import com.intellij.lang.Language;

/** Язык Latent (единственный экземпляр). */
public final class LatentLanguage extends Language {

    public static final String ID = "Latent";
    public static final LatentLanguage INSTANCE = new LatentLanguage();

    private LatentLanguage() {
        super(ID, "text/latent", "application/x-latent");
    }
}
