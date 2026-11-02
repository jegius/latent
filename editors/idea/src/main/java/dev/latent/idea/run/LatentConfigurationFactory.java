package dev.latent.idea.run;

import com.intellij.execution.configurations.ConfigurationFactory;
import com.intellij.execution.configurations.ConfigurationType;
import com.intellij.execution.configurations.RunConfiguration;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

/** Фабрика конфигураций запуска Latent. */
public final class LatentConfigurationFactory extends ConfigurationFactory {

    LatentConfigurationFactory(@NotNull ConfigurationType type) {
        super(type);
    }

    @Override
    public @NotNull RunConfiguration createTemplateConfiguration(@NotNull Project project) {
        return new LatentRunConfiguration(project, this, "Latent");
    }

    @Override
    public @NotNull String getName() {
        return "Latent";
    }

    @Override
    public @NotNull String getId() {
        return "Latent";
    }
}
