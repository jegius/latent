package dev.latent.idea.run;

import com.intellij.execution.configurations.ConfigurationTypeBase;
import com.intellij.execution.configurations.ConfigurationTypeUtil;
import dev.latent.idea.LatentIcons;
import org.jetbrains.annotations.NotNull;

/** Тип конфигурации запуска «Latent». */
public final class LatentRunConfigurationType extends ConfigurationTypeBase {

    public static final String ID = "Latent";

    public LatentRunConfigurationType() {
        super(ID, "Latent", "Компиляция и запуск программы Latent (WASM)", LatentIcons.FILE);
        addFactory(new LatentConfigurationFactory(this));
    }

    public static @NotNull LatentRunConfigurationType getInstance() {
        return ConfigurationTypeUtil.findConfigurationType(LatentRunConfigurationType.class);
    }
}
