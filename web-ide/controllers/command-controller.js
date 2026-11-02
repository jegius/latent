// controllers/command-controller.js — команды компиляции, шаринга и примеров.
// Единственная ответственность: обработчики Run/Check/Share/Example.
// Команды движка №2 (Engine #2/WASM) — в wasm-controller.js.
// Методы применяются к прототипу LatentIDEController (миксин).

import { loadExampleById } from '../examples.js';
import { Modal } from '../views/modal-view.js';
import { ENGINE1_LABEL } from '../compiler/host-features.js';
import { projectUsesModules } from '../services/compiler-service-project.js';

export const commandControllerMethods = {
    /**
     * Компилирует и запускает код (активный файл = entry проекта).
     * @param {boolean} withAI
     */
    async handleCompile(withAI) {
        const source = this.editor.getCode();
        const project = this.buildProject();
        let useProject = false;

        try {
            useProject = projectUsesModules(project.files, project.entry);
            this.outputView.setStatus(withAI ? 'Compiling with AI...' : 'Compiling...');
            this.outputView.clearConsole();

            const {
                result, logs, bytecode, analysis, repaired, attempts, finalSource,
                repairLog, notes, engineLabel, modules, modulePaths,
            } = withAI
                ? (useProject
                    ? await this.compilerService.compileAndRunWithRepairProject(
                        project.files, project.entry, true)
                    : await this.compilerService.compileAndRunWithRepair(source, true))
                : (useProject
                    ? await this.compilerService.compileAndRunProject(
                        project.files, project.entry, false)
                    : await this.compilerService.compileAndRun(source, false));

            this.outputView.setStatus(withAI ? 'Running with AI...' : 'Running...');

            // Self-repair: если код был исправлен моделью — обновляем редактор
            if (repaired && finalSource && finalSource !== source && !useProject) {
                this.editor.setCode(finalSource);
                this.workspace.updateCode(this.workspace.activeId, finalSource);
                this.outputView.appendConsole(
                    `[Self-repair] Fixed after ${attempts} attempt(s):\n${repairLog.join('\n')}\n\n`);
            } else if (repaired && finalSource && useProject) {
                this.editor.setCode(finalSource);
                this.workspace.updateCode(this.workspace.activeId, finalSource);
                this.outputView.appendConsole(
                    `[Self-repair] Fixed entry file after ${attempts} attempt(s):\n` +
                    `${repairLog.join('\n')}\n\n`);
            }

            // Пояснения о выборе движка/фолбэке — до вывода программы.
            for (const note of notes || []) {
                this.outputView.appendConsole(`[engine] ${note}\n`);
            }
            if (useProject && modules) {
                this.outputView.appendConsole(
                    `[modules] ${modules} file(s): ${(modulePaths || []).join(', ')}\n`);
            }
            for (const line of logs) {
                this.outputView.appendConsole(line + '\n');
            }
            const label = withAI ? 'AI Result' : 'Result';
            this.outputView.appendConsole(`\n${label}: ${this.compilerService.formatResult(result)}\n`);

            if (withAI) {
                this.outputView.appendConsole(`\n--- AI Code Insights ---\n`);
                this.outputView.appendConsole(`Functions: ${analysis.functions} (${analysis.functionNames.join(', ')})\n`);
                this.outputView.appendConsole(`Loops: ${analysis.loops}, Conditionals: ${analysis.conditionals}\n`);
                this.outputView.appendConsole(`Estimated complexity: ${analysis.complexity}\n`);
                this.outputView.appendConsole(`Lines: ${analysis.lines}, Tokens: ${analysis.tokens}\n`);
            }

            this.outputView.setWasmOutput(this.compilerService.formatBytecode(bytecode));
            this.outputView.setAstOutput(JSON.stringify(analysis, null, 2));
            this.refreshEngineStatus(engineLabel || ENGINE1_LABEL);
            this.outputView.setStatus(
                (withAI ? '✓ Done (AI)' : '✓ Done') + ` · ${ENGINE1_LABEL}`, 'success');
        } catch (e) {
            this.refreshEngineStatus(ENGINE1_LABEL);
            this.outputView.setStatus('✗ Error', 'error');
            this.outputView.clearConsole();
            this.outputView.appendConsole(`Error: ${e.message}\n`);
            this.outputView.setWasmOutput(`Compilation failed:\n${e.message}`);
        }
    },

    /** Проверяет синтаксис активного файла и линковку проекта. */
    async handleCheckSyntax() {
        const project = this.buildProject();
        try {
            const useProject = projectUsesModules(project.files, project.entry);
            if (useProject) {
                await this.compilerService.checkSyntaxProject(project.files, project.entry);
            } else {
                await this.compilerService.checkSyntax(this.editor.getCode());
            }
            this.outputView.setStatus('✓ Syntax OK', 'success');
        } catch (e) {
            this.outputView.setStatus(`✗ ${e.message}`, 'error');
            this.outputView.appendConsole(`Check failed: ${e.message}\n`);
        }
    },

    async handleShare() {
        const url = this.shareService.buildShareUrl(this.editor.getCode());
        if (typeof history !== 'undefined') {
            history.replaceState(null, '', url);
        }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
                this.outputView.setStatus('✓ Share link copied to clipboard', 'success');
            } else {
                this.outputView.setStatus('✓ Share link is in the address bar', 'success');
            }
        } catch (e) {
            this.outputView.setStatus('✓ Share link is in the address bar', 'success');
        }
    },

    /**
     * Загружает выбранный пример как новый файл. Метаданные уже в памяти;
     * исходник .lat подтягивается только для выбранного примера (лениво).
     * @param {string} id
     */
    async handleLoadExample(id) {
        let example = this.examples && this.examples.find(e => e.id === id);
        if (!example || !example.code) {
            const loaded = await loadExampleById(id);
            if (!loaded) {
                this.outputView.setStatus(`✗ Example '${id}' not found`, 'error');
                return;
            }
            example = loaded;
            // Запоминаем код в каталоге, чтобы повторный клик не грузил файл снова.
            const idx = this.examples ? this.examples.findIndex(e => e.id === id) : -1;
            if (idx >= 0) this.examples[idx] = { ...this.examples[idx], code: example.code };
        }
        const file = this.workspace.createFile(example.file || `${id}.lat`, example.code);
        this.editor.setCode(file.code);
        this.refreshFileTree();
        const hint = example.needsAI
            ? ' — click Run (mock AI) or ⌘/Ctrl+Enter with Run with AI'
            : ' — click Run';
        this.outputView.setStatus(`Loaded: ${example.title}${hint}`, 'info');
    },

    /** Сохраняет активный файл (Ctrl/Cmd+S). */
    handleSave() {
        const active = this.workspace.getActive();
        if (active) this.workspace.updateCode(active.id, this.editor.getCode());
        this.outputView.setStatus('✓ Saved', 'success');
    },

    /**
     * Автоформатирование: выравнивает отступы и пробелы во всём файле.
     * Курсор сохраняется по возможности (по позиции в конце форматирования).
     * Форматтер подключается dynamic import()'ом при первом форматировании.
     */
    async handleFormat() {
        const { formatLatent } = await import('../services/formatter-service.js');
        const source = this.editor.getCode();
        const formatted = formatLatent(source);
        if (formatted === source) {
            this.outputView.setStatus('✓ Код уже отформатирован', 'info');
            return;
        }
        this.editor.setCode(formatted);
        const id = this.workspace.activeId;
        this.workspace.updateCode(id, formatted);
        this.outputView.setStatus('✓ Код отформатирован', 'success');
    },

    /** Показывает сведения о сборке в модальном окне (Help → About). */
    handleAbout() {
        Modal.alert({
            title: 'Latent IDE',
            message: 'Latent IDE · web · engine #1 (host runtime) · v0.1.0\n'
                + 'Движок №1 исполняет полный язык: каналы, select/spawn, AI, тензоры, контракты.\n'
                + 'Движок №2: Rust-компилятор → WebAssembly (подмножество без host-фич).\n'
                + 'Модули: активный файл = entry; import/export, enum и многофайловые проекты.\n'
                + 'Host-программы автоматически исполняются в engine #1.\n'
                + 'Ctrl/⌘+Enter — Run, Ctrl/⌘+Shift+Enter — Run with AI, Ctrl/⌘+S — Save.',
        });
    },
};