// tooling/latent-lsp/test/formatter.test.mjs — форматирование: 1:1 с web-ide и
// идемпотентность на реальных примерах языка.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { formatLatent } from '../src/formatter.mjs';
// Эталонная реализация из web IDE — только читаем, чтобы зафиксировать паритет.
import { formatLatent as formatLatentReference } from '../../../web-ide/services/formatter-service.js';
import { REPO_ROOT } from './helpers.mjs';

const EXAMPLES_DIR = path.join(REPO_ROOT, 'web-ide/examples');

/** @returns {Array<{name: string, source: string}>} */
function loadExamples() {
    const files = fs.readdirSync(EXAMPLES_DIR)
        .filter((f) => f.endsWith('.lat'))
        .sort();
    return files.map((name) => ({
        name,
        source: fs.readFileSync(path.join(EXAMPLES_DIR, name), 'utf8'),
    }));
}

test('форматирование совпадает с web-ide/services/formatter-service.js на всех примерах', () => {
    const examples = loadExamples();
    assert.ok(examples.length >= 10, 'ожидается набор примеров из web-ide');
    for (const example of examples) {
        assert.equal(
            formatLatent(example.source),
            formatLatentReference(example.source),
            `расхождение форматирования: ${example.name}`);
    }
});

test('идемпотентность: format(format(x)) === format(x) на 3+ примерах', () => {
    const examples = loadExamples().slice(0, 8);
    assert.ok(examples.length >= 3);
    for (const example of examples) {
        const once = formatLatent(example.source);
        const twice = formatLatent(once);
        assert.equal(twice, once, `не идемпотентно: ${example.name}`);
    }
});

test('идемпотентность на специально кривом вводе', () => {
    const sources = [
        'fn main() {\nlet x=1;\nif(x>0){\nreturn x;\n}\n}\n',
        'class  P{ x:int ; fn init(x){ this.x=x; }}\n',
        'let a=[1,2 ,3];\nlet b=a[0]+  1;\n',
        '// comment\nfn f( a,b )->int{return a+b;}\n',
        'let s="a  b"; // double  spaces inside are kept\n',
    ];
    for (const source of sources) {
        const once = formatLatent(source);
        assert.equal(formatLatent(once), once);
    }
});

test('ожидаемый вывод для однострочного кода', () => {
    // Порт web-ide сохраняет разбиение на строки и нормализует пробелы.
    assert.equal(
        formatLatent('fn main(){let x=1;return x;}\n'),
        'fn main() {let x = 1;return x;}\n');
});

test('отступы: вложенные блоки — 4 пробела на уровень', () => {
    const result = formatLatent('fn main() {\nlet x = 1;\nif (x > 0) {\nreturn x;\n}\n}\n');
    const lines = result.split('\n');
    assert.equal(lines[0], 'fn main() {');
    assert.equal(lines[1], '    let x = 1;');
    assert.equal(lines[2], '    if (x > 0) {');
    assert.equal(lines[3], '        return x;');
    assert.equal(lines[4], '    }');
    assert.equal(lines[5], '}');
});

test('пробелы вокруг бинарных операторов и после запятых', () => {
    const result = formatLatent('let x=a+b*c;\nlet y=foo(1,2);\nlet z=-a;\n');
    assert.match(result, /let x = a \+ b \* c;/);
    assert.match(result, /let y = foo\(1, 2\);/);
    assert.match(result, /let z = -a;/, 'унарный минус не должен обрастать пробелом');
});

test('содержимое строк и комментариев не трогается', () => {
    const result = formatLatent('let s="a  b  c";\n// keep   spaces\nlet t=1;\n');
    assert.ok(result.includes('"a  b  c"'), result);
    assert.ok(result.includes('// keep   spaces'), result);
});

test('CRLF нормализуется в LF; пустой ввод → пустая строка', () => {
    assert.equal(formatLatent('fn a() {}\r\n'), 'fn a() {}\n');
    assert.equal(formatLatent(''), '');
    assert.equal(formatLatent(undefined), '');
});
