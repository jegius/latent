// tooling/latent-lsp/test/hover.test.mjs — hover из language.json и объявлений файла.

import test from 'node:test';
import assert from 'node:assert/strict';

import { provideHover } from '../src/hover.mjs';
import { languageData } from './helpers.mjs';

const DOC = `fn add(a: int, b: int) -> int {
    return a + b;
}

fn main() -> int {
    let total: int = add(1, 2);
    let flag = total > 0 && true;
    print("total =", total);
    return total;
}
`;

/**
 * Hover в позиции первого вхождения подстроки (со сдвигом inside).
 * @param {string} needle
 * @param {number} [inside]
 * @param {string} [doc]
 */
function hoverAt(needle, inside = 1, doc = DOC) {
    const index = doc.indexOf(needle);
    assert.ok(index >= 0, `маркер не найден: ${needle}`);
    return provideHover({
        text: doc,
        offset: index + inside,
        languageData: languageData(),
    });
}

test('hover по ключевому слову: let', () => {
    const hover = hoverAt('let total', 1);
    assert.ok(hover, 'hover не найден');
    assert.equal(hover.contents.kind, 'markdown');
    assert.match(hover.contents.value, /\*\*let\*\* — ключевое слово/);
    assert.match(hover.contents.value, /```latent/);
    assert.match(hover.contents.value, /docs\/guide\/variables/);
    assert.equal(hover.range.start.line, 5);
    assert.equal(hover.range.start.character, 4);
});

test('hover по встроенной функции: print', () => {
    const hover = hoverAt('print(', 2);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*print\*\* — встроенная функция/);
    assert.match(hover.contents.value, /print\(value, \.\.\.\)/);
    assert.match(hover.contents.value, /docs\/reference\/builtins/);
});

test('hover по типу: int', () => {
    const hover = hoverAt(': int', 3);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*int\*\* — тип/);
    assert.match(hover.contents.value, /WASM: `i32`/);
});

test('hover по оператору: && с приоритетом', () => {
    const hover = hoverAt('&&', 1);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*&&\*\* — binary/);
    assert.match(hover.contents.value, /приоритет 20/);
    assert.match(hover.contents.value, /ассоциативность left/);
});

test('hover по оператору сравнения: >', () => {
    const hover = hoverAt('total >', 7);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*> |\*\*>|приоритет 40/);
});

test('hover по символу файла: функция add', () => {
    const hover = hoverAt('add(1', 1);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*add\*\* — функция/);
    assert.match(hover.contents.value, /строк(а|е) 1/);
    assert.match(hover.contents.value, /fn add\(a: int, b: int\) -> int/);
});

test('hover по методу после точки: length', () => {
    const doc = 'fn main() {\n    let n = [1, 2].length;\n}\n';
    const hover = hoverAt('length', 1, doc);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*length\*\* — свойство/);
    assert.match(hover.contents.value, /arr\.length/);
});

test('hover по мягкому ключевому слову: test', () => {
    const doc = 'test "arithmetic" {\n    assert(true);\n}\n';
    const hover = hoverAt('test', 1, doc);
    assert.ok(hover);
    assert.match(hover.contents.value, /ключевое слово/);
    assert.match(hover.contents.value, /мягкое ключевое слово/);
});

test('hover по неизвестному слову → null', () => {
    const doc = 'fn main() {\n    foobarbazqux();\n}\n';
    const index = doc.indexOf('foobarbazqux');
    const hover = provideHover({
        text: doc,
        offset: index + 1,
        languageData: languageData(),
    });
    assert.equal(hover, null);
});

test('hover по host-only builtin предупреждает о движке', () => {
    const doc = 'fn main() {\n    let t = tensor([[1]]);\n}\n';
    const hover = hoverAt('tensor', 2, doc);
    assert.ok(hover);
    assert.match(hover.contents.value, /\*\*tensor\*\* — host-функция/);
    assert.match(hover.contents.value, /host-рантайма/);
});
