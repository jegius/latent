// test/workspace.test.js — тесты модели рабочего пространства (файлы .lat).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from '../services/workspace-service.js';

function memStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m,
    };
}

test('normalizeName добавляет .lat и чистит символы', () => {
    assert.equal(WorkspaceService.normalizeName('main'), 'main.lat');
    assert.equal(WorkspaceService.normalizeName('foo.lat'), 'foo.lat');
    assert.equal(WorkspaceService.normalizeName('a/b:c'), 'a_b_c.lat');
    assert.equal(WorkspaceService.normalizeName(''), 'untitled.lat');
});

test('createFile добавляет файл и делает его активным', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const f = ws.createFile('a', 'let x = 1;');
    assert.equal(f.name, 'a.lat');
    assert.equal(ws.activeId, f.id);
    assert.equal(ws.getActiveCode(), 'let x = 1;');
});

test('initialFiles создаются при первом запуске', () => {
    const ws = new WorkspaceService({
        storage: memStorage(),
        initialFiles: [{ name: 'main.lat', code: 'fn main(){}' }],
    });
    assert.equal(ws.files.length, 1);
    assert.equal(ws.getActive().name, 'main.lat');
});

test('updateCode сохраняет изменения', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const f = ws.createFile('a');
    ws.updateCode(f.id, 'fn main() { return 1; }');
    assert.equal(ws.getFile(f.id).code, 'fn main() { return 1; }');
});

test('setActive переключает файл', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const a = ws.createFile('a');
    const b = ws.createFile('b');
    assert.equal(ws.activeId, b.id);
    assert.ok(ws.setActive(a.id));
    assert.equal(ws.activeId, a.id);
    assert.equal(ws.setActive('nope'), false);
});

test('deleteFile удаляет и переключает активный', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const a = ws.createFile('a');
    const b = ws.createFile('b');
    ws.setActive(b.id);
    assert.ok(ws.deleteFile(b.id));
    assert.equal(ws.files.length, 1);
    assert.equal(ws.activeId, a.id);
});

test('нельзя удалить последний файл', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const a = ws.createFile('a');
    assert.equal(ws.deleteFile(a.id), false);
    assert.equal(ws.files.length, 1);
});

test('renameFile нормализует имя', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const a = ws.createFile('a');
    ws.renameFile(a.id, 'renamed');
    assert.equal(ws.getFile(a.id).name, 'renamed.lat');
});

test('персистентность через storage', () => {
    const store = memStorage();
    const ws1 = new WorkspaceService({ storage: store });
    ws1.createFile('main', 'fn main() { return 42; }');

    const ws2 = new WorkspaceService({ storage: store });
    assert.equal(ws2.files.length, 1);
    assert.equal(ws2.getActive().name, 'main.lat');
    assert.equal(ws2.getActiveCode(), 'fn main() { return 42; }');
});

test('storage без данных → initialFiles', () => {
    const ws = new WorkspaceService({
        storage: memStorage(),
        initialFiles: [{ name: 'x.lat', code: '' }],
    });
    assert.equal(ws.files.length, 1);
});

test('id файлов уникальны', () => {
    const ws = new WorkspaceService({ storage: memStorage() });
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(ws.createFile('f' + i).id);
    assert.equal(ids.size, 50);
});