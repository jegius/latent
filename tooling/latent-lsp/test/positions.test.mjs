// tooling/latent-lsp/test/positions.test.mjs — UTF-16 позиции LSP и
// инкрементальные правки документов.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    charColumnToUtf16,
    clampPosition,
    documentRange,
    lineBounds,
    lineCount,
    lineStarts,
    lineTextAt,
    offsetToPosition,
    positionToOffset,
} from '../src/positions.mjs';
import { applyAllChanges, applyContentChange, DocumentStore } from '../src/documents.mjs';

const SAMPLE = 'fn main() {\n    let x = 1;\n    return x;\n}\n';

test('lineStarts/lineBounds/lineTextAt', () => {
    assert.deepEqual(lineStarts('a\nb\nc'), [0, 2, 4]);
    assert.equal(lineCount(SAMPLE), 5);
    assert.deepEqual(lineBounds(SAMPLE, 1), { start: 12, end: 26 });
    assert.equal(lineTextAt(SAMPLE, 1), '    let x = 1;');
    assert.equal(lineTextAt(SAMPLE, 0), 'fn main() {');
});

test('positionToOffset ↔ offsetToPosition — обратимы', () => {
    assert.equal(positionToOffset(SAMPLE, { line: 1, character: 4 }), 16);
    assert.deepEqual(offsetToPosition(SAMPLE, 16), { line: 1, character: 4 });
    // Конец файла.
    const end = offsetToPosition(SAMPLE, SAMPLE.length);
    assert.equal(positionToOffset(SAMPLE, end), SAMPLE.length);
});

test('позиции клампятся в границы документа', () => {
    const huge = { line: 100, character: 100 };
    assert.equal(positionToOffset(SAMPLE, huge), SAMPLE.length);
    assert.deepEqual(clampPosition(SAMPLE, huge), { line: 4, character: 0 });
    assert.deepEqual(clampPosition(SAMPLE, { line: -5, character: -1 }), { line: 0, character: 0 });
});

test('столбцы компилятора (code points) → UTF-16', () => {
    // Кириллица — BMP, 1 code unit на символ: столбец 1-based 3 → character 2.
    assert.equal(charColumnToUtf16('abc привет', 0, 3), 2);
    // Суррогатная пара (эмодзи) занимает 2 UTF-16 code units.
    assert.equal(charColumnToUtf16('😀x', 0, 2), 2);
    assert.equal(charColumnToUtf16('😀x', 0, 3), 3);
});

test('documentRange покрывает весь документ', () => {
    const range = documentRange(SAMPLE);
    assert.deepEqual(range.start, { line: 0, character: 0 });
    assert.deepEqual(range.end, { line: 4, character: 0 });
});

test('applyContentChange: полная замена без range', () => {
    assert.equal(applyContentChange('old', { text: 'new' }), 'new');
});

test('applyContentChange: вставка, удаление и замена по range', () => {
    const text = 'let x = 1;';
    // Вставка в конец.
    assert.equal(
        applyContentChange(text, {
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
            text: ' return x;',
        }),
        'let x = 1; return x;');
    // Удаление "1".
    assert.equal(
        applyContentChange(text, {
            range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } },
            text: '',
        }),
        'let x = ;');
    // Замена "let" → "var".
    assert.equal(
        applyContentChange(text, {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            text: 'var',
        }),
        'var x = 1;');
});

test('applyAllChanges: изменения применяются последовательно', () => {
    const result = applyAllChanges('abc', [
        { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, text: 'd' },
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: 'X' },
    ]);
    assert.equal(result, 'Xbcd');
});

test('applyContentChange: некорректный (перевёрнутый) range не роняет сервер', () => {
    const result = applyContentChange('abc', {
        range: { start: { line: 0, character: 2 }, end: { line: 0, character: 1 } },
        text: 'Z',
    });
    assert.equal(result, 'Zabc');
});

test('DocumentStore: open/get/change/close и версия', () => {
    const store = new DocumentStore();
    const uri = 'file:///test.lat';
    const doc = store.open(uri, { text: 'fn main() {}\n', version: 1 });
    assert.equal(store.has(uri), true);
    assert.equal(doc.getText(), 'fn main() {}\n');

    doc.applyChanges(2, [{
        range: { start: { line: 0, character: 12 }, end: { line: 0, character: 12 } },
        text: ' // hi',
    }]);
    assert.equal(store.textOf(uri), 'fn main() {} // hi\n');
    assert.equal(store.versionOf(uri), 2);

    store.close(uri);
    assert.equal(store.has(uri), false);
    assert.equal(store.textOf(uri), '');
});
