// tooling/latent-lsp/test/wasm-compiler.test.mjs — загрузчик движка №2 и его ABI.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    DEFAULT_COMPILER_WASM,
    loadWasmCompiler,
    resolveCompilerWasmPath,
    WasmCompiler,
} from '../src/wasm-compiler.mjs';
import { COMPILER_WASM } from './helpers.mjs';

test('resolveCompilerWasmPath: аргумент → env → путь по умолчанию', () => {
    assert.equal(resolveCompilerWasmPath('C:/custom/compiler.wasm', {}),
        path.resolve('C:/custom/compiler.wasm'));
    assert.equal(resolveCompilerWasmPath(undefined, { LATENT_COMPILER_WASM: 'C:/env/compiler.wasm' }),
        path.resolve('C:/env/compiler.wasm'));
    assert.equal(resolveCompilerWasmPath(undefined, {}), DEFAULT_COMPILER_WASM);
    assert.ok(fs.existsSync(DEFAULT_COMPILER_WASM), 'web-ide/compiler.wasm должен существовать');
});

test('загрузка реального compiler.wasm и версия', async () => {
    const compiler = await WasmCompiler.load(COMPILER_WASM);
    assert.ok(compiler, 'компилятор должен загрузиться');
    assert.equal(compiler.isAvailable(), true);
    assert.match(compiler.version, /latent/i);
});

test('compile: валидный код даёт .wasm-байты', async () => {
    const compiler = await WasmCompiler.load(COMPILER_WASM);
    assert.ok(compiler);
    const result = compiler.compile('fn main() -> int { return 42; }');
    assert.equal(result.ok, true);
    assert.ok(result.wasm instanceof Uint8Array);
    assert.ok(result.wasm.length > 8);
    assert.deepEqual([...result.wasm.slice(0, 4)], [0x00, 0x61, 0x73, 0x6D]);
});

test('compile: битый код даёт текст ошибки с позицией', async () => {
    const compiler = await WasmCompiler.load(COMPILER_WASM);
    assert.ok(compiler);
    const result = compiler.compile('fn main() {\n    let x = ;\n}\n');
    assert.equal(result.ok, false);
    assert.match(result.error, /на строке \d+:\d+/);
});

test('compile: повторные вызовы не ломают память (alloc/free ABI)', async () => {
    const compiler = await WasmCompiler.load(COMPILER_WASM);
    assert.ok(compiler);
    for (let i = 0; i < 5; i++) {
        const ok = compiler.compile(`fn main() -> int { return ${i}; }`);
        assert.equal(ok.ok, true);
        const bad = compiler.compile('fn main() { let x = ; }');
        assert.equal(bad.ok, false);
    }
});

test('отсутствующий wasm → null и предупреждение (graceful)', async () => {
    const warnings = [];
    const missing = path.join(os.tmpdir(), `latent-no-such-${process.pid}.wasm`);
    const compiler = await loadWasmCompiler(missing, {
        logger: { warn: (m) => warnings.push(m), info: () => {} },
    });
    assert.equal(compiler, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Диагностика отключена/);
});

test('битый wasm-файл → null без исключения', async () => {
    const brokenPath = path.join(os.tmpdir(), `latent-broken-${process.pid}.wasm`);
    fs.writeFileSync(brokenPath, Buffer.from('not a wasm module at all'));
    const warnings = [];
    try {
        const compiler = await loadWasmCompiler(brokenPath, {
            logger: { warn: (m) => warnings.push(m), info: () => {} },
        });
        assert.equal(compiler, null);
        assert.ok(warnings.some((w) => /инстанцировать|Диагностика/.test(w)));
    } finally {
        fs.unlinkSync(brokenPath);
    }
});

test('WasmCompiler без ABI считается недоступным', () => {
    const fake = new WasmCompiler({ memory: {} }, 'fake.wasm');
    assert.equal(fake.isAvailable(), false);
    const result = fake.compile('anything');
    // ABI нет → компилятор не должен бросать наружу.
    assert.equal(result.ok, false);
});
