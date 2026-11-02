// test/modules-manifest.test.js — бинарный манифест "LPF1" (C-ABI движка №2).
//
// Проверяем точную раскладку little-endian, round-trip, UTF-8, построение
// манифеста из файлов workspace, ошибки валидации и хэш набора файлов.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MANIFEST_MAGIC, buildModuleManifest, encodeModuleManifest,
    decodeModuleManifest, projectHash,
} from '../compiler/modules-manifest.js';

const FILES = [
    { path: 'main.lat', source: 'import { x } from "./math.lat";\nfn main() { return x(); }' },
    { path: 'math.lat', source: 'export fn x() { return 42; }' },
];

test('LPF1: сигнатура, порядок полей и little-endian', () => {
    const bytes = encodeModuleManifest(FILES, 0);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), MANIFEST_MAGIC);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(4, true), 2, 'file_count');
    let offset = 8;
    const path1Len = view.getUint32(offset, true);
    offset += 4;
    assert.equal(new TextDecoder().decode(bytes.slice(offset, offset + path1Len)), 'main.lat');
    offset += path1Len;
    const src1Len = view.getUint32(offset, true);
    offset += 4;
    assert.equal(src1Len, new TextEncoder().encode(FILES[0].source).length);
    offset += src1Len;
    assert.equal(view.getUint32(offset, true), 8, 'длина пути math.lat');
    offset += 4 + 8;
    offset += 4 + new TextEncoder().encode(FILES[1].source).length;
    assert.equal(view.getUint32(offset, true), 0, 'entry_index в конце');
    assert.equal(offset + 4, bytes.length);
});

test('LPF1: round-trip с UTF-8 (кириллица в исходнике и пути)', () => {
    const files = [
        { path: 'модуль.lat', source: '// привет\nexport fn f() { return 1; }' },
        { path: 'main.lat', source: 'fn main() { print("Привет"); }' },
    ];
    const decoded = decodeModuleManifest(encodeModuleManifest(files, 1));
    assert.deepEqual(decoded, { files, entryIndex: 1 });
});

test('LPF1: некорректные манифесты отклоняются', () => {
    assert.throws(() => decodeModuleManifest(new Uint8Array(3)), /too short/);
    assert.throws(() => decodeModuleManifest(new Uint8Array(12)), /bad magic/);
    const valid = encodeModuleManifest(FILES, 0);
    const truncated = valid.slice(0, valid.length - 2);
    assert.throws(() => decodeModuleManifest(truncated), /truncated|invalid/);
    const withTrailing = new Uint8Array([...valid, 0]);
    assert.throws(() => decodeModuleManifest(withTrailing), /trailing bytes/);
    assert.throws(() => encodeModuleManifest(FILES, 5), /out of range/);
    assert.throws(() => encodeModuleManifest([], 0), /at least one file/);
});

test('buildModuleManifest: все файлы, сортировка путей и entry_index', () => {
    const files = [
        { name: 'z.lat', code: 'export fn z() {}' },
        { name: 'main.lat', code: 'import "./z.lat"; fn main() {}' },
        { name: 'a.lat', code: '' },
    ];
    const manifest = buildModuleManifest(files, 'main.lat');
    assert.deepEqual(manifest.files.map((f) => f.path), ['a.lat', 'main.lat', 'z.lat']);
    assert.equal(manifest.entryIndex, 1);
    const decoded = decodeModuleManifest(
        encodeModuleManifest(manifest.files, manifest.entryIndex));
    assert.equal(decoded.files[decoded.entryIndex].path, 'main.lat');
});

test('buildModuleManifest: дубликат и отсутствующий entry', () => {
    assert.throws(() => buildModuleManifest([
        { name: 'a.lat', code: '' }, { name: './a.lat', code: '' },
    ], 'a.lat'), (e) => e.code === 'DUPLICATE_MODULE');
    assert.throws(() => buildModuleManifest([{ name: 'a.lat', code: '' }], 'main.lat'),
        (e) => e.code === 'ENTRY_NOT_FOUND');
});

test('projectHash: детерминирован, не зависит от порядка, меняется от содержимого', () => {
    const a = [...FILES];
    const b = [...FILES].reverse();
    assert.equal(projectHash(a, 'main.lat'), projectHash(b, 'main.lat'));
    const changed = FILES.map((f) => (f.path === 'math.lat'
        ? { ...f, source: f.source + ' ' } : f));
    assert.notEqual(projectHash(FILES, 'main.lat'), projectHash(changed, 'main.lat'));
    assert.notEqual(projectHash(FILES, 'main.lat'), projectHash(FILES, 'math.lat'));
    assert.match(projectHash(FILES, 'main.lat'), /^[0-9a-f]{8}$/);
});
