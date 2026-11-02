package dev.latent.idea.run;

import com.intellij.execution.ExecutionException;
import com.intellij.execution.Executor;
import com.intellij.execution.DefaultExecutionResult;
import com.intellij.execution.ExecutionResult;
import com.intellij.execution.configurations.GeneralCommandLine;
import com.intellij.execution.configurations.RunProfileState;
import com.intellij.execution.filters.TextConsoleBuilderFactory;
import com.intellij.execution.process.OSProcessHandler;
import com.intellij.execution.runners.ExecutionEnvironment;
import com.intellij.execution.runners.ProgramRunner;
import com.intellij.execution.ui.ConsoleView;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

import java.nio.file.Path;

/** Состояние запуска: компиляция, затем запуск wasm через Node. */
public final class LatentRunProfileState implements RunProfileState {

    private final Project project;
    private final String filePath;

    public LatentRunProfileState(@NotNull Project project, @NotNull String filePath) {
        this.project = project;
        this.filePath = filePath;
    }

    @Override
    public ExecutionResult execute(@NotNull Executor executor,
                                   @NotNull ProgramRunner<?> runner) throws ExecutionException {
        LatentCompiler.Result result = LatentCompiler.compile(project, filePath);
        if (!result.isOk()) {
            throw new ExecutionException(result.getMessage());
        }
        Path wasm = result.getWasmPath();
        if (wasm == null) {
            throw new ExecutionException("Компилятор не вернул путь к wasm-файлу");
        }
        GeneralCommandLine commandLine = LatentCompiler.createRunCommandLine(project, wasm);
        OSProcessHandler handler = new OSProcessHandler(commandLine);
        ConsoleView console = TextConsoleBuilderFactory.getInstance()
                .createBuilder(project).getConsole();
        console.attachToProcess(handler);
        handler.startNotify();
        return new DefaultExecutionResult(console, handler);
    }
}
