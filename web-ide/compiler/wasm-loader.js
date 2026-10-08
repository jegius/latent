// compiler/wasm-loader.js — ленивая загрузка движка №2 (Rust→WASM).
// Единственная ответственность: получение объекта {compile, source, version}.

/**
 * Ленивая загрузка движка №2 — настоящего Rust-компилятора, собранного в WASM
 * (§6.6 статьи). Компилятор кэшируется через Cache API; инстанцирование идёт
 * через `instantiate` (не `instantiateStreaming`) — dev-серверы часто отдают
 * неверный MIME, а streaming-вариант строг к нему.
 *
 * Возвращает объект с методом compile(source) → Uint8Array, либо null, если
 * компилятор недоступен (тогда IDE остаётся на движке №1).
 *
 * @param {Object} [opts]
 * @param {string} [opts.url] — путь к compiler.wasm
 * @param {string} [opts.cacheName] — имя кэша Cache API
 * @param {Function} [opts.imports] — объект импортов для инстанцирования
 * @returns {Promise<{compile: (source: string) => Uint8Array, source: string}|null>}
 */
export async function loadWasmCompiler(opts = {}) {
    const url = opts.url || 'compiler.wasm';
    const cacheName = opts.cacheName || 'latent-compiler-v1';

    let bytes = null;

    // 1. Пробуем Cache API (один раз заплатили — дальше из кэша).
    if (typeof caches !== 'undefined') {
        try {
            const cache = await caches.open(cacheName);
            let resp = await cache.match(url);
            if (!resp && typeof fetch !== 'undefined') {
                resp = await fetch(url);
                if (resp.ok) {
                    await cache.put(url, resp.clone());
                } else {
                    return null;
                }
            }
            if (resp) {
                bytes = await resp.arrayBuffer();
            }
        } catch (e) {
            bytes = null;
        }
    } else if (typeof fetch !== 'undefined') {
        // Без Cache API — просто fetch.
        try {
            const resp = await fetch(url);
            if (resp.ok) bytes = await resp.arrayBuffer();
        } catch (e) {
            bytes = null;
        }
    }

    if (!bytes) return null;

    // 2. Инстанцирование с предоставленным шимом (импорты Части VII).
    try {
        const imports = opts.imports || {};
        const { instance } = await WebAssembly.instantiate(bytes, imports);
        const exports = instance.exports;

        // Реальный ABI движка №2 (см. src/lib.rs): latent_alloc / latent_compile.
        if (typeof exports.latent_compile === 'function' && exports.memory) {
            const compile = (source) => {
                const enc = new TextEncoder().encode(source);
                const srcPtr = exports.latent_alloc(enc.length || 1);
                new Uint8Array(exports.memory.buffer).set(enc, srcPtr);
                const resPtr = exports.latent_compile(srcPtr, enc.length);
                const view = new DataView(exports.memory.buffer);
                const status = view.getUint32(resPtr, true);
                const len = view.getUint32(resPtr + 4, true);
                const payload = new Uint8Array(exports.memory.buffer, resPtr + 8, len).slice();
                // Освобождаем входной и выходной буферы
                try { exports.latent_free(srcPtr, enc.length || 1); } catch (e) { /* ignore */ }
                try { exports.latent_free(resPtr, 8 + len); } catch (e) { /* ignore */ }
                if (status !== 1) {
                    throw new Error(new TextDecoder().decode(payload));
                }
                return payload;
            };
            let version = 'latent-wasm';
            if (typeof exports.latent_version === 'function') {
                try {
                    const vPtr = exports.latent_version();
                    const vView = new DataView(exports.memory.buffer);
                    const vLen = vView.getUint32(vPtr, true);
                    version = new TextDecoder().decode(
                        new Uint8Array(exports.memory.buffer, vPtr + 4, vLen));
                } catch (e) { /* ignore */ }
            }
            return { compile, source: 'wasm', version };
        }

        if (typeof exports.compile !== 'function') {
            // Модуль без compile() — не наш движок №2.
            return null;
        }

        // Компилятор принимает строку (ptr,len) либо, в облегчённой сборке,
        // строку напрямую. Поддерживаем оба варианта.
        const compile = (source) => {
            if (exports.alloc && typeof exports.alloc === 'function'
                && exports.compile.length >= 2) {
                const enc = new TextEncoder().encode(source);
                const ptr = exports.alloc(enc.length);
                new Uint8Array(exports.memory.buffer).set(enc, ptr);
                const outPtr = exports.compile(ptr, enc.length);
                // Формат результата: [len u32 LE][bytes]
                const view = new DataView(exports.memory.buffer);
                const len = view.getUint32(outPtr, true);
                return new Uint8Array(exports.memory.buffer, outPtr + 4, len).slice();
            }
            const result = exports.compile(source);
            if (result instanceof Uint8Array) return result;
            if (result instanceof ArrayBuffer) return new Uint8Array(result);
            // ES-модуль без явного типа — вернём как есть
            return new Uint8Array(result || []);
        };

        return { compile, source: 'wasm' };
    } catch (e) {
        return null;
    }
}