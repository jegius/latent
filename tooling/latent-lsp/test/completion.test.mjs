// tooling/latent-lsp/test/completion.test.mjs — автодополнение: ключевые слова,
// builtins, методы после точки, символы файла, типы и сниппеты.

import test from 'node:test';
import assert from 'node:assert/strict';

import { provideCompletion, signatureToSnippet } from '../src/completion.mjs';
import { languageData } from './helpers.mjs';

const DOC = `fn add(a: int, b: int) -> int {
    return a + b;
}

class Point {
    x: int;
    y: int;

    fn init(x, y) {
        this.x = x;
        this.y = y;
    }

    fn norm() {
        return this.x * this.x + this.y * this.y;
    }
}

enum Color {
    Red,
    Green,
}

fn main() -> int {
    let p = new Point(1, 2);
    let stack = [1, 2, 3];
    let ch = channel<int>();
    let text = "hello";
    let value = add(1, 2);
    return value;
}
`;

/**
 * Completion в конце переданного текста (курсор — сразу за последним символом).
 * @param {string} text
 */
function completeAt(text) {
    return provideCompletion({
        text,
        offset: text.length,
        languageData: languageData(),
    });
}

/** Тело main без закрывающей скобки — удобно для дописывания кода. */
function openMain() {
    return DOC.replace(/\}\s*$/, '');
}

/** @param {{items: any[]}} list */
function labels(list) {
    return list.items.map((item) => item.label);
}

/** @param {{items: any[]}} list @param {string} label */
function item(list, label) {
    return list.items.find((candidate) => candidate.label === label);
}

test('keyword: префикс "whil" даёт while со сниппетом', () => {
    const list = completeAt('fn main() {\n    whil');
    const whileItem = item(list, 'while');
    assert.ok(whileItem, 'нет элемента while');
    assert.equal(whileItem.insertTextFormat, 2, 'while должен вставляться сниппетом');
    assert.match(whileItem.insertText, /\$\{1:cond\}/);
    assert.equal(whileItem.kind, 14, 'CompletionItemKind.Keyword');
});

test('builtin: префикс "pri" даёт print с сигнатурой и сниппетом', () => {
    const list = completeAt('fn main() {\n    pri');
    assert.ok(labels(list).includes('print'));
    const printItem = item(list, 'print');
    assert.equal(printItem.kind, 3, 'CompletionItemKind.Function');
    assert.match(printItem.detail, /print\(value, \.\.\.\)/);
    assert.equal(printItem.insertTextFormat, 2);
    assert.match(printItem.insertText, /print\(\$\{1:value\}/);
    assert.match(printItem.documentation.value, /встроенная функция/);
});

test('builtin: не выдумываем несуществующих функций', () => {
    const list = completeAt('');
    const names = labels(list);
    for (const absent of ['reduce', 'range', 'abs', 'panic', 'assert_ne', 'exit']) {
        assert.ok(!names.includes(absent), `${absent} не должен попадать в completion`);
    }
});

test('host-only builtin помечен в detail', () => {
    const list = completeAt('fn main() {\n    tens');
    const tensorItem = item(list, 'tensor');
    assert.ok(tensorItem, 'нет tensor');
    assert.match(tensorItem.detail, /host-only/);
});

test('методы после точки: массив → push/pop/length', () => {
    const list = completeAt(openMain() + '    stack.');
    const names = labels(list);
    for (const method of ['push', 'pop', 'length']) {
        assert.ok(names.includes(method), `нет метода ${method} в ${names.join(',')}`);
    }
    assert.equal(item(list, 'push').kind, 2, 'CompletionItemKind.Method');
    assert.match(item(list, 'push').detail, /arr\.push\(value\)/);
});

test('методы после точки: канал → send/recv', () => {
    const list = completeAt(openMain() + '    ch.');
    const names = labels(list);
    assert.ok(names.includes('send'));
    assert.ok(names.includes('recv'));
});

test('методы после точки: класс → поля и методы', () => {
    const list = completeAt(openMain() + '    p.');
    const names = labels(list);
    for (const member of ['x', 'y', 'init', 'norm']) {
        assert.ok(names.includes(member), `нет члена класса ${member}`);
    }
    assert.equal(item(list, 'x').kind, 5, 'CompletionItemKind.Field');
    assert.equal(item(list, 'init').kind, 2, 'CompletionItemKind.Method');
});

test('методы после точки: строковый литерал → length', () => {
    const text = 'fn main() { let n = "hello".';
    const list = completeAt(text);
    assert.ok(labels(list).includes('length'));
});

test('методы после точки: this внутри класса', () => {
    const text = `class P {
    x: int;
    fn init() {
        this.`;
    const list = completeAt(text);
    assert.ok(labels(list).includes('x'));
});

test('символы текущего файла попадают в completion', () => {
    const list = completeAt(openMain() + '    ad');
    const addItem = item(list, 'add');
    assert.ok(addItem, 'нет символа add');
    assert.equal(addItem.kind, 3, 'CompletionItemKind.Function');
    assert.match(addItem.detail, /функция/);
});

test('enum попадает в completion как Enum', () => {
    const list = completeAt(openMain() + '    let c = Col');
    const colorItem = item(list, 'Color');
    assert.ok(colorItem);
    assert.equal(colorItem.kind, 13, 'CompletionItemKind.Enum');
});

test('типы в контексте аннотации', () => {
    const text = 'fn main() {\n    let x: ';
    const list = completeAt(text);
    const names = labels(list);
    for (const type of ['int', 'float', 'bool', 'string']) {
        assert.ok(names.includes(type), `нет типа ${type}`);
    }
});

test('нет дубликатов label', () => {
    const names = labels(completeAt(''));
    assert.equal(new Set(names).size, names.length, 'в completion есть дубликаты label');
});

test('внутри строки completion не предлагается', () => {
    const list = completeAt('fn main() { let s = "pri');
    assert.deepEqual(list.items, []);
});

test('signatureToSnippet превращает сигнатуру в сниппет', () => {
    assert.deepEqual(signatureToSnippet('len', 'len(arr|str) -> int'),
        { text: 'len(${1:arr})' });
    assert.deepEqual(signatureToSnippet('memcopy', 'memcopy(dst, src, len)'),
        { text: 'memcopy(${1:dst}, ${2:src}, ${3:len})' });
    assert.deepEqual(signatureToSnippet('print', 'print(value, ...)'),
        { text: 'print(${1:value}, ${2:...})' });
    assert.equal(signatureToSnippet('now', 'now'), null);
});
