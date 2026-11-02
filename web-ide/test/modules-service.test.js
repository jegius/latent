// test/modules-service.test.js — CompilerService: многофайловый workspace,
// выбор движка, кэш манифестов и graceful-поведение до появления C-ABI
// latent_compile_files (движок №2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompilerService } from '../services/compiler-service.js';
import { decodeModuleManifest } from '../compiler/modules-manifest.js';
import { configureAI, getAIConfig } from '../compiler-loader.js';

const PROJECT = {
    entry: 'main.lat',
    files: [
        {
            name: 'main.lat',
            code: `import { square } from "./math.lat";
import { sumSquares } from "./util.lat";
fn main() -> int {
    print("sq=" + square(5));
    return sumSquares(3, 4);
}
`,
        },
        { name: 'math.lat', code: 'export fn square(x: int) -> int { return x * x; }\n' },
        {
            name: 'util.lat',
            code: 'import { square as sq } from "./math.lat";\n' +
                'export fn sumSquares(a: int, b: int) -> int { return sq(a) + sq(b); }\n',
        },
    ],
};

test('CompilerService: compileAndRun на многофайловом workspace', async () => {
    const svc = new CompilerService();
    const out = await svc.compileAndRun(PROJECT, false);
    assert.equal(out.result, 25);
    assert.deepEqual(out.logs, ['sq=25']);
    assert.equal(out.compileEngine, '1');
    assert.equal(out.fallback, false);
    assert.equal(out.modules, 3);
    assert.equal(out.analysis.functions, 3);
    assert.deepEqual(out.modulePaths, ['main.lat', 'math.lat', 'util.lat']);
});

test('CompilerService: compileAndRunProject/checkSyntaxProject', async () => {
    const svc = new CompilerService();
    const out = await svc.compileAndRunProject(PROJECT.files, PROJECT.entry, false);
    assert.equal(out.result, 25);
    assert.equal(await svc.checkSyntaxProject(PROJECT.files, PROJECT.entry), true);

    await assert.rejects(
        () => svc.compileAndRunProject([
            { name: 'main.lat', code: 'import { nope } from "./m.lat";\nfn main() {}' },
            { name: 'm.lat', code: 'export fn yes() {}' },
        ], 'main.lat', false),
        (e) => e.code === 'NOT_EXPORTED');
    await assert.rejects(
        () => svc.checkSyntaxProject([
            { name: 'main.lat', code: 'fn main() { let x = ; }' },
        ], 'main.lat'), /line 1/);
});

test('CompilerService: без модульного ABI — понятное «engine #2 пока без модулей»', async () => {
    const svc = new CompilerService();
    let legacyCalls = 0;
    svc.wasmCompiler = {
        compile: () => { legacyCalls++; return new Uint8Array([1]); },
        supportsModules: false,
    };
    const out = await svc.compileAndRunProject(PROJECT.files, PROJECT.entry, false);
    assert.equal(out.result, 25);
    assert.equal(out.compileEngine, '1');
    assert.equal(out.fallback, true);
    assert.ok(out.notes.some((n) => /без модулей/.test(n) && /latent_compile_files/.test(n)));
    assert.equal(legacyCalls, 0, 'однофайловый latent_compile не должен вызываться для проекта');
    assert.equal(svc.hasEngine2Modules(), false);
});

test('CompilerService: compileWithEngine2Project бросает ENGINE2_NO_MODULES без ABI', () => {
    const svc = new CompilerService();
    svc.wasmCompiler = { compile: () => new Uint8Array([1]), supportsModules: false };
    assert.throws(() => svc.compileWithEngine2Project(PROJECT.files, PROJECT.entry), (e) =>
        e.code === 'ENGINE2_NO_MODULES' && /latent_compile_files/.test(e.message));
});

test('CompilerService: engine #2 с latent_compile_files получает манифест LPF1 и кэшируется', async () => {
    const svc = new CompilerService();
    const manifests = [];
    svc.wasmCompiler = {
        compile: () => new Uint8Array([9]),
        compileFiles: (bytes) => {
            manifests.push(decodeModuleManifest(bytes));
            return new Uint8Array([0x00, 0x61, 0x73, 0x6d, manifests.length]);
        },
        supportsModules: true,
    };
    assert.equal(svc.hasEngine2Modules(), true);
    const first = await svc.compileAndRunProject(PROJECT.files, PROJECT.entry, false);
    assert.equal(first.result, 25);
    assert.equal(first.compileEngine, '2');
    assert.equal(first.fallback, false);
    assert.deepEqual(Array.from(first.bytecode.slice(0, 4)), [0x00, 0x61, 0x73, 0x6d]);
    assert.equal(manifests.length, 1);
    assert.deepEqual(manifests[0].files.map((f) => f.path),
        ['main.lat', 'math.lat', 'util.lat']);
    assert.equal(manifests[0].files[manifests[0].entryIndex].path, 'main.lat');
    assert.match(manifests[0].files[0].source, /import \{ square \}/);

    // Тот же набор файлов → кэш, повторного вызова C-ABI нет.
    await svc.compileAndRunProject(PROJECT.files, PROJECT.entry, false);
    assert.equal(manifests.length, 1);

    // Изменение любого файла → новый хэш и новая компиляция.
    const changed = PROJECT.files.map((f) => (f.name === 'math.lat'
        ? { ...f, code: f.code.replace('x * x', 'x * x + 1') } : f));
    const third = await svc.compileAndRunProject(changed, PROJECT.entry, false);
    assert.equal(third.result, 27);
    assert.equal(manifests.length, 2);
});

test('CompilerService: host-фичи в проекте не отправляются в engine #2', async () => {
    const svc = new CompilerService();
    let calls = 0;
    svc.wasmCompiler = {
        compile: () => { calls++; return new Uint8Array([1]); },
        compileFiles: () => { calls++; return new Uint8Array([1]); },
        supportsModules: true,
    };
    const files = [
        { name: 'main.lat', code: 'import { work } from "./w.lat";\nfn main() -> int { return work(); }' },
        { name: 'w.lat', code: 'export fn work() -> int { let ch = channel(); ch <- 7; return ch.recv(); }' },
    ];
    const out = await svc.compileAndRunProject(files, 'main.lat', false);
    assert.equal(out.result, 7);
    assert.equal(out.compileEngine, '1');
    assert.equal(out.fallback, true);
    assert.equal(calls, 0);
    assert.ok(out.notes.some((n) => /Host-фичи/.test(n)));
    const features = svc.detectProjectHostFeatures(files).features;
    assert.ok(features.includes('channel'));
    assert.ok(features.some((f) => f.includes('<-')));
});

test('CompilerService: ошибка engine #2 → фолбэк на engine #1, ошибки линкера важнее', async () => {
    const svc = new CompilerService();
    svc.wasmCompiler = {
        compile: () => new Uint8Array([1]),
        compileFiles: () => { throw new Error('boom'); },
        supportsModules: true,
    };
    const out = await svc.compileAndRunProject(PROJECT.files, PROJECT.entry, false);
    assert.equal(out.result, 25);
    assert.equal(out.compileEngine, '1');
    assert.equal(out.fallback, true);
    assert.ok(out.notes.some((n) => n.includes('boom') && n.includes('engine #1')));

    await assert.rejects(() => svc.compileAndRunProject([
        { name: 'main.lat', code: 'import { nope } from "./m.lat";\nfn main() {}' },
        { name: 'm.lat', code: 'export fn yes() {}' },
    ], 'main.lat', false), (e) => e.code === 'NOT_EXPORTED' && !/boom/.test(e.message));
});

test('CompilerService: однофайловая программа по-прежнему идёт в latent_compile', async () => {
    const svc = new CompilerService();
    const marker = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 7]);
    svc.wasmCompiler = {
        compile: () => marker,
        compileFiles: () => { throw new Error('не должен вызываться'); },
        supportsModules: true,
    };
    const out = await svc.compileAndRun('fn main() -> int { return 3; }', false);
    assert.equal(out.result, 3);
    assert.equal(out.compileEngine, '2');
    assert.deepEqual(out.bytecode, marker);
});

test('CompilerService: self-repair проекта чинит entry-файл (mock-модель)', async () => {
    const svc = new CompilerService();
    const origFetch = globalThis.fetch;
    const origCfg = getAIConfig();
    globalThis.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({
            choices: [{
                message: {
                    content: 'import { square } from "./math.lat";\n' +
                        'fn main() -> int { return square(4); }',
                },
            }],
        }),
    });
    configureAI({ provider: 'openai-compatible', model: 'm' });
    try {
        const out = await svc.compileAndRunWithRepairProject([
            { name: 'main.lat', code: 'import { square } from "./math.lat";\nfn main() { return bad(); }' },
            { name: 'math.lat', code: 'export fn square(x: int) -> int { return x * x; }' },
        ], 'main.lat', true, 3);
        assert.equal(out.result, 16);
        assert.equal(out.repaired, true);
        assert.equal(out.attempts, 2);
        assert.match(out.finalSource, /square\(4\)/);
    } finally {
        configureAI(origCfg);
        globalThis.fetch = origFetch;
    }
});
