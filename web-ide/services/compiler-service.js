// services/compiler-service.js — сервис компиляции и выполнения Latent-кода.
// Содержит только бизнес-логику: компиляция, запуск, анализ, форматирование.
// Не знает ничего о DOM и отображении.

import { compile, checkSyntax, runLatent, analyzeCode, repairCode, loadWasmCompiler } from '../compiler-loader.js';
import {
    detectHostFeatures, detectAIFeatures, describeFeatures,
    ENGINE1_LABEL,
} from '../compiler/host-features.js';

/** Первая строка диагностики — для короткого сообщения в UI. */
function firstLine(message) {
    const text = String(message ?? '').trim();
    return text.split('\n')[0] || 'unknown error';
}

/**
 * Результат компиляции и выполнения программы.
 * @typedef {Object} RunResult
 * @property {any} result — значение, возвращённое main()
 * @property {string[]} logs — строки вывода print()
 * @property {Uint8Array} bytecode — скомпилированный байткод
 * @property {object} analysis — статистика анализа кода
 * @property {'1'} engine — движок исполнения (всегда №1, полный host-рантайм)
 * @property {string} engineLabel — метка движка для статус-бара
 * @property {'1'|'2'} compileEngine — движок, давший bytecode
 * @property {string[]} hostFeatures — найденные host-фичи
 * @property {string[]} aiFeatures — найденные AI-примитивы
 * @property {boolean} aiEnabled — был ли включён AI-режим
 * @property {boolean} fallback — engine #2 был загружен, но выбран engine #1
 * @property {string[]} notes — пояснения для пользователя
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
     * Компилирует программу для выполнения с автоматическим выбором движка.
     * Если загружен движок №2 и в программе нет host-фич — пробуем его; при
     * любой ошибке (включая «требует host-рантайма») откатываемся на движок №1.
     * Host-программы сразу компилируются движком №1: это полный рантайм языка.
     * @param {string} source
     * @returns {Promise<{bytecode: Uint8Array, compileEngine: '1'|'2',
     *     hostFeatures: string[], fallback: boolean, note: string|null}>}
     */
    async compileForRun(source) {
        const host = detectHostFeatures(source);
        const wasmAvailable = !!this.wasmCompiler;

        if (wasmAvailable && !host.host) {
            try {
                return {
                    bytecode: this.wasmCompiler.compile(source),
                    compileEngine: '2',
                    hostFeatures: host.features,
                    fallback: false,
                    note: null,
                };
            } catch (e) {
                return {
                    bytecode: await compile(source),
                    compileEngine: '1',
                    hostFeatures: host.features,
                    fallback: true,
                    note: `Engine #2 не смог скомпилировать программу (${firstLine(e.message)}); ` +
                        'используется engine #1 (host runtime).',
                };
            }
        }

        return {
            bytecode: await compile(source),
            compileEngine: '1',
            hostFeatures: host.features,
            fallback: wasmAvailable && host.host,
            note: wasmAvailable && host.host
                ? `Host-фичи (${describeFeatures(host.features)}) исполняются engine #1 (host runtime).`
                : null,
        };
    }

    /**
     * Компилирует и выполняет программу.
     * Исполнение всегда идёт движком №1 (полный host-рантайм); движок №2
     * используется только как компилятор «чистого» подмножества для bytecode.
     * Host-программы и ошибки движка №2 автоматически откатываются на №1.
     * AI-примеры в обычном Run включаются автоматически в mock-режиме, чтобы
     * запускаться без ключа и сетевого гейтвея.
     * @param {string} source — исходный код
     * @param {boolean} withAI — включить AI-функции (реальный гейтвей/self-repair)
     * @returns {Promise<RunResult>}
     */
    async compileAndRun(source, withAI = false) {
        const compiled = await this.compileForRun(source);
        const ai = detectAIFeatures(source);
        const autoAI = !withAI && ai.required;
        const effectiveAI = withAI || autoAI;
        const notes = [];
        if (compiled.note) notes.push(compiled.note);
        if (autoAI) {
            notes.push(
                `AI-примитивы (${describeFeatures(ai.features)}) включены автоматически ` +
                'в mock-режиме; для реальной модели используйте Run with AI.');
        }

        const { result, output: logs } = await runLatent(
            source, effectiveAI, autoAI ? { forceMockAI: true } : {});
        const analysis = analyzeCode(source);
        return {
            result,
            logs,
            bytecode: compiled.bytecode,
            analysis,
            engine: '1',
            engineLabel: ENGINE1_LABEL,
            compileEngine: compiled.compileEngine,
            hostFeatures: compiled.hostFeatures,
            aiFeatures: ai.features,
            aiEnabled: effectiveAI,
            fallback: compiled.fallback,
            notes,
        };
    }

    /**
     * Явная компиляция движком №2 (кнопка Engine #2). Не откатывается на №1:
     * вызывающий код показывает диагностику и предлагает запуск в engine #1.
     * @param {string} source
     * @returns {Uint8Array}
     */
    compileWithEngine2(source) {
        if (!this.wasmCompiler) throw new Error('Engine #2 is not loaded');
        return this.wasmCompiler.compile(source);
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
