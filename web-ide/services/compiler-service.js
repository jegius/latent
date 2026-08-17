// services/compiler-service.js — сервис компиляции и выполнения Latent-кода.
// Содержит только бизнес-логику: компиляция, запуск, анализ, форматирование.
// Не знает ничего о DOM и отображении.

import { compile, checkSyntax, runLatent, analyzeCode } from '../compiler-loader.js';

/**
 * Результат компиляции и выполнения программы.
 * @typedef {Object} RunResult
 * @property {any} result — значение, возвращённое main()
 * @property {string[]} logs — строки вывода print()
 * @property {Uint8Array} bytecode — скомпилированный байткод
 * @property {object} analysis — статистика анализа кода
 */

export class CompilerService {
    /**
     * Компилирует исходный код и возвращает байткод.
     * @param {string} source
     * @returns {Promise<Uint8Array>}
     */
    async compile(source) {
        return compile(source);
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
