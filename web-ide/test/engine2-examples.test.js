// test/engine2-examples.test.js — движок №2 (Rust→WASM) на реальном компиляторе.
// Проверяем, что компилятор выдаёт валидный WASM для «чистых» программ и
// осмысленные ошибки для host-зависимых.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWasmCompiler } from '../compiler-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WASM = join(__dirname, '..', 'compiler.wasm');

async function getCompiler(t) {
    if (!existsSync(REAL_WASM)) { t.skip('compiler.wasm не собран'); return null; }
    const bytes = readFileSync(REAL_WASM);
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        clone() { return this; },
    });
    const c = await loadWasmCompiler({ url: 'compiler.wasm', cacheName: 'e2-test' });
    globalThis.fetch = orig;
    return c;
}

const PURE_PROGRAMS = {
    'add': 'fn add(a: int, b: int) -> int { return a + b; } fn main() -> int { return add(2, 3); }',
    'comments': '// header\nfn main() -> int { return 1; } /* footer */',
    'if-else-if': 'fn f(n: int) -> int { if (n < 0) { return -1; } else if (n == 0) { return 0; } else { return 1; } } fn main() -> int { return f(2); }',
    'c-for': 'fn main() -> int { let s = 0; for (let i = 0; i < 5; i = i + 1) { s = s + i; } return s; }',
    'while': 'fn main() -> int { let n = 27; let c = 0; while (n != 1) { if (n % 2 == 0) { n = n / 2; } else { n = 3 * n + 1; } c = c + 1; } return c; }',
    'arrays': 'fn main() -> int { let a = [10, 20, 30]; return a[1]; }',
    'push': 'fn build(n: int) -> [int] { let r = []; for (let i = 0; i < n; i = i + 1) { r.push(i); } return r; } fn main() -> int { return build(3).length; }',
    'match': 'fn f(n: int) -> int { return match n { case 1: 10, default: 99, }; } fn main() -> int { return f(1); }',
    'print': 'fn main() -> int { print("hello"); return 0; }',
    'class': 'class A { x: int; fn get() -> int { return 1; } } fn main() -> int { return 1; }',
    'async-await': 'async fn v() -> int { return 5; } fn main() -> int { return await v(); }',
    'yield': 'fn main() -> int { yield; return 0; }',
    'assert': 'fn main() -> int { assert(1 == 1); assert_eq(2, 2); return 0; }',
    'len': 'fn main() -> int { let a = [1, 2, 3]; assert(len(a) == 3); return 0; }',
    'for-in': 'fn main() -> int { let s = 0; for (let x in [1, 2, 3]) { s = s + x; } return s; }',
    'select': 'fn consume(ch: channel) -> int { select { case v <- ch: { print(v); } default: { print(0); } } return 0; } fn main() -> int { return 0; }',
};

for (const [name, code] of Object.entries(PURE_PROGRAMS)) {
    test(`движок №2: ${name} → валидный WASM`, async (t) => {
        const c = await getCompiler(t);
        if (!c) return;
        const out = c.compile(code);
        assert.ok(out instanceof Uint8Array, `${name}: ожидался Uint8Array`);
        assert.deepEqual(Array.from(out.slice(0, 4)), [0x00, 0x61, 0x73, 0x6d],
            `${name}: неверная магия WASM`);
        assert.ok(WebAssembly.validate(out), `${name}: WASM не прошёл валидацию`);
    });
}

test('движок №2: host-метод ch.send даёт понятную ошибку', async (t) => {
    const c = await getCompiler(t);
    if (!c) return;
    assert.throws(
        () => c.compile('fn w(ch: channel) { ch.send(1); } fn main() -> int { return 0; }'),
        /send|host/);
});

test('движок №2: неизвестная функция даёт ошибку', async (t) => {
    const c = await getCompiler(t);
    if (!c) return;
    assert.throws(() => c.compile('fn main() -> int { return nope(); }'),
        /Unknown function|Неопредел/);
});

test('движок №2: синтаксическая ошибка не роняет компилятор', async (t) => {
    const c = await getCompiler(t);
    if (!c) return;
    assert.throws(() => c.compile('fn main() { let x = ; }'));
});

test('движок №2: мягкие ключевые слова как имена', async (t) => {
    // Регрессия: `test` (и другие soft-keywords) — валидные идентификаторы,
    // а не только объявления тестов. Раньше `let test = 5;` падало с
    // «ожидалось 'identifier', найдено Test».
    const c = await getCompiler(t);
    if (!c) return;
    const sources = [
        'fn main() -> int { let test = 5; return test; }',
        'fn model() -> int { return 1; } fn main() -> int { return model(); }',
        'fn main() -> int { let agent = 3; return agent; }',
    ];
    for (const src of sources) {
        const out = c.compile(src);
        assert.ok(out instanceof Uint8Array && out.length > 0, src);
        assert.deepEqual(Array.from(out.slice(0, 4)), [0x00, 0x61, 0x73, 0x6d]);
    }
});