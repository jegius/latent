package dev.latent.idea.run;

import com.intellij.execution.configurations.LocatableRunConfigurationOptions;
import com.intellij.openapi.components.StoredPropertyBase;

/** Сериализуемые параметры запуска Latent. */
public final class LatentRunConfigurationOptions extends LocatableRunConfigurationOptions {

    private final StoredPropertyBase<String> filePath = string("");

    public String getFilePath() {
        return filePath.getValue(this);
    }

    public void setFilePath(String value) {
        filePath.setValue(this, value == null ? "" : value);
    }
}
