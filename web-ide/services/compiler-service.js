// services/compiler-service.js — сервис компиляции и выполнения Latent-кода.
// Содержит только бизнес-логику: компиляция, запуск, анализ, форматирование.
// Не знает ничего о DOM и отображении.

import { compile, checkSyntax, runLatent, analyzeCode, repairCode, loadWasmCompiler } from '../compiler-loader.js';

/**
 * Результат компиляции и выполнения программы.
 * @typedef {Object} RunResult
 * @property {any} result — значение, возвращённое main()
 * @property {string[]} logs — строки вывода print()
 * @property {Uint8Array} bytecode — скомпилированный байткод
 * @property {object} analysis — статистика анализа кода
 */

export class CompilerService {
    constructor() {
        /** @type {?{compile: (s: string) => Uint8Array}} движок №2, если загружен */
        this.wasmCompiler = null;
        this.wasmCompilerTried = false;
    }
    /**
     * Компилирует исходный код и возвращает байткод.
     * По умолчанию использует движок №1 (JS-интерпретатор). Если передан
     * wasmCompiler (движок №2), делегирует настоящему Rust-компилятору.
     * @param {string} source
     * @returns {Promise<Uint8Array>}
     */
    async compile(source) {
        if (this.wasmCompiler) {
            return this.wasmCompiler.compile(source);
        }
        return compile(source);
    }

    /**
     * Лениво подгружает движок №2 (Rust-компилятор в WASM) и кэширует его.
     * Возвращает true, если компилятор доступен.
     * @param {Object} [opts] — пробрсывается в loadWasmCompiler
     * @returns {Promise<boolean>}
     */
    async ensureWasmCompiler(opts) {
        if (this.wasmCompiler) return true;
        if (this.wasmCompilerTried) return false;
        this.wasmCompilerTried = true;
        const compiler = await loadWasmCompiler(opts);
        if (compiler) {
            this.wasmCompiler = compiler;
            return true;
        }
        return false;
    }

    /** true, если движок №2 загружен. */
    hasWasmCompiler() {
        return !!this.wasmCompiler;
    }

    /**
     * Проверяет синтаксис исходного кода.
     * @param {string} source
     * @returns {Promise<boolean>}
     */
    async checkSyntax(source) {
        return checkSyntax(source);
    }

    /**
     * Компилирует и выполняет программу.
     * @param {string} source — исходный код
     * @param {boolean} withAI — включить AI-функции
     * @returns {Promise<RunResult>}
     */
    async compileAndRun(source, withAI = false) {
        const bytecode = await this.compile(source);
        const { result, output: logs } = await runLatent(source, withAI);
        const analysis = analyzeCode(source);
        return { result, logs, bytecode, analysis };
    }

    /**
     * Компилирует и запускает программу; при ошибке (и включённом self-repair)
     * отправляет исходник + диагностику модели и перезапускает исправленный код.
     * Бюджет попыток — 3 (§6.5 статьи).
     * @param {string} source
     * @param {boolean} withAI
     * @param {number} [maxAttempts]
     * @returns {Promise<RunResult & {repaired: boolean, attempts: number, finalSource: string}>}
     */
    async compileAndRunWithRepair(source, withAI = true, maxAttempts = 3) {
        let currentSource = source;
        let attempts = 0;
        const repairLog = [];

        for (let i = 0; i < maxAttempts; i++) {
            attempts++;
            try {
                const result = await this.compileAndRun(currentSource, withAI);
                return {
                    ...result,
                    repaired: i > 0,
                    attempts,
                    finalSource: currentSource,
                    repairLog,
                };
            } catch (e) {
                repairLog.push(`Attempt ${attempts}: ${e.message}`);
                const patched = await repairCode(currentSource, e.message, withAI);
                if (patched === null) {
                    repairLog.push('Self-repair unavailable — aborting.');
                    throw e;
                }
                currentSource = patched;
            }
        }

        throw new Error(
            `Self-repair failed after ${maxAttempts} attempts:\n${repairLog.join('\n')}`);
    }

    /**
     * Анализирует исходный код без выполнения.
     * @param {string} source
     * @returns {object}
     */
    analyze(source) {
        return analyzeCode(source);
    }

    /**
     * Форматирует значение результата для вывода.
     * @param {any} value
     * @returns {string}
     */
    formatResult(value) {
        if (value === null || value === undefined) return 'null';
        if (Array.isArray(value)) return '[' + value.map(v => this.formatResult(v)).join(', ') + ']';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return String(value);
    }

    /**
     * Форматирует байткод в читаемое hex-представление для вкладки WASM.
     * @param {Uint8Array} bytecode
     * @returns {string}
     */
    formatBytecode(bytecode) {
        if (!bytecode || bytecode.length === 0) return '(empty)';
        const lines = [];
        lines.push(`Bytecode size: ${bytecode.length} bytes`);
        lines.push('');
        const bytesPerRow = 16;
        for (let offset = 0; offset < bytecode.length; offset += bytesPerRow) {
            const chunk = bytecode.slice(offset, offset + bytesPerRow);
            const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
            lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(bytesPerRow * 3 - 1)}  ${ascii}`);
        }
        return lines.join('\n');
    }
}
