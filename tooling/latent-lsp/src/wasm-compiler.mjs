// tooling/latent-lsp/src/wasm-compiler.mjs — загрузчик движка №2 (Rust→WASM).
//
// Единственная ответственность: превратить `web-ide/compiler.wasm` в объект с
// методом `compile(source)`. ABI (src/lib.rs):
//   ptr = latent_alloc(len); записать исходник в memory[ptr..ptr+len]
//   res = latent_compile(ptr, len) → указатель на [status u32][len u32][payload]
//     status 1 — payload = .wasm-байты;
//     status 0 — payload = UTF-8 текст ошибки.
// При отсутствии/битом wasm сервер работает без диагностики (graceful):
// load() возвращает null, а вызывающая сторона лишь логирует предупреждение.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './language-data.mjs';

/** Путь к компилятору по умолчанию: web-ide/compiler.wasm в корне репозитория. */
export const DEFAULT_COMPILER_WASM = path.resolve(REPO_ROOT, 'web-ide/compiler.wasm');

/**
 * Решает, откуда брать compiler.wasm.
 * Приоритет: явный аргумент → env LATENT_COMPILER_WASM → путь в репозитории.
 * @param {string} [explicit]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveCompilerWasmPath(explicit, env = process.env) {
    if (explicit) return path.resolve(explicit);
    if (env && env.LATENT_COMPILER_WASM) return path.resolve(env.LATENT_COMPILER_WASM);
    return DEFAULT_COMPILER_WASM;
}

/**
 * Шим импортов на случай, если сборка компилятора начнёт импортировать
 * host-функции (`env.print`, `latent_host_print`, `latent_host_now`).
 * Текущая сборка не импортирует ничего — шим пробуется вторым.
 */
function hostShim() {
    const noop = () => {};
    return {
        env: {
            print: noop,
            latent_host_print: noop,
            latent_host_now: () => 0,
        },
    };
}

/**
 * Обёртка над инстанцией компилятора-as-WASM.
 */
export class WasmCompiler {
    /**
     * @param {WebAssembly.Exports} exports
     * @param {string} wasmPath
     * @param {{logger?: any}} [opts]
     */
    constructor(exports, wasmPath, opts = {}) {
        this.exports = exports;
        this.wasmPath = wasmPath;
        this.logger = opts.logger || null;
        /** @type {string} */
        this.version = 'latent-wasm';
        /** @type {TextEncoder} */
        this.encoder = new TextEncoder();
        /** @type {TextDecoder} */
        this.decoder = new TextDecoder();
        this.readVersion();
    }

    /** Читает версию компилятора (необязательный экспорт). */
    readVersion() {
        try {
            if (typeof this.exports.latent_version !== 'function') return;
            const ptr = this.exports.latent_version();
            if (!ptr) return;
            const view = new DataView(this.exports.memory.buffer);
            const length = view.getUint32(ptr, true);
            const bytes = new Uint8Array(this.exports.memory.buffer, ptr + 4, length);
            this.version = this.decoder.decode(bytes);
        } catch (e) {
            // Версия — необязательная информация, ошибку не пробрасываем.
        }
    }

    /** Доступен ли валидный ABI. */
    isAvailable() {
        return typeof this.exports.latent_alloc === 'function'
            && typeof this.exports.latent_compile === 'function'
            && !!this.exports.memory;
    }

    /**
     * Компилирует исходник.
     * @param {string} source
     * @returns {{ok: true, wasm: Uint8Array} | {ok: false, error: string}}
     */
    compile(source) {
        const text = typeof source === 'string' ? source : String(source ?? '');
        const input = this.encoder.encode(text);
        const size = Math.max(1, input.length);
        let srcPtr = 0;
        let resPtr = 0;
        try {
            srcPtr = this.exports.latent_alloc(size);
            if (!srcPtr) {
                return { ok: false, error: 'Компилятор не смог выделить память под исходник' };
            }
            new Uint8Array(this.exports.memory.buffer).set(input, srcPtr);
            resPtr = this.exports.latent_compile(srcPtr, input.length);
            if (!resPtr) {
                return { ok: false, error: 'Компилятор вернул нулевой указатель на результат' };
            }
            const view = new DataView(this.exports.memory.buffer);
            const status = view.getUint32(resPtr, true);
            const length = view.getUint32(resPtr + 4, true);
            const payload = new Uint8Array(
                this.exports.memory.buffer, resPtr + 8, length).slice();
            if (status === 1) return { ok: true, wasm: payload };
            return { ok: false, error: this.decoder.decode(payload) };
        } catch (e) {
            this.logger?.warn?.(`ошибка вызова компилятора: ${e.message}`);
            return { ok: false, error: `Компилятор завершился с ошибкой: ${e.message}` };
        } finally {
            this.free(srcPtr, size);
            if (resPtr) {
                try {
                    const view = new DataView(this.exports.memory.buffer);
                    const length = view.getUint32(resPtr + 4, true);
                    this.free(resPtr, 8 + length);
                } catch (e) {
                    // Освобождать уже нечего — память могла быть повреждена.
                }
            }
        }
    }

    /**
     * Освобождает буфер (если экспорт latent_free присутствует).
     * @param {number} ptr
     * @param {number} size
     */
    free(ptr, size) {
        if (!ptr || typeof this.exports.latent_free !== 'function') return;
        try {
            this.exports.latent_free(ptr, size);
        } catch (e) {
            // latent_free — best-effort: утечка на короткоживущем процессе допустима.
        }
    }

    /**
     * Загружает компилятор из файла. Возвращает null, если wasm нет или он битый.
     * @param {string} wasmPath
     * @param {{logger?: any}} [opts]
     * @returns {Promise<WasmCompiler|null>}
     */
    static async load(wasmPath, opts = {}) {
        const logger = opts.logger || null;
        const target = path.resolve(wasmPath);
        let bytes;
        try {
            bytes = await fs.promises.readFile(target);
        } catch (e) {
            logger?.warn?.(`компилятор не найден (${target}): ${e.message}. ` +
                'Диагностика отключена, остальные возможности LSP работают.');
            return null;
        }

        let instance = null;
        for (const imports of [{}, hostShim()]) {
            try {
                instance = await WebAssembly.instantiate(bytes, imports);
                break;
            } catch (e) {
                // Пробуем следующий набор импортов.
            }
        }
        if (!instance) {
            logger?.warn?.(`не удалось инстанцировать компилятор (${target}). Диагностика отключена.`);
            return null;
        }

        const compiler = new WasmCompiler(instance.instance.exports, target, { logger });
        if (!compiler.isAvailable()) {
            logger?.warn?.(`в ${target} нет ABI latent_alloc/latent_compile. Диагностика отключена.`);
            return null;
        }
        logger?.info?.(`компилятор загружен: ${target} (${compiler.version})`);
        return compiler;
    }
}

/**
 * Удобная функция загрузки.
 * @param {string} [explicitPath]
 * @param {{logger?: any, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<WasmCompiler|null>}
 */
export async function loadWasmCompiler(explicitPath, opts = {}) {
    return WasmCompiler.load(resolveCompilerWasmPath(explicitPath, opts.env), opts);
}
