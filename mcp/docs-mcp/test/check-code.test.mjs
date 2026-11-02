// check-code.test.mjs — тесты инструмента check_code на настоящем compiler.wasm.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_CODE_BYTES, CompilerUnavailableError, createCompiler, parseErrors } from '../src/compiler.mjs';
import { REAL_WASM, callTool, createFixtureCore, toolData } from './helpers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hasCompiler = fs.existsSync(REAL_WASM);

test('check_code: валидный код компилируется', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', {
        code: 'fn square(x: int) -> int {\n    return x * x;\n}\n\nfn main() -> int {\n    return square(7);\n}',
    });
    const data = toolData(response);

    assert.deepEqual(data, { ok: true, errors: [] });
    assert.match(response.result.content[0].text, /успешна/);
});

test('check_code: программа с print компилируется (env.print в WASM)', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', {
        code: 'fn main() -> int {\n    print("hello", 42);\n    return 0;\n}',
    });
    assert.equal(toolData(response).ok, true);
});

test('check_code: битый код даёт ошибку со строкой и колонкой', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', { code: 'fn main() { let x = ; }' });
    const data = toolData(response);

    assert.equal(data.ok, false);
    assert.equal(data.errors.length, 1);
    const [error] = data.errors;
    assert.equal(error.line, 1);
    assert.equal(typeof error.column, 'number');
    assert.ok(error.column > 0);
    assert.match(error.message, /на строке 1:\d+/);
    assert.match(response.result.content[0].text, /Компиляция не удалась/);
});

test('check_code: лексическая ошибка', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', { code: 'fn main() {\n    #\n}' });
    const data = toolData(response);

    assert.equal(data.ok, false);
    assert.equal(data.errors[0].line, 2);
    assert.match(data.errors[0].message, /Неожиданный символ/);
});

test('check_code: ошибка типизации', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', {
        code: 'fn main() -> int {\n    let x: int = "строка";\n    return x;\n}',
    });
    const data = toolData(response);

    assert.equal(data.ok, false);
    assert.ok(data.errors.length >= 1);
    assert.match(data.errors[0].message, /Несовпадение типов|Ожидалось|ожидалось/);
});

test('check_code: пустой код — ошибка аргументов', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', { code: '   ' });
    assert.equal(response.error.code, -32602);
});

test('check_code: отсутствующий compiler.wasm — isError с подсказкой', async () => {
    const missingWasm = 'C:/definitely/no/such/dir/compiler.wasm';
    const core = createFixtureCore({ wasmPath: missingWasm });
    const response = await callTool(core, 'check_code', { code: 'fn main() -> int { return 1; }' });

    assert.equal(response.result.isError, true);
    const text = response.result.content[0].text;
    assert.match(text, /Компилятор Latent не найден/);
    assert.match(text, /--wasm/);
});

test('check_code: слишком большой исходник отклоняется', async () => {
    const core = createFixtureCore();
    const code = `// ${'x'.repeat(MAX_CODE_BYTES)}\nfn main() -> int { return 0; }`;
    const response = await callTool(core, 'check_code', { code });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /слишком большой/);
});

test('parseErrors разбирает несколько склеенных сообщений', () => {
    const errors = parseErrors(
        'Неопределённая переменная \'a\' на строке 2:5; Неопределённая переменная \'b\' на строке 3:9',
    );
    assert.equal(errors.length, 2);
    assert.deepEqual(errors.map((error) => [error.line, error.column]), [[2, 5], [3, 9]]);
    assert.match(errors[0].message, /'a'/);
    assert.match(errors[1].message, /'b'/);
});

test('parseErrors: сообщение без локации не теряется', () => {
    const errors = parseErrors('Неожиданный конец файла: ожидалось \'}\'');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].line, null);
    assert.equal(errors[0].column, null);
    assert.match(errors[0].message, /конец файла/);
});

test('parseErrors: пустое сообщение превращается в понятную диагностику', () => {
    const errors = parseErrors('');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /без текста/);
});

test('createCompiler: check возвращает контрактную структуру', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const compiler = createCompiler({ wasmPath: REAL_WASM });
    const result = await compiler.check('fn main() -> int { return 1; }');
    assert.deepEqual(result, { ok: true, errors: [] });
    assert.equal(typeof await compiler.version(), 'string');
});

test('createCompiler: отсутствие файла — CompilerUnavailableError', async () => {
    const compiler = createCompiler({ wasmPath: 'C:/nope/compiler.wasm' });
    await assert.rejects(() => compiler.check('fn main() {}'), (error) => error instanceof CompilerUnavailableError);
});

// --- ABI-границы на синтетических WASM-модулях ------------------------------
//
// Настоящий compiler.wasm не умеет отдавать нулевые указатели и падать в
// latent_free, поэтому эти защитные ветви проверяются на минимальных
// синтетических модулях с тем же C-ABI (latent_alloc/latent_compile/memory).

/** Кодирует беззнаковое LEB128. @param {number} value */
function uleb(value) {
    const bytes = [];
    let n = value >>> 0;
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n) byte |= 0x80;
        bytes.push(byte);
    } while (n);
    return bytes;
}

/** Кодирует знаковое LEB128. @param {number} value */
function sleb(value) {
    const bytes = [];
    let n = value | 0;
    for (;;) {
        let byte = n & 0x7f;
        n >>= 7;
        const done = (n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0);
        bytes.push(done ? byte : (byte | 0x80));
        if (done) return bytes;
    }
}

const wasmSection = (id, payload) => [id, ...uleb(payload.length), ...payload];
const wasmVec = (items) => [...uleb(items.length), ...items.flat()];
const wasmName = (text) => {
    const bytes = [...Buffer.from(text, 'utf8')];
    return [...uleb(bytes.length), ...bytes];
};
const I32 = 0x7f;
const TYPE_II = [0x60, 0x02, I32, I32, 0x01, I32];
const TYPE_I = [0x60, 0x01, I32, 0x01, I32];
const TYPE_VOID = [0x60, 0x00, 0x00];

/**
 * Собирает минимальный WASM-модуль с C-ABI компилятора.
 * @param {{alloc?: number|null, compile?: number|null, includeAlloc?: boolean, includeCompile?: boolean,
 *          includeFree?: boolean, freeThrows?: boolean, includeVersion?: boolean, versionThrows?: boolean,
 *          includeMemory?: boolean, pages?: number, data?: {offset: number, bytes: number[]}[],
 *          imports?: string[]}} [options]
 * @returns {Buffer}
 */
function buildFakeWasm(options = {}) {
    const {
        alloc = 1024,
        compile = 2048,
        includeAlloc = true,
        includeCompile = true,
        includeFree = true,
        freeThrows = true,
        includeVersion = false,
        versionThrows = false,
        includeMemory = true,
        pages = 1,
        data = [],
        imports = [],
    } = options;

    const funcTypes = [];
    const exports = [];
    const bodies = [];
    const addFunction = (name, type, body) => {
        funcTypes.push(type === 'II' ? 0 : 1);
        exports.push([...wasmName(name), 0x00, imports.length + funcTypes.length - 1]);
        bodies.push([0x00, ...body]);
    };

    if (includeAlloc) addFunction('latent_alloc', 'I', [0x41, ...sleb(alloc), 0x0b]);
    if (includeCompile) {
        const calls = imports.flatMap((_, index) => [0x10, ...uleb(index)]);
        addFunction('latent_compile', 'II', [...calls, 0x41, ...sleb(compile), 0x0b]);
    }
    if (includeFree) addFunction('latent_free', 'I', freeThrows ? [0x00, 0x0b] : [0x41, ...sleb(0), 0x0b]);
    if (includeVersion) addFunction('latent_version', 'I', versionThrows ? [0x00, 0x0b] : [0x41, ...sleb(3000), 0x0b]);

    const sections = [wasmSection(1, wasmVec([TYPE_II, TYPE_I, TYPE_VOID]))];
    if (imports.length > 0) {
        sections.push(wasmSection(2, wasmVec(imports.map((field) => [
            ...wasmName('env'), ...wasmName(field), 0x00, 0x02,
        ]))));
    }
    sections.push(wasmSection(3, wasmVec(funcTypes.map((index) => [index]))));
    if (includeMemory) sections.push(wasmSection(5, wasmVec([[0x00, ...uleb(pages)]])));
    const exportEntries = exports.slice();
    if (includeMemory) exportEntries.unshift([...wasmName('memory'), 0x02, 0x00]);
    sections.push(wasmSection(7, wasmVec(exportEntries)));
    sections.push(wasmSection(10, wasmVec(bodies.map((body) => [...uleb(body.length), ...body]))));
    if (data.length > 0 && includeMemory) {
        sections.push(wasmSection(11, wasmVec(data.map(({ offset, bytes }) => [
            0x00, 0x41, ...sleb(offset), 0x0b, ...uleb(bytes.length), ...bytes,
        ]))));
    }
    return Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);
}

/**
 * Складывает struct {status:u32, length:u32, payload} по смещению 2048.
 * @param {number} status
 * @param {string} text
 * @returns {number[]}
 */
function resultStruct(status, text) {
    const payload = [...Buffer.from(text, 'utf8')];
    return [
        status & 0xff, (status >> 8) & 0xff, 0, 0,
        payload.length & 0xff, (payload.length >> 8) & 0xff, 0, 0,
        ...payload,
    ];
}

/**
 * Пишет синтетический wasm во временный каталог.
 * @param {Buffer} bytes
 * @returns {{dir: string, wasmPath: string}}
 */
function writeFakeWasm(bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-compiler-'));
    const wasmPath = path.join(dir, 'compiler.wasm');
    fs.writeFileSync(wasmPath, bytes);
    return { dir, wasmPath };
}

test('compiler: синтетический ABI — успех и ошибка со строкой/колонкой', async () => {
    const ok = writeFakeWasm(buildFakeWasm({ data: [{ offset: 2048, bytes: resultStruct(1, '') }] }));
    try {
        const compiler = createCompiler({ wasmPath: ok.wasmPath });
        assert.deepEqual(await compiler.check('fn main() {}'), { ok: true, errors: [] });
        assert.equal(await compiler.version(), 'latent-wasm', 'без latent_version — запасное имя');
    } finally {
        fs.rmSync(ok.dir, { recursive: true, force: true });
    }

    const fail = writeFakeWasm(buildFakeWasm({
        data: [{ offset: 2048, bytes: resultStruct(0, 'Несовпадение типов на строке 3:9') }],
    }));
    try {
        const result = await createCompiler({ wasmPath: fail.wasmPath }).check('bad');
        assert.equal(result.ok, false);
        assert.deepEqual(result.errors, [{
            message: 'Несовпадение типов на строке 3:9',
            line: 3,
            column: 9,
        }]);
    } finally {
        fs.rmSync(fail.dir, { recursive: true, force: true });
    }
});

test('compiler: host-импорты env.print* инстанцируются и вызываются без ошибок', async () => {
    const fake = writeFakeWasm(buildFakeWasm({
        imports: ['print', 'print_str', 'print_i32', 'print_f64', 'print_bool'],
        data: [{ offset: 2048, bytes: resultStruct(1, '') }],
    }));
    try {
        const result = await createCompiler({ wasmPath: fake.wasmPath }).check('fn main() {}');
        assert.deepEqual(result, { ok: true, errors: [] }, 'заглушки env.* должны принимать вызовы компилятора');
    } finally {
        fs.rmSync(fake.dir, { recursive: true, force: true });
    }
});

test('compiler: нулевой указатель alloc/compile и падение latent_free', async () => {
    const cases = [
        { options: { alloc: 0 }, pattern: /нулевой указатель/ },
        { options: { compile: 0 }, pattern: /нулевой указатель результата/ },
    ];
    for (const { options, pattern } of cases) {
        const fake = writeFakeWasm(buildFakeWasm(options));
        try {
            await assert.rejects(
                () => createCompiler({ wasmPath: fake.wasmPath }).check('code'),
                (error) => error instanceof CompilerUnavailableError && pattern.test(error.message),
            );
        } finally {
            fs.rmSync(fake.dir, { recursive: true, force: true });
        }
    }

    // latent_free бросает (unreachable), но это не должно ломать результат.
    const freeFails = writeFakeWasm(buildFakeWasm({
        freeThrows: true,
        data: [{ offset: 2048, bytes: resultStruct(1, '') }],
    }));
    try {
        const result = await createCompiler({ wasmPath: freeFails.wasmPath }).check('code');
        assert.deepEqual(result, { ok: true, errors: [] });
    } finally {
        fs.rmSync(freeFails.dir, { recursive: true, force: true });
    }

    // latent_free отсутствует — код просто не вызывает освобождение.
    const noFree = writeFakeWasm(buildFakeWasm({
        includeFree: false,
        data: [{ offset: 2048, bytes: resultStruct(1, '') }],
    }));
    try {
        assert.deepEqual(await createCompiler({ wasmPath: noFree.wasmPath }).check('code'), { ok: true, errors: [] });
    } finally {
        fs.rmSync(noFree.dir, { recursive: true, force: true });
    }
});

test('compiler: код больше памяти модуля — понятная ошибка выделения', async () => {
    const fake = writeFakeWasm(buildFakeWasm({ pages: 1, alloc: 1024 }));
    try {
        const compiler = createCompiler({ wasmPath: fake.wasmPath });
        await assert.rejects(
            () => compiler.check('x'.repeat(70 * 1024)),
            (error) => error instanceof CompilerUnavailableError && /Ошибка выделения памяти/.test(error.message),
        );
    } finally {
        fs.rmSync(fake.dir, { recursive: true, force: true });
    }
});

test('compiler: модуль без нужных экспортов и битые байты отклоняются', async () => {
    const noCompile = writeFakeWasm(buildFakeWasm({ includeCompile: false, includeAlloc: false }));
    try {
        await assert.rejects(
            () => createCompiler({ wasmPath: noCompile.wasmPath }).check('x'),
            (error) => error instanceof CompilerUnavailableError && /не является компилятором Latent/.test(error.message),
        );
    } finally {
        fs.rmSync(noCompile.dir, { recursive: true, force: true });
    }

    const noMemory = writeFakeWasm(buildFakeWasm({ includeMemory: false }));
    try {
        await assert.rejects(
            () => createCompiler({ wasmPath: noMemory.wasmPath }).check('x'),
            (error) => error instanceof CompilerUnavailableError && /нет экспортов latent_compile\/memory/.test(error.message),
        );
    } finally {
        fs.rmSync(noMemory.dir, { recursive: true, force: true });
    }

    const broken = writeFakeWasm(Buffer.from('definitely not wasm'));
    try {
        await assert.rejects(
            () => createCompiler({ wasmPath: broken.wasmPath }).check('x'),
            (error) => error instanceof CompilerUnavailableError && /Не удалось загрузить WASM-компилятор/.test(error.message),
        );
    } finally {
        fs.rmSync(broken.dir, { recursive: true, force: true });
    }
});

test('compiler: путь-каталог и не-строковый код обрабатываются без падения', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-compiler-dir-'));
    try {
        await assert.rejects(
            () => createCompiler({ wasmPath: dir }).check('x'),
            (error) => error instanceof CompilerUnavailableError && /Компилятор Latent не найден/.test(error.message),
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    const fake = writeFakeWasm(buildFakeWasm({ data: [{ offset: 2048, bytes: resultStruct(1, '') }] }));
    try {
        const compiler = createCompiler({ wasmPath: fake.wasmPath });
        for (const code of [null, 42, {}, [], undefined]) {
            assert.deepEqual(await compiler.check(code), { ok: true, errors: [] }, `код ${JSON.stringify(code)}`);
        }
    } finally {
        fs.rmSync(fake.dir, { recursive: true, force: true });
    }
});

test('compiler: version возвращает строку и переживает падение latent_version', async () => {
    const throwsVersion = writeFakeWasm(buildFakeWasm({ includeVersion: true, versionThrows: true }));
    try {
        assert.equal(await createCompiler({ wasmPath: throwsVersion.wasmPath }).version(), 'latent-wasm');
    } finally {
        fs.rmSync(throwsVersion.dir, { recursive: true, force: true });
    }

    const emptyVersion = writeFakeWasm(buildFakeWasm({ includeVersion: true }));
    try {
        assert.equal(await createCompiler({ wasmPath: emptyVersion.wasmPath }).version(), '');
    } finally {
        fs.rmSync(emptyVersion.dir, { recursive: true, force: true });
    }
});

test('compiler: лимит MAX_CODE_BYTES проверяется по границе', async () => {
    const fake = writeFakeWasm(buildFakeWasm({
        pages: 8,
        alloc: 1024,
        compile: 160000,
        data: [{ offset: 160000, bytes: resultStruct(1, '') }],
    }));
    try {
        const compiler = createCompiler({ wasmPath: fake.wasmPath });
        assert.deepEqual(await compiler.check('x'.repeat(MAX_CODE_BYTES)), { ok: true, errors: [] });
        await assert.rejects(
            () => compiler.check('x'.repeat(MAX_CODE_BYTES + 1)),
            (error) => error instanceof CompilerUnavailableError && /слишком большой/.test(error.message),
        );
    } finally {
        fs.rmSync(fake.dir, { recursive: true, force: true });
    }
});

test('compiler: не-Error исключения при чтении и инстанцировании не теряются', async () => {
    const originalRead = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
        if (String(file).endsWith('compiler.wasm')) throw 'нет доступа к файлу';
        return originalRead.call(this, file, ...rest);
    };
    try {
        await assert.rejects(
            () => createCompiler({ wasmPath: 'C:/fake/compiler.wasm' }).check('x'),
            (error) => error instanceof CompilerUnavailableError && /нет доступа к файлу/.test(error.message),
        );
    } finally {
        fs.readFileSync = originalRead;
    }

    const fake = writeFakeWasm(buildFakeWasm({}));
    const originalInstantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = async () => { throw 'битые байты'; };
    try {
        await assert.rejects(
            () => createCompiler({ wasmPath: fake.wasmPath }).check('x'),
            (error) => error instanceof CompilerUnavailableError && /битые байты/.test(error.message),
        );
    } finally {
        WebAssembly.instantiate = originalInstantiate;
        fs.rmSync(fake.dir, { recursive: true, force: true });
    }
});

test('parseErrors: не-строка и строка без локации', () => {
    for (const raw of [null, undefined, 42, {}]) {
        const errors = parseErrors(raw);
        assert.equal(errors.length, 1);
        assert.match(errors[0].message, /без текста/);
        assert.equal(errors[0].line, null);
    }
});

test('check_code: пустой код и комментарии компилируются без ошибок', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const compiler = createCompiler({ wasmPath: REAL_WASM });
    assert.deepEqual(await compiler.check(''), { ok: true, errors: [] });
    assert.deepEqual(await compiler.check('// только комментарий\n'), { ok: true, errors: [] });
    assert.deepEqual(await compiler.check('fn main() -> int { let s = "привет"; return 0; }'), { ok: true, errors: [] });
});

test('check_code: BOM в начале исходника поддерживается (BOM-safe лексер)', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    // Регрессия: компилятор теперь BOM-safe (как и CLI): UTF-8 BOM в начале
    // файла не считается лексической ошибкой, программа компилируется.
    const compiler = createCompiler({ wasmPath: REAL_WASM });
    const result = await compiler.check('\uFEFFfn main() -> int { return 1; }');
    assert.deepEqual(result, { ok: true, errors: [] });
});

test('check_code: незавершённая строка — лексическая ошибка', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const compiler = createCompiler({ wasmPath: REAL_WASM });
    const result = await compiler.check('fn main() { let s = "незакрытая; }');
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].line, 1);
    assert.match(result.errors[0].message, /Незавершённая строка/);
});

test('check_code: ошибка парсинга без локации сохраняет сообщение', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const compiler = createCompiler({ wasmPath: REAL_WASM });
    const result = await compiler.check('fn main() -> int { return 1;');
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].line, null);
    assert.match(result.errors[0].message, /ожидалось '}'/);
});

test('check_code: несовпадение арности — ошибка типизации', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', {
        code: 'fn f(x: int) -> int { return x; }\nfn main() -> int { return f(); }',
    });
    const data = toolData(response);
    assert.equal(data.ok, false);
    assert.equal(data.errors[0].line, 2);
    assert.match(data.errors[0].message, /арности/);
    assert.match(response.result.content[0].text, /строка 2:/);
});

test('check_code: неподдерживаемый движком builtin — ошибка кодогенерации без локации', { skip: !hasCompiler && 'compiler.wasm отсутствует' }, async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'check_code', {
        code: 'fn main() -> int { let ch = channel(); return 0; }',
    });
    const data = toolData(response);
    assert.equal(data.ok, false);
    assert.equal(data.errors[0].line, null);
    assert.match(data.errors[0].message, /не поддерживается движком №2/);
    assert.match(response.result.content[0].text, /без локации/);
});
