// test/wasm-compiler.test.js — тесты движка №2 (ленивый Rust-компилятор в WASM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWasmCompiler } from '../compiler-loader.js';
import { CompilerService } from '../services/compiler-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WASM = join(__dirname, '..', 'compiler.wasm');

function withFakeFetch(bytes) {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        clone() { return this; },
    });
    return () => { globalThis.fetch = orig; };
}

test('loadWasmCompiler: возвращает null, если ресурс недоступен', async () => {
    const compiler = await loadWasmCompiler({ url: 'definitely-missing.wasm' });
    assert.equal(compiler, null);
});

test('loadWasmCompiler: реальная сборка компилятора (если собрана)', async (t) => {
    if (!existsSync(REAL_WASM)) {
        t.skip('compiler.wasm не собран — пропуск');
        return;
    }
    const bytes = readFileSync(REAL_WASM);
    const restore = withFakeFetch(bytes);
    try {
        const compiler = await loadWasmCompiler({ url: 'compiler.wasm', cacheName: 'test-real' });
        assert.ok(compiler, 'компилятор должен загрузиться');
        assert.match(compiler.version, /latent/);

        // Успешная компиляция → настоящий .wasm
        const out = compiler.compile('fn main() -> int { return 42; }');
        assert.ok(out instanceof Uint8Array);
        assert.deepEqual(Array.from(out.slice(0, 4)), [0x00, 0x61, 0x73, 0x6d]);
        assert.ok(WebAssembly.validate(out), 'движок №2 должен выдавать валидный wasm');

        // Ошибка компиляции → исключение с диагностикой
        assert.throws(() => compiler.compile('fn main() { let x = ; }'), /Ошибка|Expected|ожидалось/);
    } finally {
        restore();
    }
});

test('loadWasmCompiler: принимает временный WASM-модуль с compile()', async () => {
    const encoder = new TextEncoder();
    const wasmBytes = buildFakeCompilerModule(encoder);
    const restore = withFakeFetch(wasmBytes);
    try {
        const compiler = await loadWasmCompiler({ url: 'x.wasm', cacheName: 't' });
        assert.ok(compiler, 'компилятор должен загрузиться');
        assert.equal(compiler.source, 'wasm');
        const out = compiler.compile('fn main() {}');
        assert.ok(out instanceof Uint8Array);
        assert.ok(out.length > 0);
    } finally {
        restore();
    }
});

test('CompilerService: ensureWasmCompiler не падает без движка №2', async () => {
    const svc = new CompilerService();
    const ok = await svc.ensureWasmCompiler({ url: 'missing.wasm' });
    assert.equal(ok, false);
    assert.equal(svc.hasWasmCompiler(), false);
    const again = await svc.ensureWasmCompiler({ url: 'missing.wasm' });
    assert.equal(again, false);
});

test('CompilerService: делегирует compile движку №2, когда он есть', async () => {
    const svc = new CompilerService();
    const marker = new Uint8Array([1, 2, 3]);
    svc.wasmCompiler = { compile: () => marker };
    assert.equal(await svc.compile('ignored'), marker);
});

/**
 * Строит минимальный WASM-модуль, экспортирующий:
 *  - memory
 *  - alloc(i32) -> i32 (bump от 1024)
 *  - compile(i32, i32) -> i32 (возвращает [len][bytes] по фиксированному адресу 64)
 * Тело compile игнорирует вход и кладёт 4 байта. Этого достаточно для проверки
 * контракта загрузчика.
 */
function buildFakeCompilerModule(encoder) {
    // Ручная сборка WASM — маленький модуль.
    const bytes = [];
    const u32 = (n) => { // LEB128 unsigned
        do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; bytes.push(b); } while (n);
    };
    const section = (id, content) => {
        bytes.push(id); u32(content.length); bytes.push(...content);
    };

    bytes.push(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);

    // Type section: 2 types
    //  type0: (i32)->i32  [alloc]
    //  type1: (i32,i32)->i32 [compile]
    const typeContent = [];
    typeContent.push(2);
    typeContent.push(0x60, 1, 0x7f, 1, 0x7f);
    typeContent.push(0x60, 2, 0x7f, 0x7f, 1, 0x7f);
    section(1, typeContent);

    // Function section: alloc=type0, compile=type1
    const funcContent = [2, 0x00, 0x01];
    section(3, funcContent);

    // Memory section: 1 page
    section(5, [1, 0x00, 1]);

    // Export section: memory, alloc, compile
    const exportContent = [];
    exportContent.push(3);
    const nameMem = [...encoder.encode('memory')];
    exportContent.push(nameMem.length, ...nameMem, 0x02, 0x00);
    const nameAlloc = [...encoder.encode('alloc')];
    exportContent.push(nameAlloc.length, ...nameAlloc, 0x00, 0x00);
    const nameCompile = [...encoder.encode('compile')];
    exportContent.push(nameCompile.length, ...nameCompile, 0x00, 0x01);
    section(7, exportContent);

    // Code section: two bodies
    const codeContent = [];
    codeContent.push(2);
    // alloc(i32)->i32: return 1024  (i32.const 1024; end)
    const allocBody = [0x00, 0x41, 0x80, 0x08, 0x0b];
    codeContent.push(allocBody.length, ...allocBody);
    // compile(i32,i32)->i32: store len=4 at addr 64, return 64
    //   i32.const 64; i32.const 4; i32.store align=2 offset=0; i32.const 64; end
    const compileBody = [
        0x00,
        0x41, 0xC0, 0x00,    // i32.const 64 (signed LEB: 0x40 alone = -64)
        0x41, 0x04,          // i32.const 4
        0x36, 0x02, 0x00,    // i32.store align=2 offset=0
        0x41, 0xC0, 0x00,    // i32.const 64
        0x0b,
    ];
    codeContent.push(compileBody.length, ...compileBody);
    section(10, codeContent);

    return new Uint8Array(bytes);
}