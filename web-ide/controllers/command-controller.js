// controllers/command-controller.js — команды компиляции, движка №2, шаринга и примеров.
// Единственная ответственность: обработчики Run/Check/WASM/Share/Example.
// Методы применяются к прототипу LatentIDEController (миксин).

import { loadExampleById } from '../examples.js';
import { Modal } from '../views/modal-view.js';
import {
    detectHostFeatures, isHostRuntimeError, explainEngine2HostLimit,
    ENGINE1_LABEL, ENGINE2_LABEL,
} from '../compiler/host-features.js';

export const commandControllerMethods = {
    /**
     * Компилирует и запускает код, обновляет все вкладки вывода.
     * @param {boolean} withAI
     */
    async handleCompile(withAI) {
        const source = this.editor.getCode();

        try {
            this.outputView.setStatus(withAI ? 'Compiling with AI...' : 'Compiling...');
            this.outputView.clearConsole();

            const {
                result, logs, bytecode, analysis, repaired, attempts, finalSource,
                repairLog, notes, engineLabel,
            } = withAI
                ? await this.compilerService.compileAndRunWithRepair(source, true)
                : await this.compilerService.compileAndRun(source, false);

            this.outputView.setStatus(withAI ? 'Running with AI...' : 'Running...');

            // Self-repair: если код был исправлен моделью — обновляем редактор
            if (repaired && finalSource && finalSource !== source) {
                this.editor.setCode(finalSource);
                this.workspace.updateCode(this.workspace.activeId, finalSource);
                this.outputView.appendConsole(
                    `[Self-repair] Fixed after ${attempts} attempt(s):\n${repairLog.join('\n')}\n\n`);
            }

            // Пояснения о выборе движка/фолбэке — до вывода программы.
            for (const note of notes || []) {
                this.outputView.appendConsole(`[engine] ${note}\n`);
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

    /**
     * Компилирует код нативным движком №2 (Rust→WASM) и показывает байткод.
     * Это явный выбор engine #2: если программа host-зависима, показываем
     * понятное пояснение и предлагаем запустить её в engine #1 (кнопкой).
     */
    async handleBuildWasm() {
        this.outputView.setStatus('Loading engine #2...', 'info');
        const ok = await this.compilerService.ensureWasmCompiler();
        this.refreshEngineStatus(ENGINE1_LABEL);
        if (!ok) {
            this.outputView.setStatus('Engine #2 unavailable — check compiler.wasm', 'error');
            return;
        }
        const source = this.editor.getCode();
        const host = detectHostFeatures(source);
        if (host.host) {
            await this.offerRunInEngine1(host.features, null);
            return;
        }
        try {
            const bytecode = this.compilerService.compileWithEngine2(source);
            this.outputView.switchTab('wasm');
            this.outputView.setWasmOutput(
                `Compiled by engine #2 (Rust → WASM)\n` +
                this.compilerService.formatBytecode(bytecode));
            this.refreshEngineStatus(ENGINE2_LABEL);
            this.outputView.setStatus('✓ Compiled with engine #2', 'success');
        } catch (e) {
            if (isHostRuntimeError(e)) {
                await this.offerRunInEngine1(detectHostFeatures(source).features, e);
                return;
            }
            this.outputView.switchTab('wasm');
            this.outputView.setWasmOutput(`Engine #2 error:\n${e.message}`);
            this.refreshEngineStatus(ENGINE2_LABEL);
            this.outputView.setStatus('✗ Engine #2 error', 'error');
        }
    },

    /**
     * Объясняет ограничение engine #2 и предлагает запуск в engine #1.
     * @param {string[]} features — host-фичи, найденные в программе
     * @param {Error|null} error — диагностика engine #2 (если была)
     */
    async offerRunInEngine1(features, error) {
        const explanation = explainEngine2HostLimit(features);
        this.outputView.switchTab('wasm');
        this.outputView.setWasmOutput(
            explanation + (error ? `\n\nEngine #2: ${error.message}` : ''));
        this.refreshEngineStatus(ENGINE1_LABEL);
        this.outputView.setStatus(`${ENGINE1_LABEL} — host-фичи`, 'info');
        const runInEngine1 = await Modal.confirm({
            title: 'Engine #2 не поддерживает host-фичи',
            message: `${explanation}\n\nЗапустить программу в engine #1 (host runtime)?`,
            confirmText: 'Run in engine #1',
            cancelText: 'Остаться в Engine #2',
        });
        if (runInEngine1) await this.handleCompile(false);
    },

    /** Обновляет индикатор движка исполнения в статус-баре. */
    refreshEngineStatus(engineLabel = ENGINE1_LABEL) {
        const el = document.getElementById('status-engine');
        if (!el) return;
        el.textContent = engineLabel;
    },

    async handleCheckSyntax() {
        const source = this.editor.getCode();
        try {
            await this.compilerService.checkSyntax(source);
            this.outputView.setStatus('✓ Syntax OK', 'success');
        } catch (e) {
            this.outputView.setStatus(`✗ ${e.message}`, 'error');
        }
    },

    async handleWasmTab() {
        if (this.compilerService.hasWasmCompiler() || this.wasmTabChecked) return;
        this.wasmTabChecked = true;
        this.outputView.setStatus('Loading WASM compiler (engine #2)...', 'info');
        const ok = await this.compilerService.ensureWasmCompiler();
        this.refreshEngineStatus();
        if (ok) {
            this.outputView.setStatus('✓ WASM compiler loaded (engine #2)', 'success');
        } else {
            this.outputView.setStatus(
                'WASM compiler unavailable — showing engine #1 bytecode', 'info');
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
                + 'Host-программы автоматически исполняются в engine #1.\n'
                + 'Ctrl/⌘+Enter — Run, Ctrl/⌘+Shift+Enter — Run with AI, Ctrl/⌘+S — Save.',
        });
    },
};