import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runner = require('../src/runner.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');
const compilerWasmPath = path.join(repoRoot, 'web-ide', 'compiler.wasm');
const fakeLatentcPath = path.join(__dirname, 'fixtures', 'fake-latentc.mjs');

const VALID_PROGRAM = 'fn main() -> int { print("hello"); return 0; }';
const BROKEN_PROGRAM = 'fn main() -> int { let x: string = 42; return 0; }';

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'latent-vscode-'));
}

test('runner: compiler.wasm существует (предусловие тестов)', () => {
    assert.ok(fs.existsSync(compilerWasmPath), `нет ${compilerWasmPath}`);
});

test('runner: пути по умолчанию разрешаются от каталога расширения', () => {
    assert.equal(runner.repoRootFor(extensionRoot), repoRoot);
    assert.equal(runner.repoRootFor(''), null);
    assert.equal(runner.resolveCompilerWasmPath({ extensionPath: extensionRoot }), compilerWasmPath);
    assert.equal(runner.resolveCompilerWasmPath({ configuredPath: compilerWasmPath }), compilerWasmPath);
    const latentc = runner.resolveLatentcPath({ extensionPath: extensionRoot });
    assert.match(latentc, /target[\\/](?:debug|release)[\\/]latentc(?:\.exe)?$/u);
    assert.equal(runner.resolveNodePath({ configuredPath: 'C:/node/node.exe' }), 'C:/node/node.exe');
    assert.equal(runner.resolveNodePath(), 'node');
    assert.equal(runner.firstExisting(['', null, path.join(os.tmpdir(), 'definitely-missing'), compilerWasmPath]), compilerWasmPath);
    assert.equal(runner.firstExisting(['only-missing']), 'only-missing');
    assert.equal(runner.firstExisting([]), '');
});

test('runner: instantiateCompiler и версия компилятора', () => {
    const loaded = runner.instantiateCompiler(compilerWasmPath);
    assert.equal(loaded.ok, true);
    for (const name of ['memory', 'latent_alloc', 'latent_compile', 'latent_free']) {
        assert.ok(loaded.exports[name], `нет экспорта ${name}`);
    }
    const version = runner.readCompilerVersion(loaded.exports);
    assert.match(version, /^latent \d+\.\d+\.\d+/u);

    const missing = runner.instantiateCompiler(path.join(os.tmpdir(), 'no-such-compiler.wasm'));
    assert.equal(missing.ok, false);
    assert.match(missing.error, /не найден/u);
    assert.equal(runner.instantiateCompiler('').ok, false);
});

test('runner: компиляция валидной программы через compiler.wasm', () => {
    const result = runner.compileWithWasm(VALID_PROGRAM, compilerWasmPath);
    assert.equal(result.ok, true, result.error);
    assert.ok(Buffer.isBuffer(result.wasm));
    assert.deepEqual([...result.wasm.subarray(0, 4)], WASM_MAGIC);
    assert.equal(WebAssembly.validate(result.wasm), true);
    assert.match(result.version, /^latent /u);
});

test('runner: запуск WASM с env.print и возвратом main', () => {
    const compiled = runner.compileWithWasm(VALID_PROGRAM, compilerWasmPath);
    assert.equal(compiled.ok, true, compiled.error);
    const printed = [];
    const executed = runner.runWasm(compiled.wasm, { print: (line) => printed.push(line) });
    assert.equal(executed.ok, true, executed.error);
    assert.equal(executed.output, 'hello\n');
    assert.equal(executed.result, 0);
    assert.deepEqual(printed, ['hello']);

    const multiple = runner.compileWithWasm('fn main() -> int { print("a", 1); return 0; }', compilerWasmPath);
    assert.equal(multiple.ok, true, multiple.error);
    const multiRun = runner.runWasm(multiple.wasm);
    assert.equal(multiRun.output, 'a\n1\n');
});

test('runner: выражение main считается корректно', () => {
    const compiled = runner.compileWithWasm('fn main() -> int { return 2 + 3 * 4; }', compilerWasmPath);
    assert.equal(compiled.ok, true, compiled.error);
    const executed = runner.runWasm(compiled.wasm);
    assert.equal(executed.ok, true, executed.error);
    assert.equal(executed.result, 14);

    const floatMain = runner.compileWithWasm('fn main() -> float { return 1.5; }', compilerWasmPath);
    assert.equal(floatMain.ok, true, floatMain.error);
    assert.equal(runner.runWasm(floatMain.wasm).result, 1.5);
});

test('runner: compileAndRun объединяет компиляцию и запуск', () => {
    const result = runner.compileAndRun('fn main() -> int { print("x"); return 7; }', {
        compilerWasmPath,
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.output, 'x\n');
    assert.equal(result.result, 7);
    assert.deepEqual(result.diagnostics, []);
});

test('runner: ошибка компиляции содержит позицию «на строке L:C»', () => {
    const compiled = runner.compileWithWasm(BROKEN_PROGRAM, compilerWasmPath);
    assert.equal(compiled.ok, false);
    assert.match(compiled.error, /на строке 1:20/u);

    const diagnostics = runner.parseCompilerDiagnostics(compiled.error);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].line, 1);
    assert.equal(diagnostics[0].column, 20);
    assert.equal(diagnostics[0].hasPosition, true);
    assert.equal(diagnostics[0].severity, 'error');
    assert.match(diagnostics[0].message, /Несовпадение типов/u);

    const fromRun = runner.compileAndRun(BROKEN_PROGRAM, { compilerWasmPath });
    assert.equal(fromRun.ok, false);
    assert.equal(fromRun.diagnostics.length, 1);
    assert.equal(fromRun.diagnostics[0].line, 1);
    assert.equal(fromRun.diagnostics[0].column, 20);
});

test('runner: парсинг позиций и разделение склеенных ошибок', () => {
    assert.deepEqual(runner.parseErrorPosition('Неожиданный символ \'#\' на строке 12:7'), { line: 12, column: 7 });
    assert.deepEqual(runner.parseErrorPosition('на строке 1:1'), { line: 1, column: 1 });
    assert.equal(runner.parseErrorPosition('нет позиции'), null);
    assert.equal(runner.parseErrorPosition('на строке 0:0'), null);
    assert.equal(runner.parseErrorPosition('на строке 1'), null);
    assert.equal(runner.parseErrorPosition(undefined), null);

    const joined = "Несовпадение типов на строке 1:1: ожидалось 'int', найдено 'string'; Неопределённая переменная 'x' на строке 2:3";
    assert.equal(runner.splitCompilerErrors(joined).length, 2);
    assert.equal(runner.splitCompilerErrors('').length, 0);
    assert.equal(runner.splitCompilerErrors('просто ошибка').length, 1);

    const noPosition = runner.parseCompilerDiagnostics('Undefined variable: x');
    assert.equal(noPosition.length, 1);
    assert.equal(noPosition[0].hasPosition, false);
    assert.equal(noPosition[0].line, 1);
    assert.equal(noPosition[0].column, 1);

    const prefixed = runner.parseCompilerDiagnostics('error: Ошибка парсинга на строке 3:4: ожидалось \';\', найдено RBrace');
    assert.equal(prefixed[0].message.startsWith('error:'), false);
    assert.equal(prefixed[0].line, 3);
    assert.equal(prefixed[0].column, 4);
});

test('runner: runtime-ошибка (assert) не роняет процесс', () => {
    const compiled = runner.compileWithWasm('fn main() -> int { assert(1 > 2); return 0; }', compilerWasmPath);
    assert.equal(compiled.ok, true, compiled.error);
    const executed = runner.runWasm(compiled.wasm);
    assert.equal(executed.ok, false);
    assert.match(executed.error, /Ошибка выполнения/u);
});

test('runner: модуль без main и битый WASM', () => {
    const noMain = runner.compileWithWasm('fn foo() -> int { return 1; }', compilerWasmPath);
    assert.equal(noMain.ok, true, noMain.error);
    const executed = runner.runWasm(noMain.wasm);
    assert.equal(executed.ok, false);
    assert.match(executed.error, /не экспортирует main/u);
    assert.match(executed.error, /memory/u);

    const broken = runner.runWasm(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    assert.equal(broken.ok, false);
    assert.match(broken.error, /Некорректный WASM/u);

    const empty = runner.runWasm(Buffer.alloc(0));
    assert.equal(empty.ok, false);
    assert.match(empty.error, /Пустой WASM/u);
});

test('runner: ограничение объёма вывода', () => {
    const compiled = runner.compileWithWasm('fn main() -> int { print("hello"); return 0; }', compilerWasmPath);
    assert.equal(compiled.ok, true, compiled.error);
    const executed = runner.runWasm(compiled.wasm, { maxOutputBytes: 3 });
    assert.equal(executed.ok, true);
    assert.equal(executed.output, '');
    assert.equal(executed.truncated, true);
});

test('runner: compileWithCli — успех через фейковый latentc', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'prog.lat');
        const outPath = path.join(dir, 'prog.wasm');
        fs.writeFileSync(sourcePath, 'fn main() -> int { return 0; }\n', 'utf8');
        const result = runner.compileWithCli(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: process.execPath,
            outPath,
        });
        assert.equal(result.ok, true, result.error);
        assert.ok(fs.existsSync(outPath));
        assert.deepEqual([...result.wasm.subarray(0, 4)], WASM_MAGIC);
        assert.match(result.output, /prog\.lat -> .*prog\.wasm/u);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: compileWithCli — ошибка компиляции с позицией', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'bad.lat');
        const outPath = path.join(dir, 'bad.wasm');
        fs.writeFileSync(sourcePath, 'fn main() -> int {\n    CLI_ERROR\n    return 0;\n}\n', 'utf8');
        const result = runner.compileWithCli(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: process.execPath,
            outPath,
        });
        assert.equal(result.ok, false);
        assert.equal(result.exitCode, 1);
        assert.match(result.error, /на строке 2:5/u);
        assert.match(result.error, /Несовпадение типов/u);
        const diagnostics = runner.parseCompilerDiagnostics(result.error);
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].line, 2);
        assert.equal(diagnostics[0].column, 5);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: compileWithCli — отсутствующий бинарник помечается missing', () => {
    const result = runner.compileWithCli('whatever.lat', {
        latentcPath: path.join(os.tmpdir(), 'definitely-missing-latentc.exe'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.missing, true);
    assert.match(result.error, /не найден/u);

    const noPath = runner.compileWithCli('whatever.lat', {});
    assert.equal(noPath.ok, false);
    assert.equal(noPath.missing, true);
});

test('runner: compileFile предпочитает CLI, иначе compiler.wasm', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'prog.lat');
        fs.writeFileSync(sourcePath, 'fn main() -> int { return 0; }\n', 'utf8');

        const viaCli = runner.compileFile(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: process.execPath,
            outPath: path.join(dir, 'cli-out.wasm'),
            compilerWasmPath,
        });
        assert.equal(viaCli.ok, true, viaCli.error);
        assert.equal(viaCli.engine, 'latentc');
        assert.deepEqual([...viaCli.wasm.subarray(0, 4)], WASM_MAGIC);
        assert.deepEqual(viaCli.diagnostics, []);

        const viaWasm = runner.compileFile(sourcePath, {
            latentcPath: path.join(dir, 'no-latentc.exe'),
            compilerWasmPath,
        });
        assert.equal(viaWasm.ok, true, viaWasm.error);
        assert.equal(viaWasm.engine, 'wasm');
        assert.equal(viaWasm.compilerWasmPath, compilerWasmPath);

        const missingFile = runner.compileFile(path.join(dir, 'absent.lat'), { compilerWasmPath });
        assert.equal(missingFile.ok, false);
        assert.match(missingFile.error, /Не удалось прочитать/u);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: compileFile с CLI-ошибкой не подменяется wasm-результатом', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'bad.lat');
        fs.writeFileSync(sourcePath, 'CLI_ERROR\n', 'utf8');
        const result = runner.compileFile(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: process.execPath,
            outPath: path.join(dir, 'bad.wasm'),
            compilerWasmPath,
        });
        assert.equal(result.ok, false);
        assert.equal(result.engine, 'latentc');
        assert.equal(result.diagnostics.length, 1);
        assert.equal(result.diagnostics[0].line, 2);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: путь и запись .wasm', () => {
    assert.equal(runner.wasmOutputPath('C:/work/prog.lat'), 'C:/work/prog.wasm');
    assert.equal(runner.wasmOutputPath('C:/work/prog.LAT'), 'C:/work/prog.wasm');
    assert.equal(runner.wasmOutputPath('C:/work/prog'), 'C:/work/prog.wasm');

    const dir = tempDir();
    try {
        const target = path.join(dir, 'out.wasm');
        runner.writeWasmFile(target, Buffer.from(WASM_MAGIC));
        assert.deepEqual([...fs.readFileSync(target)], WASM_MAGIC);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: edge cases парсинга и запуска', () => {
    assert.equal(runner.parseErrorPosition('на строке 0:5'), null);
    assert.equal(runner.splitCompilerErrors(null).length, 0);
    assert.equal(runner.splitCompilerErrors(42).length, 0);

    const onlyPosition = runner.parseCompilerDiagnostics('на строке 1:1');
    assert.equal(onlyPosition.length, 1);
    assert.equal(onlyPosition[0].hasPosition, true);
    assert.equal(onlyPosition[0].message, 'на строке 1:1');

    const compiled = runner.compileWithWasm('fn main() -> int { print("hello"); return 0; }', compilerWasmPath);
    assert.equal(compiled.ok, true, compiled.error);
    const arrayBuffer = compiled.wasm.buffer.slice(
        compiled.wasm.byteOffset,
        compiled.wasm.byteOffset + compiled.wasm.byteLength,
    );
    assert.equal(runner.runWasm(arrayBuffer).output, 'hello\n');

    const voidMain = runner.compileWithWasm('fn main() { print("v"); }', compilerWasmPath);
    assert.equal(voidMain.ok, true, voidMain.error);
    const voidRun = runner.runWasm(voidMain.wasm);
    assert.equal(voidRun.ok, true, voidRun.error);
    assert.equal(voidRun.output, 'v\n');
    assert.equal(voidRun.result, undefined);
});

test('runner: несовместимый ABI и битый файл compiler.wasm', () => {
    const dir = tempDir();
    try {
        const name = Buffer.from('memory');
        const wasmWithMemoryOnly = Buffer.from([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
            0x05, 0x03, 0x01, 0x00, 0x01,
            0x07, 0x0a, 0x01, name.length, ...name, 0x02, 0x00,
        ]);
        const wasmPath = path.join(dir, 'memory-only.wasm');
        fs.writeFileSync(wasmPath, wasmWithMemoryOnly);
        const loaded = runner.instantiateCompiler(wasmPath);
        assert.equal(loaded.ok, true);
        assert.ok(loaded.exports.memory);
        const compiled = runner.compileWithWasm('fn main() {}', wasmPath);
        assert.equal(compiled.ok, false);
        assert.match(compiled.error, /не экспортирует latent_compile/u);

        const textPath = path.join(dir, 'not-wasm.wasm');
        fs.writeFileSync(textPath, 'это не wasm');
        const broken = runner.instantiateCompiler(textPath);
        assert.equal(broken.ok, false);
        assert.match(broken.error, /Не удалось загрузить compiler\.wasm/u);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: readCompilerVersion устойчив к битым экспортам', () => {
    assert.equal(runner.readCompilerVersion(null), '');
    assert.equal(runner.readCompilerVersion({}), '');
    assert.equal(runner.readCompilerVersion({
        latent_version: () => 0,
        memory: { buffer: new ArrayBuffer(0) },
    }), '');
});

test('runner: firstExisting пропускает недоступные пути', () => {
    const original = fs.existsSync;
    fs.existsSync = (candidate) => {
        if (String(candidate).includes('throw-me')) throw new Error('boom');
        return original(candidate);
    };
    try {
        assert.equal(runner.firstExisting(['throw-me', compilerWasmPath]), compilerWasmPath);
    } finally {
        fs.existsSync = original;
    }
});

test('runner: compileWithCli с несуществующим nodePath помечается missing', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'prog.lat');
        fs.writeFileSync(sourcePath, 'fn main() -> int { return 0; }\n', 'utf8');
        const result = runner.compileWithCli(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: path.join(os.tmpdir(), 'definitely-missing-node.exe'),
            outPath: path.join(dir, 'prog.wasm'),
        });
        assert.equal(result.ok, false);
        assert.equal(result.missing, true);
        assert.match(result.error, /не найден/u);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: compileWithCli — CLI не создал файл и битый outPath', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'no-output.lat');
        fs.writeFileSync(sourcePath, 'NO_OUTPUT\n', 'utf8');

        const notCreated = runner.compileWithCli(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: process.execPath,
            outPath: path.join(dir, 'absent.wasm'),
        });
        assert.equal(notCreated.ok, false);
        assert.match(notCreated.error, /не создал файл/u);
        assert.match(notCreated.output, /файл не создан/u);

        // outPath существует, но это каталог: чтение падает.
        const outDir = path.join(dir, 'out-as-dir');
        fs.mkdirSync(outDir);
        const unreadable = runner.compileWithCli(sourcePath, {
            latentcPath: fakeLatentcPath,
            nodePath: process.execPath,
            outPath: outDir,
        });
        assert.equal(unreadable.ok, false);
        assert.match(unreadable.error, /Не удалось прочитать/u);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('runner: ошибки fs.existsSync обрабатываются', () => {
    const original = fs.existsSync;
    fs.existsSync = () => { throw new Error('EACCES'); };
    try {
        const cli = runner.compileWithCli('whatever.lat', { latentcPath: 'C:/secret/latentc.exe' });
        assert.equal(cli.ok, false);
        assert.equal(cli.missing, true);
        assert.match(cli.error, /недоступен/u);

        const file = runner.compileFile('whatever.lat', {
            latentcPath: 'C:/secret/latentc.exe',
            source: 'fn main() {}',
        });
        // existsSync бросает и для compiler.wasm — компиляция недоступна, но без исключения.
        assert.equal(file.ok, false);
    } finally {
        fs.existsSync = original;
    }
});

test('runner: compileFile и compileAndRun находят compiler.wasm от extensionPath', () => {
    const dir = tempDir();
    try {
        const sourcePath = path.join(dir, 'prog.lat');
        fs.writeFileSync(sourcePath, 'fn main() -> int { return 3; }\n', 'utf8');
        const file = runner.compileFile(sourcePath, {
            extensionPath: extensionRoot,
            preferCli: false,
        });
        assert.equal(file.ok, true, file.error);
        assert.equal(file.compilerWasmPath, compilerWasmPath);
        assert.equal(runner.runWasm(file.wasm).result, 3);

        const ran = runner.compileAndRun('fn main() -> int { return 4; }', {
            extensionPath: extensionRoot,
        });
        assert.equal(ran.ok, true, ran.error);
        assert.equal(ran.result, 4);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
