package dev.latent.idea.run;

import com.intellij.execution.ExecutionException;
import com.intellij.execution.configurations.GeneralCommandLine;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.io.FileUtil;
import com.intellij.openapi.util.text.StringUtil;
import dev.latent.idea.settings.LatentSettings;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.InputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Компиляция и запуск Latent.
 *
 * <p>Основной путь — внешний {@code latentc compile <file> <out.wasm>}. Если latentc не найден,
 * используется fallback: {@code web-ide/compiler.wasm} (C-ABI {@code latent_alloc/latent_compile})
 * через Node.js и тот же runner-скрипт, что и для запуска.</p>
 */
public final class LatentCompiler {

    private static final int TIMEOUT_SECONDS = 180;

    /** Результат компиляции. */
    public static final class Result {
        private final boolean ok;
        private final String message;
        private final Path wasmPath;

        private Result(boolean ok, String message, Path wasmPath) {
            this.ok = ok;
            this.message = message;
            this.wasmPath = wasmPath;
        }

        public boolean isOk() {
            return ok;
        }

        public @NotNull String getMessage() {
            return message;
        }

        public @Nullable Path getWasmPath() {
            return wasmPath;
        }
    }

    private LatentCompiler() {
    }

    public static @NotNull Result compile(@NotNull Project project, @Nullable String sourcePath) {
        if (StringUtil.isEmptyOrSpaces(sourcePath)) {
            return fail("Не выбран файл Latent. Укажите его в настройках конфигурации запуска.");
        }
        Path source = Paths.get(sourcePath);
        if (!Files.isRegularFile(source)) {
            return fail("Файл не найден: " + sourcePath);
        }
        String baseDir = project.getBasePath();
        StringBuilder log = new StringBuilder();
        Path output;
        try {
            output = outputPath(source);
        } catch (IOException e) {
            return fail("Не удалось создать временный файл: " + e.getMessage());
        }

        LatentSettings.State settings = currentSettings();
        String latentc = resolveExecutable(settings.latentcPath, baseDir);
        if (latentc != null) {
            ProcessResult result = runProcess(List.of(
                    latentc, "compile", source.toString(), output.toString()), baseDir);
            if (result.exitCode == 0 && Files.isRegularFile(output)) {
                return ok(output);
            }
            log.append("latentc: ").append(result.output).append('\n');
            if (result.exitCode == 0) {
                log.append("latentc завершился успешно, но не создал ").append(output).append('\n');
            }
        } else {
            log.append("latentc не найден: ").append(settings.latentcPath)
                    .append(" (задайте путь в Settings → Tools → Latent)\n");
        }

        if (!settings.useWebCompilerFallback) {
            return fail("Компиляция не удалась:\n" + log);
        }
        String node = resolveExecutable(settings.nodePath, baseDir);
        if (node == null) {
            return fail("Node.js не найден: " + settings.nodePath + "\n" + log);
        }
        Path compiler = findCompilerWasm(project, settings);
        if (compiler == null) {
            return fail("Не найден compiler.wasm (проверьте Settings → Tools → Latent "
                    + "или наличие web-ide/compiler.wasm в проекте)\n" + log);
        }
        Path runner = extractResource("latent-runner.mjs");
        if (runner == null) {
            return fail("Не удалось извлечь встроенный runner плагина\n" + log);
        }
        List<String> command = new ArrayList<>();
        command.add(node);
        command.addAll(splitArgs(settings.nodeArgs));
        command.add(runner.toString());
        command.add("compile");
        command.add(compiler.toString());
        command.add(source.toString());
        command.add(output.toString());
        ProcessResult result = runProcess(command, baseDir);
        log.append("compiler.wasm: ").append(result.output).append('\n');
        if (result.exitCode == 0 && Files.isRegularFile(output)) {
            return ok(output);
        }
        return fail("Компиляция не удалась:\n" + log);
    }

    /** Команда запуска готового wasm-файла через Node.js и встроенный runner. */
    public static @NotNull GeneralCommandLine createRunCommandLine(@NotNull Project project,
                                                                   @NotNull Path wasmPath)
            throws ExecutionException {
        LatentSettings.State settings = currentSettings();
        String node = resolveExecutable(settings.nodePath, project.getBasePath());
        if (node == null) {
            throw new ExecutionException("Node.js не найден: " + settings.nodePath
                    + ". Задайте путь в Settings → Tools → Latent.");
        }
        Path runner = extractResource("latent-runner.mjs");
        if (runner == null) {
            throw new ExecutionException("Не удалось извлечь встроенный runner плагина");
        }
        GeneralCommandLine commandLine = new GeneralCommandLine(node);
        commandLine.addParameters(splitArgs(settings.nodeArgs));
        commandLine.addParameter(runner.toString());
        commandLine.addParameter("run");
        commandLine.addParameter(wasmPath.toString());
        if (project.getBasePath() != null) {
            commandLine.setWorkDirectory(project.getBasePath());
        }
        return commandLine;
    }

    private static LatentSettings.State currentSettings() {
        LatentSettings settings = LatentSettings.getInstance();
        return settings == null ? new LatentSettings.State() : settings.getState();
    }

    private static Path outputPath(Path source) throws IOException {
        Path dir = Paths.get(FileUtil.getTempDirectory(), "latent-idea");
        Files.createDirectories(dir);
        String name = source.getFileName() == null ? "program" : source.getFileName().toString();
        name = name.replaceAll("[^A-Za-z0-9_.-]", "_");
        return dir.resolve(name + "-" + Integer.toHexString(source.toString().hashCode()) + ".wasm");
    }

    private static @Nullable Path findCompilerWasm(@NotNull Project project,
                                                   @NotNull LatentSettings.State settings) {
        if (!StringUtil.isEmptyOrSpaces(settings.compilerWasmPath)) {
            Path configured = Paths.get(settings.compilerWasmPath);
            if (Files.isRegularFile(configured)) {
                return configured.toAbsolutePath();
            }
        }
        if (project.getBasePath() != null) {
            Path projectWasm = Paths.get(project.getBasePath(), "web-ide", "compiler.wasm");
            if (Files.isRegularFile(projectWasm)) {
                return projectWasm.toAbsolutePath();
            }
        }
        return extractResource("compiler.wasm");
    }

    private static @Nullable Path extractResource(String name) {
        try {
            Path dir = Paths.get(FileUtil.getTempDirectory(), "latent-idea");
            Files.createDirectories(dir);
            Path target = dir.resolve(name);
            try (InputStream stream = LatentCompiler.class.getResourceAsStream("/runner/" + name)) {
                if (stream == null) {
                    return null;
                }
                Files.copy(stream, target, StandardCopyOption.REPLACE_EXISTING);
            }
            return target;
        } catch (IOException e) {
            return null;
        }
    }

    /** Ищет исполняемый файл: абсолютный/относительный путь либо имя в PATH. */
    public static @Nullable String resolveExecutable(@Nullable String configured,
                                                     @Nullable String baseDir) {
        if (StringUtil.isEmptyOrSpaces(configured)) {
            return null;
        }
        String value = configured.trim();
        boolean hasSeparator = value.contains("/") || value.contains("\\");
        if (hasSeparator) {
            Path path = Paths.get(value);
            if (!path.isAbsolute() && baseDir != null) {
                path = Paths.get(baseDir).resolve(value);
            }
            return Files.isRegularFile(path) ? path.toAbsolutePath().toString() : null;
        }
        String pathEnv = System.getenv("PATH");
        if (pathEnv == null) {
            return null;
        }
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        String[] extensions = windows
                ? new String[]{"", ".exe", ".cmd", ".bat"} : new String[]{""};
        for (String directory : pathEnv.split(File.pathSeparator)) {
            if (directory.isEmpty()) {
                continue;
            }
            for (String extension : extensions) {
                Path candidate = Paths.get(directory, value + extension);
                if (Files.isRegularFile(candidate)) {
                    return candidate.toAbsolutePath().toString();
                }
            }
        }
        return null;
    }

    private static List<String> splitArgs(@Nullable String args) {
        List<String> result = new ArrayList<>();
        if (StringUtil.isEmptyOrSpaces(args)) {
            return result;
        }
        for (String part : args.trim().split("\\s+")) {
            if (!part.isEmpty()) {
                result.add(part);
            }
        }
        return result;
    }

    private static ProcessResult runProcess(List<String> command, @Nullable String workDir) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            if (workDir != null) {
                builder.directory(new File(workDir));
            }
            Process process = builder.start();
            byte[] outputBytes = process.getInputStream().readAllBytes();
            boolean finished = process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            String output = new String(outputBytes, StandardCharsets.UTF_8).trim();
            if (!finished) {
                process.destroyForcibly();
                return new ProcessResult(-1, output + "\nПревышено время ожидания "
                        + TIMEOUT_SECONDS + " с");
            }
            return new ProcessResult(process.exitValue(), output);
        } catch (IOException e) {
            return new ProcessResult(-1, "Не удалось запустить процесс: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new ProcessResult(-1, "Процесс прерван");
        }
    }

    private static Result ok(Path path) {
        return new Result(true, "ok", path);
    }

    private static Result fail(String message) {
        return new Result(false, message, null);
    }

    private static final class ProcessResult {
        private final int exitCode;
        private final String output;

        private ProcessResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }
}
