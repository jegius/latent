// compiler.mjs — проверка кода через настоящий Rust-компилятор в WASM.
//
// Единственная ответственность: лениво загрузить `web-ide/compiler.wasm` и
// вызвать C-ABI (`latent_alloc` / `latent_compile`, см. src/lib.rs), превратив
// ответ в `{ok, errors:[{message,line,column}]}`. Русские сообщения вида
// «... на строке L:C» разбираются на номер строки и колонку.
//
// Быстрая проверка синтаксиса не требует запуска программы: компилятор только
// компилирует исходник в WASM-байты, ничего не исполняя.

import fs from 'node:fs';

/** Ошибка «компилятор недоступен» (нет файла, неверный формат и т.п.). */
export class CompilerUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CompilerUnavailableError';
    }
}

/** Максимальный размер исходника для одной проверки — 128 КиБ. */
export const MAX_CODE_BYTES = 128 * 1024;

/**
 * Загружает и инстанцирует WASM-компилятор.
 * @param {string} wasmPath
 * @returns {Promise<object>} exports модуля
 */
async function loadInstance(wasmPath) {
    let bytes;
    try {
        bytes = fs.readFileSync(wasmPath);
    } catch (error) {
        const reason = error && error.code === 'ENOENT' ? 'файл не найден' : String(error && error.message ? error.message : error);
        throw new CompilerUnavailableError(
            `Компилятор Latent не найден (${wasmPath}): ${reason}. `
            + 'Соберите его из src/ под wasm32-unknown-unknown и положите в web-ide/compiler.wasm '
            + 'или укажите путь флагом --wasm / переменной LATENT_COMPILER_WASM.',
        );
    }

    // Компилятор не импортирует host-функции, но ABI-контракт допускает
    // env.print — предоставляем заглушки, чтобы инстанцирование было устойчивым.
    const imports = {
        env: {
            print: () => {},
            print_str: () => {},
            print_i32: () => {},
            print_f64: () => {},
            print_bool: () => {},
        },
    };

    let instance;
    try {
        ({ instance } = await WebAssembly.instantiate(bytes, imports));
    } catch (error) {
        throw new CompilerUnavailableError(
            `Не удалось загрузить WASM-компилятор ${wasmPath}: ${error && error.message ? error.message : error}`,
        );
    }

    const exports = instance.exports;
    if (typeof exports.latent_compile !== 'function' || !exports.memory) {
        throw new CompilerUnavailableError(
            `Файл ${wasmPath} не является компилятором Latent: нет экспортов latent_compile/memory.`,
        );
    }
    return exports;
}

/**
 * Создаёт клиент компилятора с ленивой загрузкой экземпляра.
 * @param {{wasmPath: string}} options
 * @returns {{wasmPath: string, check: (code: string) => Promise<{ok: boolean, errors: object[]}>, version: () => Promise<string>}}
 */
export function createCompiler({ wasmPath }) {
    /** @type {Promise<object>|null} */
    let pending = null;

    /** @returns {Promise<object>} */
    function getInstance() {
        if (!pending) {
            pending = loadInstance(wasmPath).catch((error) => {
                pending = null;
                throw error;
            });
        }
        return pending;
    }

    /**
     * Компилирует исходник и нормализует диагностику.
     * @param {string} code
     * @returns {Promise<{ok: boolean, errors: object[]}>}
     */
    async function check(code) {
        const source = typeof code === 'string' ? code : '';
        const bytes = Buffer.byteLength(source, 'utf8');
        if (bytes > MAX_CODE_BYTES) {
            throw new CompilerUnavailableError(`Исходник слишком большой: ${bytes} байт (лимит ${MAX_CODE_BYTES}).`);
        }

        const exports = await getInstance();
        const encoded = new TextEncoder().encode(source);
        const allocSize = Math.max(1, encoded.length);

        let srcPtr;
        try {
            srcPtr = exports.latent_alloc(allocSize);
            if (!srcPtr) throw new Error('latent_alloc вернул нулевой указатель');
            new Uint8Array(exports.memory.buffer, srcPtr, allocSize).set(encoded);
        } catch (error) {
            throw new CompilerUnavailableError(`Ошибка выделения памяти компилятора: ${error.message}`);
        }

        const resPtr = exports.latent_compile(srcPtr, encoded.length);
        if (!resPtr) throw new CompilerUnavailableError('Компилятор вернул нулевой указатель результата');

        // Память могла вырасти во время компиляции — читаем через свежий view.
        const view = new DataView(exports.memory.buffer);
        const status = view.getUint32(resPtr, true);
        const length = view.getUint32(resPtr + 4, true);
        const payload = new Uint8Array(exports.memory.buffer, resPtr + 8, length).slice();

        try {
            if (typeof exports.latent_free === 'function') {
                exports.latent_free(srcPtr, allocSize);
                exports.latent_free(resPtr, 8 + length);
            }
        } catch {
            // Освобождение памяти не критично для корректности результата.
        }

        if (status === 1) return { ok: true, errors: [] };

        const message = new TextDecoder().decode(payload).trim();
        return { ok: false, errors: parseErrors(message) };
    }

    /** @returns {Promise<string>} */
    async function version() {
        try {
            const exports = await getInstance();
            if (typeof exports.latent_version !== 'function') return 'latent-wasm';
            const ptr = exports.latent_version();
            const view = new DataView(exports.memory.buffer);
            const length = view.getUint32(ptr, true);
            return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr + 4, length));
        } catch {
            return 'latent-wasm';
        }
    }

    return { wasmPath, check, version };
}

/**
 * Разбирает строку ошибки компилятора в массив диагностик.
 * Несколько ошибок типизации склеены через `; ` — разделяем их аккуратно,
 * сохраняя сообщения без локации единым элементом.
 * @param {string} raw
 * @returns {{message: string, line: number|null, column: number|null}[]}
 */
export function parseErrors(raw) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
        return [{ message: 'Компилятор сообщил об ошибке без текста', line: null, column: null }];
    }

    const parts = splitJoinedErrors(text);
    return parts.map((part) => {
        const location = part.match(/на строке\s+(\d+):(\d+)/);
        return {
            message: part,
            line: location ? Number(location[1]) : null,
            column: location ? Number(location[2]) : null,
        };
    });
}

/**
 * Делит склеенные сообщения типизатора: разделитель `; ` перед фрагментом,
 * в котором снова есть «на строке L:C». Одиночные сообщения не трогаем.
 * @param {string} text
 * @returns {string[]}
 */
function splitJoinedErrors(text) {
    const locations = text.match(/на строке\s+\d+:\d+/g) || [];
    if (locations.length <= 1) return [text];
    const parts = text.split(/;\s+(?=[^;]*на строке\s+\d+:\d+)/u).map((part) => part.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [text];
}
