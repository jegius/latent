// test/wasm-loader-edge.test.js — граничные ветки загрузчика движка №2.
//
// Проверяем Cache API-путь (кэш-попадание/промах/ошибка), fallback на голый
// fetch, защиту от «чужих» WASM-модулей и оба контракта compile() — синхронный
// и ABI с alloc(i32) → [len][bytes] (без реального compiler.wasm).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWasmCompiler } from '../compiler/wasm-loader.js';
import { CompilerService } from '../services/compiler-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WASM = join(__dirname, '..', 'compiler.wasm');

/** Кодирует unsigned LEB128. */
function u32(bytes, n) {
    do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; bytes.push(b); } while (n);
}

/** Секция WASM: id + длина содержимого. */
function section(bytes, id, content) {
    bytes.push(id);
    u32(bytes, content.length);
    bytes.push(...content);
}

/** Собирает WASM-модуль из готовых секций. */
function moduleBytes({ types = [], funcs = [], memory = false, exports = [], code = [], data = null }) {
    const b = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    if (types.length) { const c = [types.length]; for (const t of types) c.push(0x60, ...t); section(b, 1, c); }
    if (funcs.length) section(b, 3, [funcs.length, ...funcs]);
    if (memory) section(b, 5, [1, 0x00, 1]);
    if (exports.length) {
        const c = [exports.length];
        for (const [name, kind, idx] of exports) {
            const enc = [...new TextEncoder().encode(name)];
            c.push(enc.length, ...enc, kind, idx);
        }
        section(b, 7, c);
    }
    if (code.length) {
        const c = [code.length];
        for (const body of code) c.push(body.length, ...body);
        section(b, 10, c);
    }
    if (data) {
        const c = [1, 0x00, 0x41, 0x00, 0x0b, data.length, ...data];
        section(b, 11, c);
    }
    return new Uint8Array(b);
}

/** Модуль с синхронным compile(i32)->i32, без alloc. */
function syncCompilerModule() {
    return moduleBytes({
        types: [[1, 0x7f, 1, 0x7f]],
        funcs: [0],
        memory: true,
        exports: [['memory', 0x02, 0], ['compile', 0x00, 0]],
        code: [[0x00, 0x41, 0x10, 0x0b]], // return 16
    });
}

/** Модуль с ABI alloc + compile(ptr,len) → [len][bytes] по адресу 0. */
function allocCompilerModule() {
    return moduleBytes({
        types: [[1, 0x7f, 1, 0x7f], [2, 0x7f, 0x7f, 1, 0x7f]],
        funcs: [0, 1],
        memory: true,
        exports: [['memory', 0x02, 0], ['alloc', 0x00, 0], ['compile', 0x00, 1]],
        code: [
            [0x00, 0x41, 0x80, 0x08, 0x0b], // alloc: return 1024
            [0x00, 0x41, 0x00, 0x0b], // compile: return 0
        ],
        data: [0x02, 0x00, 0x00, 0x00, 0x4f, 0x4b], // len=2, "OK"
    });
}

/** Модуль без compile (чужой WASM). */
function memoryOnlyModule() {
    return moduleBytes({
        types: [[1, 0x7f, 1, 0x7f]],
        funcs: [0],
        memory: true,
        exports: [['memory', 0x02, 0], ['other', 0x00, 0]],
        code: [[0x00, 0x41, 0x00, 0x0b]],
    });
}

/** Ответ fetch с буфером wasm. */
function wasmResponse(bytes) {
    return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        clone() { return this; },
        text: async () => '',
    };
}

/** Временно подменяет глобальные caches/fetch. */
async function withGlobals({ caches, fetch }, fn) {
    const origCaches = globalThis.caches;
    const origFetch = globalThis.fetch;
    if (caches === undefined) delete globalThis.caches; else globalThis.caches = caches;
    if (fetch === undefined) delete globalThis.fetch; else globalThis.fetch = fetch;
    try { return await fn(); } finally {
        if (origCaches === undefined) delete globalThis.caches; else globalThis.caches = origCaches;
        if (origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = origFetch;
    }
}

test('Cache API: промах кэша → fetch, put и успешная загрузка', async () => {
    let putCalled = false;
    let matchCalled = false;
    const cache = {
        match: async () => { matchCalled = true; return null; },
        put: async () => { putCalled = true; },
    };
    let fetches = 0;
    const res = await withGlobals({
        caches: { open: async () => cache },
        fetch: async () => { fetches++; return wasmResponse(syncCompilerModule()); },
    }, () => loadWasmCompiler({ url: 'sync.wasm', cacheName: 'c1' }));
    assert.ok(res, 'компилятор должен загрузиться');
    assert.equal(res.source, 'wasm');
    assert.equal(matchCalled, true);
    assert.equal(putCalled, true);
    assert.equal(fetches, 1);
    assert.equal(res.compile('fn main() {}').length, 16);
});

test('Cache API: попадание кэша → fetch не вызывается', async () => {
    let fetches = 0;
    const stored = wasmResponse(syncCompilerModule());
    const res = await withGlobals({
        caches: { open: async () => ({ match: async () => stored, put: async () => {} }) },
        fetch: async () => { fetches++; return stored; },
    }, () => loadWasmCompiler({ url: 'cached.wasm', cacheName: 'c2' }));
    assert.ok(res);
    assert.equal(fetches, 0);
});

test('Cache API: fetch вернул не-ok → null', async () => {
    const res = await withGlobals({
        caches: { open: async () => ({ match: async () => null, put: async () => {} }) },
        fetch: async () => ({ ok: false, status: 404 }),
    }, () => loadWasmCompiler({ url: 'missing.wasm' }));
    assert.equal(res, null);
});

test('Cache API: ошибка caches.open → graceful null', async () => {
    const res = await withGlobals({
        caches: { open: async () => { throw new Error('quota'); } },
        fetch: async () => wasmResponse(syncCompilerModule()),
    }, () => loadWasmCompiler({ url: 'x.wasm' }));
    assert.equal(res, null);
});

test('без Cache API: голый fetch загружает компилятор', async () => {
    const res = await withGlobals({
        caches: undefined,
        fetch: async () => wasmResponse(syncCompilerModule()),
    }, () => loadWasmCompiler({ url: 'plain.wasm' }));
    assert.ok(res);
    assert.equal(res.compile('x').length, 16);
});

test('без Cache API: сеть упала → null', async () => {
    const res = await withGlobals({
        caches: undefined,
        fetch: async () => { throw new Error('offline'); },
    }, () => loadWasmCompiler({ url: 'plain.wasm' }));
    assert.equal(res, null);
});

test('нет ни Cache API, ни fetch → null', async () => {
    const res = await withGlobals({ caches: undefined, fetch: undefined },
        () => loadWasmCompiler({ url: 'nowhere.wasm' }));
    assert.equal(res, null);
});

test('невалидные байты WASM → null (instantiate не бросает наружу)', async () => {
    const res = await withGlobals({
        caches: undefined,
        fetch: async () => wasmResponse(new Uint8Array([0, 1, 2, 3])),
    }, () => loadWasmCompiler({ url: 'broken.wasm' }));
    assert.equal(res, null);
});

test('чужой WASM без compile() → null', async () => {
    const res = await withGlobals({
        caches: undefined,
        fetch: async () => wasmResponse(memoryOnlyModule()),
    }, () => loadWasmCompiler({ url: 'alien.wasm' }));
    assert.equal(res, null);
});

test('ABI alloc+compile: возвращает [len][bytes] (OK)', async () => {
    const res = await withGlobals({
        caches: undefined,
        fetch: async () => wasmResponse(allocCompilerModule()),
    }, () => loadWasmCompiler({ url: 'abi.wasm' }));
    assert.ok(res);
    const out = res.compile('fn main() {}');
    assert.deepEqual(Array.from(out), [0x4f, 0x4b]);
    assert.equal(new TextDecoder().decode(out), 'OK');
    assert.equal(res.source, 'wasm');
    // Это не latent-ABI (нет latent_compile) — версия не определена.
    assert.equal(res.version, undefined);
});

test('CompilerService.ensureWasmCompiler: реальный compiler.wasm (если собран)', async (t) => {
    if (!existsSync(REAL_WASM)) {
        t.skip('compiler.wasm не собран');
        return;
    }
    const bytes = readFileSync(REAL_WASM);
    const svc = new CompilerService();
    const ok = await withGlobals({
        caches: undefined,
        fetch: async () => wasmResponse(new Uint8Array(bytes)),
    }, () => svc.ensureWasmCompiler({ url: 'compiler.wasm' }));
    assert.equal(ok, true);
    assert.equal(svc.hasWasmCompiler(), true);
    // Повторный вызов не перезагружает движок
    assert.equal(await svc.ensureWasmCompiler({ url: 'compiler.wasm' }), true);
    const bytecode = await svc.compile('fn main() -> int { return 1; }');
    assert.ok(bytecode instanceof Uint8Array);
    assert.deepEqual(Array.from(bytecode.slice(0, 4)), [0x00, 0x61, 0x73, 0x6d]);
});
