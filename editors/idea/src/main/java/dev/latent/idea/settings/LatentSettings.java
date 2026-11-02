package dev.latent.idea.settings;

import com.intellij.openapi.application.Application;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/**
 * Настройки плагина Latent (Settings → Tools → Latent).
 *
 * <p>Хранятся в {@code latent.xml} на уровне приложения: пути к {@code latentc} и {@code node}
 * одинаковы для всех проектов.</p>
 */
@State(name = "LatentSettings", storages = @Storage("latent.xml"))
public final class LatentSettings implements PersistentStateComponent<LatentSettings.State> {

    /** Сериализуемое состояние. */
    public static final class State {
        /** Путь к latentc либо имя команды в PATH. */
        public String latentcPath = "latentc";
        /** Путь к node либо имя команды в PATH. */
        public String nodePath = "node";
        /** Необязательный путь к web-ide/compiler.wasm для fallback-компиляции. */
        public String compilerWasmPath = "";
        /** Дополнительные аргументы node (например, "--experimental-wasm-..."). */
        public String nodeArgs = "";
        /** Разрешать fallback-компиляцию через compiler.wasm. */
        public boolean useWebCompilerFallback = true;
    }

    private State state = new State();

    public static LatentSettings getInstance() {
        return ApplicationManager.getApplication().getService(LatentSettings.class);
    }

    @Override
    public @NotNull State getState() {
        return state;
    }

    @Override
    public void loadState(@NotNull State state) {
        this.state = state;
    }

    @Nullable
    public static LatentSettings getInstanceIfLoaded() {
        Application application = ApplicationManager.getApplication();
        if (application == null) {
            return null;
        }
        return application.getServiceIfCreated(LatentSettings.class);
    }
}
