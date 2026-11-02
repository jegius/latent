// check-code.test.mjs — тесты инструмента check_code на настоящем compiler.wasm.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_CODE_BYTES, CompilerUnavailableError, createCompiler, parseErrors } from '../src/compiler.mjs';
import { REAL_WASM, callTool, createFixtureCore, toolData } from './helpers.mjs';
import fs from 'node:fs';

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
