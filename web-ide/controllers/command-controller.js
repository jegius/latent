// controllers/command-controller.js — команды компиляции, движка №2, шаринга и примеров.
// Единственная ответственность: обработчики Run/Check/WASM/Share/Example.
// Методы применяются к прототипу LatentIDEController (миксин).

import { loadExampleById } from '../examples.js';
import { Modal } from '../views/modal-view.js';
import { formatLatent } from '../services/formatter-service.js';

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

            const { result, logs, bytecode, analysis, repaired, attempts, finalSource, repairLog } =
                withAI
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
            this.outputView.setStatus(withAI ? '✓ Done (AI)' : '✓ Done', 'success');
        } catch (e) {
            this.outputView.setStatus('✗ Error', 'error');
            this.outputView.clearConsole();
            this.outputView.appendConsole(`Error: ${e.message}\n`);
            this.outputView.setWasmOutput(`Compilation failed:\n${e.message}`);
        }
    },

    /**
     * Компилирует код нативным движком №2 (Rust→WASM) и показывает байткод.
     */
    async handleBuildWasm() {
        this.outputView.setStatus('Loading engine #2...', 'info');
        const ok = await this.compilerService.ensureWasmCompiler();
        this.refreshEngineStatus();
        if (!ok) {
            this.outputView.setStatus('Engine #2 unavailable — check compiler.wasm', 'error');
            return;
        }
        const source = this.editor.getCode();
        try {
            const bytecode = this.compilerService.wasmCompiler.compile(source);
            this.outputView.switchTab('wasm');
            this.outputView.setWasmOutput(
                `Compiled by engine #2 (Rust → WASM)\n` +
                this.compilerService.formatBytecode(bytecode));
            this.outputView.setStatus('✓ Compiled with engine #2', 'success');
        } catch (e) {
            this.outputView.switchTab('wasm');
            this.outputView.setWasmOutput(`Engine #2 error:\n${e.message}`);
            this.outputView.setStatus('✗ Engine #2 error', 'error');
        }
    },

    refreshEngineStatus() {
        const el = document.getElementById('status-engine');
        if (!el) return;
        el.textContent = this.compilerService.hasWasmCompiler()
            ? 'engine #2 (rust→wasm)'
            : 'engine #1 (interpreter)';
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
     * Загружает выбранный пример как новый файл.
     * @param {string} id
     */
    async handleLoadExample(id) {
        let example = this.examples && this.examples.find(e => e.id === id);
        if (!example) example = await loadExampleById(id);
        if (!example) {
            this.outputView.setStatus(`✗ Example '${id}' not found`, 'error');
            return;
        }
        const file = this.workspace.createFile(example.file || `${id}.lat`, example.code);
        this.editor.setCode(file.code);
        this.refreshFileTree();
        const hint = example.needsAI
            ? ' — ⌘/Ctrl+Enter → Run with AI'
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
     */
    handleFormat() {
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
            message: 'Latent IDE · web · engine #1 (JS-interpreter) · v0.1.0\n'
                + 'Движок №2: Rust-компилятор → WebAssembly.\n'
                + 'Ctrl/⌘+Enter — Run, Ctrl/⌘+Shift+Enter — Run with AI, Ctrl/⌘+S — Save.',
        });
    },
};