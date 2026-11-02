// tooling/latent-lsp/test/diagnostics.test.mjs — диагностика через compiler.wasm:
// валидный код → пусто, битый → ошибка с диапазоном строки, graceful без wasm.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDiagnostics,
    FALLBACK_CODE,
    messageRange,
    parseCompilerError,
    splitMessages,
} from '../src/diagnostics.mjs';
import { WasmCompiler } from '../src/wasm-compiler.mjs';
import { COMPILER_WASM, languageData } from './helpers.mjs';

const compiler = await WasmCompiler.load(COMPILER_WASM);
const VALID = 'fn main() -> int {\n    let x = 1;\n    return x;\n}\n';

test.before(() => {
    assert.ok(compiler, 'нужен web-ide/compiler.wasm — проверьте артефакт');
});

test('валидный код → пустая диагностика', () => {
    assert.deepEqual(buildDiagnostics(compiler, VALID, languageData()), []);
});

test('битый код → одна ошибка с диапазоном на строке ошибки', () => {
    const broken = 'fn main() {\n    let x = ;\n}\n';
    const diagnostics = buildDiagnostics(compiler, broken, languageData());
    assert.equal(diagnostics.length, 1);
    const [diagnostic] = diagnostics;
    assert.equal(diagnostic.severity, 1, 'severity = Error');
    assert.equal(diagnostic.source, 'latent');
    assert.equal(diagnostic.code, 'PARSE_UNEXPECTED_TOKEN');
    assert.match(diagnostic.message, /на строке 2:\d+/);
    assert.equal(diagnostic.range.start.line, 1, '1-based 2 → 0-based 1');
    assert.ok(diagnostic.range.start.character > 0);
    assert.ok(diagnostic.range.end.character >= diagnostic.range.start.character);
});

test('лексическая ошибка → код LEX_UNEXPECTED_CHAR', () => {
    const diagnostics = buildDiagnostics(compiler, 'fn main() { # }\n', languageData());
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, 'LEX_UNEXPECTED_CHAR');
    assert.equal(diagnostics[0].range.start.line, 0);
});

test('несколько ошибок тайпчекера склеены через "; " и разбираются по отдельности', () => {
    // Ошибки собираются по top-level инструкциям (внутри функции check останавливается
    // на первой ошибке), поэтому берём две независимые верхнеуровневые инструкции.
    const broken = 'let a: string = 42;\nlet b: bool = "x";\nfn main() -> int {\n    return 0;\n}\n';
    const diagnostics = buildDiagnostics(compiler, broken, languageData());
    assert.ok(diagnostics.length >= 2, `ожидалось ≥2 диагностик, получено ${diagnostics.length}`);
    for (const diagnostic of diagnostics) {
        assert.equal(diagnostic.code, 'TYPE_MISMATCH');
        assert.match(diagnostic.message, /Несовпадение типов/);
    }
    const lines = diagnostics.map((d) => d.range.start.line).sort();
    assert.deepEqual(lines, [0, 1]);
});

test('ошибка host-only builtin без позиции → диагностика на первой строке', () => {
    const source = 'fn main() -> int {\n    let t = tensor([[1]]);\n    return 0;\n}\n';
    const diagnostics = buildDiagnostics(compiler, source, languageData());
    const host = diagnostics.find((d) => d.code === 'GEN_HOST_BUILTIN');
    assert.ok(host, 'ожидалась диагностика GEN_HOST_BUILTIN');
    assert.equal(host.range.start.line, 0);
    assert.equal(host.range.start.character, 0);
});

test('без компилятора диагностика пустая (graceful degradation)', () => {
    assert.deepEqual(buildDiagnostics(null, 'fn main() { # }', languageData()), []);
});

test('неизвестный текст ошибки → fallback-код', () => {
    const diagnostics = parseCompilerError('Какая-то новая ошибка компилятора', VALID, languageData());
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, FALLBACK_CODE);
});

test('splitMessages делит только склеенные сообщения', () => {
    assert.deepEqual(splitMessages('одна ошибка'), ['одна ошибка']);
    assert.deepEqual(
        splitMessages('Несовпадение типов на строке 2:5: a; Несовпадение типов на строке 3:5: b'),
        ['Несовпадение типов на строке 2:5: a', 'Несовпадение типов на строке 3:5: b']);
    assert.deepEqual(splitMessages(''), []);
});

test('messageRange: 1-based → 0-based, кламп в границы строки', () => {
    const text = 'let x = 1;\nreturn x;\n';
    const range = messageRange('Неожиданный символ \'#\' на строке 2:5', text);
    assert.deepEqual(range.start, { line: 1, character: 4 });
    assert.deepEqual(range.end, { line: 1, character: 5 });

    // Позиция за пределами строки клампится в её конец.
    const clamped = messageRange('... на строке 1:500', text);
    assert.equal(clamped.start.line, 0);
    assert.equal(clamped.start.character, 'let x = 1;'.length);

    // Строка за пределами файла клампится в последнюю строку (включая пустую
    // после завершающего перевода строки).
    const beyond = messageRange('... на строке 99:1', text);
    assert.equal(beyond.start.line, 2);
});
