// controllers/wasm-controller.js — команды движка №2 (Rust→WASM) в IDE.
// Единственная ответственность: Engine #2/WASM-вкладка, компиляция проекта
// через манифест "LPF1", объяснение ограничений и фолбэк в engine #1.
// Методы применяются к прототипу LatentIDEController (миксин).

import { Modal } from '../views/modal-view.js';
import {
    detectHostFeatures, isHostRuntimeError, explainEngine2HostLimit,
    ENGINE1_LABEL, ENGINE2_LABEL,
} from '../compiler/host-features.js';
import { projectUsesModules } from '../services/compiler-service-project.js';

export const wasmControllerMethods = {
    /**
     * Компилирует активный файл или весь проект нативным движком №2.
     * Пока C-ABI latent_compile_files не появился, проект честно сообщает
     * «engine #2 пока без модулей» и предлагает запуск в engine #1.
     */
    async handleBuildWasm() {
        this.outputView.setStatus('Loading engine #2...', 'info');
        const ok = await this.compilerService.ensureWasmCompiler();
        this.refreshEngineStatus(ENGINE1_LABEL);
        if (!ok) {
            this.outputView.setStatus('Engine #2 unavailable — check compiler.wasm', 'error');
            return;
        }

        const project = this.buildProject();
        const useProject = projectUsesModules(project.files, project.entry);
        if (useProject) {
            if (!this.compilerService.hasEngine2Modules()) {
                await this.offerEngine2ModulesPending(project);
                return;
            }
            const host = this.compilerService.detectProjectHostFeatures(project.files);
            if (host.host) {
                await this.offerRunInEngine1(host.features, null);
                return;
            }
            try {
                const bytecode = this.compilerService.compileWithEngine2Project(
                    project.files, project.entry);
                this.outputView.switchTab('wasm');
                this.outputView.setWasmOutput(
                    `Compiled by engine #2 (Rust → WASM, manifest LPF1)\n` +
                    `Project: ${project.files.length} file(s), entry ${project.entry}\n` +
                    this.compilerService.formatBytecode(bytecode));
                this.refreshEngineStatus(ENGINE2_LABEL);
                this.outputView.setStatus('✓ Compiled with engine #2', 'success');
            } catch (e) {
                if (isHostRuntimeError(e)) {
                    await this.offerRunInEngine1(
                        this.compilerService.detectProjectHostFeatures(project.files).features, e);
                    return;
                }
                this.outputView.switchTab('wasm');
                this.outputView.setWasmOutput(`Engine #2 error:\n${e.message}`);
                this.refreshEngineStatus(ENGINE2_LABEL);
                this.outputView.setStatus('✗ Engine #2 error', 'error');
            }
            return;
        }

        // Однофайловая программа — прежний путь через latent_compile.
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
                await this.offerRunInEngine1(host.features, e);
                return;
            }
            this.outputView.switchTab('wasm');
            this.outputView.setWasmOutput(`Engine #2 error:\n${e.message}`);
            this.refreshEngineStatus(ENGINE2_LABEL);
            this.outputView.setStatus('✗ Engine #2 error', 'error');
        }
    },

    /**
     * Мягкое поведение до появления модульного C-ABI: объясняем статус и
     * предлагаем выполнить проект в engine #1.
     * @param {{files:Array, entry:string}} project
     */
    async offerEngine2ModulesPending(project) {
        const message = [
            'Engine #2 пока без модулей: C-ABI latent_compile_files ещё не экспортируется',
            'собранным compiler.wasm (однофайловый latent_compile не поддерживает import).',
            `Проект (${project.files.length} файл(ов), entry ${project.entry}) полностью`,
            'исполняется в engine #1 — линковщик JS поддерживает import/export уже сейчас.',
        ].join(' ');
        this.outputView.switchTab('wasm');
        this.outputView.setWasmOutput(message);
        this.refreshEngineStatus(ENGINE1_LABEL);
        this.outputView.setStatus(`${ENGINE1_LABEL} — модули`, 'info');
        const runInEngine1 = await Modal.confirm({
            title: 'Engine #2 пока без модулей',
            message: `${message}\n\nЗапустить проект в engine #1 (host runtime)?`,
            confirmText: 'Run in engine #1',
            cancelText: 'Остаться в Engine #2',
        });
        if (runInEngine1) await this.handleCompile(false);
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
};
