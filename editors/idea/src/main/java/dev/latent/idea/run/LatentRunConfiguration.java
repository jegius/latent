package dev.latent.idea.run;

import com.intellij.execution.ExecutionException;
import com.intellij.execution.Executor;
import com.intellij.execution.configurations.ConfigurationFactory;
import com.intellij.execution.configurations.LocatableConfigurationBase;
import com.intellij.execution.configurations.RunConfigurationOptions;
import com.intellij.execution.configurations.RunProfileState;
import com.intellij.execution.configurations.RuntimeConfigurationError;
import com.intellij.execution.configurations.RuntimeConfigurationException;
import com.intellij.execution.runners.ExecutionEnvironment;
import com.intellij.openapi.options.SettingsEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.text.StringUtil;
import dev.latent.idea.LatentIcons;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/** Конфигурация запуска «Latent»: компилирует выбранный .lat и запускает wasm через Node. */
public final class LatentRunConfiguration
        extends LocatableConfigurationBase<LatentRunConfigurationOptions> {

    protected LatentRunConfiguration(@NotNull Project project,
                                     @NotNull ConfigurationFactory factory,
                                     @NotNull String name) {
        super(project, factory, name);
    }

    @Override
    protected @NotNull LatentRunConfigurationOptions getOptions() {
        return (LatentRunConfigurationOptions) super.getOptions();
    }

    @Override
    protected @NotNull Class<? extends RunConfigurationOptions> getOptionsClass() {
        return LatentRunConfigurationOptions.class;
    }

    public @NotNull String getFilePath() {
        String path = getOptions().getFilePath();
        return path == null ? "" : path;
    }

    public void setFilePath(@Nullable String path) {
        getOptions().setFilePath(path);
    }

    @Override
    public @Nullable RunProfileState getState(@NotNull Executor executor,
                                              @NotNull ExecutionEnvironment environment)
            throws ExecutionException {
        return new LatentRunProfileState(getProject(), getFilePath());
    }

    @Override
    public @Nullable String suggestedName() {
        String path = getFilePath();
        if (StringUtil.isEmptyOrSpaces(path)) {
            return "Latent";
        }
        Path fileName = Paths.get(path).getFileName();
        return fileName == null ? "Latent" : "Latent " + fileName;
    }

    @Override
    public void checkConfiguration() throws RuntimeConfigurationException {
        if (StringUtil.isEmptyOrSpaces(getFilePath())) {
            throw new RuntimeConfigurationError("Не выбран файл Latent");
        }
        Path path = Paths.get(getFilePath());
        if (!Files.isRegularFile(path)) {
            throw new RuntimeConfigurationError("Файл не найден: " + getFilePath());
        }
        if (!getFilePath().endsWith(".lat")) {
            throw new RuntimeConfigurationError("Ожидается файл с расширением .lat");
        }
    }

    @Override
    public @NotNull SettingsEditor<? extends com.intellij.execution.configurations.RunConfiguration>
    getConfigurationEditor() {
        return new LatentRunConfigurationEditor(getProject());
    }

    @Override
    public @Nullable Icon getIcon() {
        return LatentIcons.FILE;
    }
}
