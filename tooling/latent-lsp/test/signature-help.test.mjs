// tooling/latent-lsp/test/signature-help.test.mjs — подсказка сигнатуры и
// активного параметра при вызове.

import test from 'node:test';
import assert from 'node:assert/strict';

import { provideSignatureHelp } from '../src/signature-help.mjs';
import { languageData } from './helpers.mjs';

/**
 * Signature help в конце текста (курсор — за последним символом).
 * @param {string} text
 */
function helpAt(text) {
    return provideSignatureHelp({
        text,
        offset: text.length,
        languageData: languageData(),
    });
}

test('builtin print: активный параметр по запятым', () => {
    const help = helpAt('fn main() {\n    print("a", ');
    assert.ok(help, 'ожидалась подсказка сигнатуры');
    assert.equal(help.signatures.length, 1);
    assert.equal(help.activeSignature, 0);
    assert.equal(help.activeParameter, 1);
    assert.equal(help.signatures[0].label, 'print(value, ...)');
    assert.deepEqual(help.signatures[0].parameters.map((p) => p.label), ['value', '...']);
});

test('builtin len: первый параметр', () => {
    const help = helpAt('fn main() {\n    let n = len(');
    assert.ok(help);
    assert.equal(help.signatures[0].label, 'len(arr|str) -> int');
    assert.equal(help.activeParameter, 0);
});

test('пользовательская функция: параметры из объявления', () => {
    const text = `fn add(a: int, b: int) -> int {
    return a + b;
}

fn main() -> int {
    return add(1, `;
    const help = helpAt(text);
    assert.ok(help);
    assert.equal(help.activeParameter, 1);
    assert.match(help.signatures[0].label, /fn add\(a: int, b: int\) -> int/);
    assert.deepEqual(help.signatures[0].parameters.map((p) => p.label), ['a: int', 'b: int']);
});

test('метод после точки: arr.push(value)', () => {
    const text = 'fn main() {\n    let stack = [1, 2, 3];\n    stack.push(';
    const help = helpAt(text);
    assert.ok(help);
    assert.equal(help.signatures[0].label, 'arr.push(value) -> [T]');
    assert.deepEqual(help.signatures[0].parameters.map((p) => p.label), ['value']);
    assert.equal(help.activeParameter, 0);
});

test('вложенный вызов: активен внутренний print', () => {
    const help = helpAt('fn main() {\n    print(len([1, 2]), ');
    assert.ok(help);
    assert.equal(help.signatures[0].label, 'print(value, ...)');
    assert.equal(help.activeParameter, 1);
});

test('закрытый вызов → null', () => {
    assert.equal(helpAt('fn main() {\n    print("a");\n}'), null);
});

test('вне вызова → null', () => {
    assert.equal(helpAt('fn main() {\n    let x = 1;'), null);
});

test('неизвестная функция → null', () => {
    assert.equal(helpAt('fn main() {\n    unknown_fn('), null);
});

test('запятые внутри строк и вложенных скобок не считаются аргументами', () => {
    const help = helpAt('fn main() {\n    print(len([1, 2]), ');
    assert.equal(help.activeParameter, 1);

    const inString = helpAt('fn main() {\n    print("a, b", ');
    assert.equal(inString.activeParameter, 1);
});
