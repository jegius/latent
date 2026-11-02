// tooling/latent-lsp/test/formatter-scan.test.mjs — посимвольный разбор строки
// для форматтера: защищённые участки (строки/комментарии) и подсчёт скобок.
//
// Проверяются именно граничные состояния, которые не покрывались тестами
// форматтера: перенос блочного комментария через строки, вход в комментарий,
// ведущие закрывающие скобки.

import test from 'node:test';
import assert from 'node:assert/strict';

import { scanLine, braceStats } from '../src/formatter-scan.mjs';

/** @returns {{inBlockComment: boolean}} */
const freshState = () => ({ inBlockComment: false });

test('scanLine: многострочный блочный комментарий защищён и закрывается', () => {
    const state = freshState();
    const first = scanLine('let x = 1; /* начало', state);
    assert.equal(state.inBlockComment, true, 'после /* состояние блочного комментария');
    assert.equal(first.at(-1).protected, true, 'последний символ строки — внутри комментария');

    const middle = scanLine('продолжение комментария', state);
    assert.ok(middle.every((c) => c.protected), 'строка внутри комментария защищена целиком');

    const last = scanLine('конец */ let y = 2;', state);
    assert.equal(state.inBlockComment, false, 'после */ комментарий закрыт');
    const text = last.map((c) => c.ch).join('');
    assert.equal(text, 'конец */ let y = 2;', 'текст строки сохраняется дословно');
    assert.equal(last.find((c) => c.ch === 'y')?.protected, false, 'код после */ не защищён');
});

test('scanLine: //-комментарий защищён до конца строки', () => {
    const chars = scanLine('let x = 1; // { } "', freshState());
    const comment = chars.slice(chars.findIndex((c) => c.ch === '/' && c.protected));
    assert.ok(comment.length > 0);
    assert.ok(comment.every((c) => c.protected), 'весь //-комментарий защищён');
});

test('scanLine: экранированная кавычка не закрывает строку', () => {
    const chars = scanLine('print("a\\"b"); x', freshState());
    const text = chars.map((c) => c.ch).join('');
    assert.equal(text, 'print("a\\"b"); x');
    // После закрывающей строку кавычки код снова не защищён.
    assert.equal(chars.find((c) => c.ch === 'x')?.protected, false);
});

test('braceStats: ведущие закрывающие скобки и скобки в строках/комментариях', () => {
    assert.deepEqual(braceStats(scanLine('fn f() {', freshState())), { opens: 1, leadingClose: 0 });
    // leadingClose учитывает только закрывающие скобки до первого кода.
    assert.deepEqual(braceStats(scanLine('} }', freshState())), { opens: -2, leadingClose: 1 });
    // Фигурные скобки внутри строки и //-комментария не считаются.
    assert.deepEqual(braceStats(scanLine('print("{ }"); // }', freshState())),
        { opens: 0, leadingClose: 0 });
});
