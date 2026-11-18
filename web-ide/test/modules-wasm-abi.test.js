// test/modules-wasm-abi.test.js — C-ABI latent_compile_files в wasm-loader.
//
// Собираем синтетический WASM-модуль с latent_alloc/latent_free/
// latent_compile_files и проверяем, что загрузчик отдаёт supportsModules,
// кодирует вход в память и читает [status][len][payload].

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWasmCompiler } from '../compiler/wasm-loader.js';
import {
    buildModuleManifest, encodeModuleManifest,
} from '../compiler/modules-manifest.js';

const REAL_WASM = join(dirname(fileURLToPath(import.meta.url)), '..', 'compiler.wasm');

function u32(bytes, n) {
    do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; bytes.push(b); } while (n);
}

function section(bytes, id, content) {
    bytes.push(id);
    u32(bytes, content.length);
    bytes.push(...content);
}

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

/**
 * latent_alloc(size) → 1024; latent_free(ptr,size) → (); 
 * latent_compile_files(ptr,len) → 0, где по адресу 0 лежит status=1/len=2/"OK".
 */
function moduleAbiWasm() {
    return moduleBytes({
        types: [
            [1, 0x7f, 1, 0x7f], // (i32) -> i32
            [2, 0x7f, 0x7f, 0], // (i32, i32) -> ()
            [2, 0x7f, 0x7f, 1, 0x7f], // (i32, i32) -> i32
        ],
        funcs: [0, 1, 2],
        memory: true,
        exports: [
            ['memory', 0x02, 0],
            ['latent_alloc', 0x00, 0],
            ['latent_free', 0x00, 1],
            ['latent_compile_files', 0x00, 2],
        ],
        code: [
            [0x00, 0x41, 0x80, 0x08, 0x0b], // return 1024
            [0x00, 0x0b], // free: no-op
            [0x00, 0x41, 0x00, 0x0b], // compile_files: return 0
        ],
        data: [0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4f, 0x4b],
    });
}

function wasmResponse(bytes) {
    return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        clone() { return this; },
    };
}

async function loadSynthetic(bytes) {
    const origCaches = globalThis.caches;
    const origFetch = globalThis.fetch;
    delete globalThis.caches;
    globalThis.fetch = async () => wasmResponse(bytes);
    try {
        return await loadWasmCompiler({ url: 'modules-abi.wasm' });
    } finally {
        if (origCaches === undefined) delete globalThis.caches; else globalThis.caches = origCaches;
        if (origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = origFetch;
    }
}

test('wasm-loader: latent_compile_files → supportsModules и LPF1-манифест', async () => {
    const compiler = await loadSynthetic(moduleAbiWasm());
    assert.ok(compiler);
    assert.equal(compiler.supportsModules, true);
    assert.equal(compiler.moduleAbi, 'LPF1');
    assert.equal(typeof compiler.compileFiles, 'function');
    assert.throws(() => compiler.compile('fn main() {}'), /latent_compile is not exported/);

    const manifest = encodeModuleManifest([
        { path: 'main.lat', source: 'import "./math.lat";\nfn main() {}' },
        { path: 'math.lat', source: 'export fn f() {}' },
    ], 0);
    const payload = compiler.compileFiles(manifest);
    assert.equal(new TextDecoder().decode(payload), 'OK');
});

test('wasm-loader: модуль без ABI → supportsModules=false, compileFiles=null', async () => {
    const generic = await loadSynthetic(moduleBytes({
        types: [[1, 0x7f, 1, 0x7f]],
        funcs: [0],
        memory: true,
        exports: [['memory', 0x02, 0], ['compile', 0x00, 0]],
        code: [[0x00, 0x41, 0x10, 0x0b]],
    }));
    assert.ok(generic);
    assert.equal(generic.supportsModules, false);
    assert.equal(generic.compileFiles, null);
    assert.equal(generic.moduleAbi, null);
});

test('реальный compiler.wasm: latent_compile_files компилирует проект (если ABI есть)', async (t) => {
    if (!existsSync(REAL_WASM)) {
        t.skip('compiler.wasm не собран');
        return;
    }
    const compiler = await loadSynthetic(new Uint8Array(readFileSync(REAL_WASM)));
    assert.ok(compiler, 'реальный compiler.wasm должен загрузиться');
    if (!compiler.supportsModules) {
        t.skip('в этой сборке compiler.wasm ещё нет latent_compile_files');
        return;
    }
    const manifest = buildModuleManifest([
        {
            name: 'main.lat',
            code: 'import { square } from "./math.lat";\nfn main() -> int { return square(6); }',
        },
        { name: 'math.lat', code: 'export fn square(x: int) -> int { return x * x; }' },
    ], 'main.lat');
    const payload = compiler.compileFiles(
        encodeModuleManifest(manifest.files, manifest.entryIndex));
    assert.ok(WebAssembly.validate(payload), 'движок №2 вернул невалидный WASM');
    const { instance } = await WebAssembly.instantiate(payload, {
        env: { print: () => {} },
    });
    assert.equal(instance.exports.main(), 36);

    // Ошибка линковки приходит текстом (status=0) и превращается в Error.
    const bad = buildModuleManifest([
        { name: 'main.lat', code: 'import { nope } from "./m.lat";\nfn main() {}' },
        { name: 'm.lat', code: 'export fn yes() {}' },
    ], 'main.lat');
    assert.throws(() => compiler.compileFiles(
        encodeModuleManifest(bad.files, bad.entryIndex)), /не экспортирован|not exported/);
});
