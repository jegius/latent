// test/editor-core.test.js — чистые модули canvas-редактора без DOM.
//
// Подсветка строки (line-tokenizer) и геометрия/позиция курсора (editor-metrics)
// не зависят от реального DOM — проверяем их контракты на фейковом `ed`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLine } from '../views/editor/line-tokenizer.js';
import {
    posToLineCol, getMaxScroll, getMaxScrollX, ensureCursorVisible,
} from '../views/editor/editor-metrics.js';

/** Фейковый редактор: canvas-контекст измеряет символ как 8px. */
function fakeEditor(overrides = {}) {
    return {
        code: '',
        cursorPos: 0,
        scrollOffset: 0,
        scrollOffsetX: 0,
        lineHeight: 20,
        scrollbarWidth: 12,
        gutterWidth: 56,
        font: '14px monospace',
        canvas: { width: 400, height: 200 },
        textarea: null,
        ctx: { font: '', measureText: (text) => ({ width: text.length * 8 }) },
        ...overrides,
    };
}

// ---------- line-tokenizer ----------

test('tokenizeLine: ключевые слова, типы, builtins, идентификаторы', () => {
    const tokens = tokenizeLine('let x: int = print;');
    const byType = (type) => tokens.filter(t => t.type === type).map(t => t.text);
    assert.deepEqual(byType('keyword'), ['let']);
    assert.deepEqual(byType('type'), ['int']);
    assert.deepEqual(byType('builtin'), ['print']);
    assert.ok(byType('variable').includes('x'));
});

test('tokenizeLine: комментарий до конца строки', () => {
    const tokens = tokenizeLine('let a = 1; // всё дальше — комментарий');
    assert.equal(tokens.at(-1).type, 'comment');
    assert.equal(tokens.at(-1).text, '// всё дальше — комментарий');
});

test('tokenizeLine: строки с экранированием и незакрытая строка', () => {
    const tokens = tokenizeLine('print("a\\"b")');
    const str = tokens.find(t => t.type === 'string');
    assert.equal(str.text, '"a\\"b"');
    const open = tokenizeLine('"unterminated').find(t => t.type === 'string');
    assert.equal(open.text, '"unterminated');
});

test('tokenizeLine: числа, операторы, пробелы и прочие символы', () => {
    const tokens = tokenizeLine('x <= (3.14 + y) @');
    const types = tokens.map(t => t.type);
    assert.ok(types.includes('number'));
    assert.ok(types.includes('operator'));
    assert.ok(types.includes('text'));
    assert.equal(tokens.find(t => t.type === 'number').text, '3.14');
    assert.ok(tokens.some(t => t.text === '<=' && t.type === 'operator'));
    assert.ok(tokens.some(t => t.text === '@' && t.type === 'text'));
});

test('tokenizeLine: пустая строка → пустой список', () => {
    assert.deepEqual(tokenizeLine(''), []);
});

// ---------- editor-metrics: позиция ----------

test('posToLineCol: начало, конец строки, последняя строка, выход за длину', () => {
    const ed = fakeEditor({ code: 'ab\ncd\nef' });
    assert.deepEqual(posToLineCol(ed, 0), { line: 0, col: 0 });
    assert.deepEqual(posToLineCol(ed, 2), { line: 0, col: 2 });
    assert.deepEqual(posToLineCol(ed, 3), { line: 1, col: 0 });
    assert.deepEqual(posToLineCol(ed, 5), { line: 1, col: 2 });
    assert.deepEqual(posToLineCol(ed, 7), { line: 2, col: 1 });
    assert.deepEqual(posToLineCol(ed, 100), { line: 2, col: 2 });
});

// ---------- editor-metrics: скролл ----------

test('getMaxScroll: по высоте строк и высоте canvas', () => {
    assert.equal(getMaxScroll(fakeEditor({ code: 'a' })), 0);
    const tall = Array.from({ length: 20 }, () => 'x').join('\n'); // 20 строк * 20px
    assert.equal(getMaxScroll(fakeEditor({ code: tall })), 200);
});

test('getMaxScrollX: по самой длинной строке', () => {
    assert.equal(getMaxScrollX(fakeEditor({ code: 'a\nbb' })), 0);
    const long = 'x'.repeat(100); // 800px при видимой ширине 400-12-56=332
    assert.equal(getMaxScrollX(fakeEditor({ code: long })), 800 - 332);
});

test('ensureCursorVisible: вертикальный автоскролл вниз и вверх', () => {
    const tall = Array.from({ length: 10 }, () => 'x').join('\n');
    // Видимая высота 100px = 5 строк: курсор на 10-й строке требует скролла.
    const down = fakeEditor({ code: tall, cursorPos: 18, canvas: { width: 400, height: 100 } });
    ensureCursorVisible(down);
    assert.equal(down.scrollOffset, 100); // 10 строк * 20px - 100px окна

    const up = fakeEditor({ code: tall, cursorPos: 0, scrollOffset: 500 });
    ensureCursorVisible(up);
    assert.equal(up.scrollOffset, 0);
});

test('ensureCursorVisible: горизонтальный автоскролл и sync textarea', () => {
    const long = 'x'.repeat(100);
    const ed = fakeEditor({ code: long, cursorPos: 100, textarea: {} });
    ensureCursorVisible(ed);
    assert.equal(ed.scrollOffsetX, 800 - 332);
    assert.equal(ed.textarea.scrollLeft, ed.scrollOffsetX);
    assert.equal(ed.textarea.scrollTop, ed.scrollOffset);

    const left = fakeEditor({ code: long, cursorPos: 0, scrollOffsetX: 100 });
    ensureCursorVisible(left);
    assert.equal(left.scrollOffsetX, 0);
});
