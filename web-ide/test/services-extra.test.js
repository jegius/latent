// test/services-extra.test.js — граничные ветки сервисов и утилит IDE.
//
// Покрываем fallback-поведение без localStorage/сети: шаринг через URL,
// модель рабочего пространства, браузерный путь загрузчика примеров и
// переключатель авто-перезапуска.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShareService, encodeBase64Utf8 } from '../services/share-service.js';
import { WorkspaceService } from '../services/workspace-service.js';
import { HotReload, createDebouncer } from '../hot-reload.js';
import { loadExamples, resetExamplesCache } from '../examples.js';

// ---------- ShareService: деградация без браузерных API ----------

test('share: URL без base и без location → только hash', () => {
    const svc = new ShareService();
    const url = svc.buildShareUrl('let a = 1;');
    assert.ok(url.startsWith('#code='));
    assert.equal(svc.readCodeFromHash(url.slice(url.indexOf('#'))), 'let a = 1;');
});

test('share: readCodeFromHash без аргумента и без location → null', () => {
    assert.equal(new ShareService().readCodeFromHash(), null);
});

test('share: битый base64 → null', () => {
    assert.equal(new ShareService().readCodeFromHash('#code=%%%'), null);
});

test('share: ошибки localStorage не пробрасываются', () => {
    const svc = new ShareService();
    globalThis.localStorage = {
        setItem: () => { throw new Error('quota'); },
        getItem: () => { throw new Error('blocked'); },
    };
    try {
        assert.doesNotThrow(() => svc.saveSource('x'));
        assert.equal(svc.loadSource(), null);
    } finally {
        delete globalThis.localStorage;
    }
    assert.equal(svc.loadSource(), null); // localStorage вообще отсутствует
});

test('share: base64 UTF-8 сохраняет эмодзи', () => {
    const src = 'fn main() { print("λ 🚀"); }';
    assert.equal(new ShareService().readCodeFromHash('#code=' + encodeBase64Utf8(src)), src);
});

test('share: использует location, если base не передан', () => {
    const origLocation = globalThis.location;
    globalThis.location = { href: 'https://ide.example/play#old', hash: '#code=YQ==' };
    try {
        const svc = new ShareService();
        assert.equal(svc.buildShareUrl('a'), 'https://ide.example/play#code=YQ==');
        assert.equal(svc.readCodeFromHash(), 'a');
    } finally {
        if (origLocation === undefined) delete globalThis.location;
        else globalThis.location = origLocation;
    }
});

// ---------- WorkspaceService: хранилище без данных/битое ----------

test('workspace: без storage работает в памяти', () => {
    const ws = new WorkspaceService({ storage: null });
    assert.equal(ws.files.length, 0);
    assert.equal(ws.getActiveCode(), '');
    const f = ws.createFile('main');
    assert.equal(f.code, '');
    assert.equal(ws.getActiveCode(), '');
    assert.doesNotThrow(() => ws.save());
});

test('workspace: битый JSON в storage → пустое пространство', () => {
    const storage = { getItem: () => '{oops', setItem: () => {} };
    const ws = new WorkspaceService({ storage });
    assert.equal(ws.files.length, 0);
});

test('workspace: пустой список файлов в storage → пусто', () => {
    const storage = { getItem: () => JSON.stringify({ activeId: null, files: [] }), setItem: () => {} };
    assert.equal(new WorkspaceService({ storage }).files.length, 0);
});

test('workspace: storage.getItem бросает → graceful', () => {
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    assert.equal(new WorkspaceService({ storage }).files.length, 0);
});

test('workspace: ошибка записи storage не пробрасывается', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const ws = new WorkspaceService({ storage });
    assert.doesNotThrow(() => ws.createFile('a'));
});

test('workspace: операции с несуществующими id', () => {
    const ws = new WorkspaceService({ storage: null });
    ws.createFile('a');
    ws.createFile('b');
    assert.equal(ws.renameFile('nope', 'x'), false);
    assert.equal(ws.deleteFile('nope'), false);
    assert.equal(ws.updateCode('nope', 'code'), undefined);
    assert.equal(ws.setActive('nope'), false);
    assert.equal(ws.getFile('nope'), undefined);
});

test('workspace: удаление неактивного файла не меняет активный', () => {
    const ws = new WorkspaceService({ storage: null });
    const a = ws.createFile('a');
    const b = ws.createFile('b');
    ws.setActive(b.id);
    assert.ok(ws.deleteFile(a.id));
    assert.equal(ws.activeId, b.id);
});

test('workspace: normalizeName очищает запрещённые символы', () => {
    assert.equal(WorkspaceService.normalizeName('  a<b>c  '), 'a_b_c.lat');
    assert.equal(WorkspaceService.normalizeName('x.lat'), 'x.lat');
});

test('workspace: по умолчанию использует localStorage', () => {
    const map = new Map();
    globalThis.localStorage = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
    };
    try {
        const ws = new WorkspaceService();
        ws.createFile('main', 'fn main() {}');
        assert.ok(map.has('latent-workspace-v1'));
        const restored = new WorkspaceService(); // читает тот же localStorage
        assert.equal(restored.getActive().name, 'main.lat');
    } finally {
        delete globalThis.localStorage;
    }
});

// ---------- Загрузчик примеров: браузерный путь ----------

test('examples: браузерный путь через fetch и сброс кэша', async () => {
    const origFetch = globalThis.fetch;
    globalThis.window = {}; // имитируем браузерное окружение
    globalThis.fetch = async () => ({ ok: true, text: async () => '// browser\nfn main() {}' });
    resetExamplesCache();
    try {
        const list = await loadExamples();
        assert.ok(list.length > 0);
        assert.match(list[0].code, /browser/);
    } finally {
        delete globalThis.window;
        globalThis.fetch = origFetch;
        resetExamplesCache();
    }
    const fromFs = await loadExamples(); // снова реальные .lat-файлы
    assert.doesNotMatch(fromFs[0].code, /browser/);
});

test('examples: HTTP-ошибка загрузки примера', async () => {
    const origFetch = globalThis.fetch;
    globalThis.window = {};
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    resetExamplesCache();
    try {
        await assert.rejects(() => loadExamples(), /Не удалось загрузить пример/);
    } finally {
        delete globalThis.window;
        globalThis.fetch = origFetch;
        resetExamplesCache();
    }
});

// ---------- HotReload и дебаунсер ----------

test('HotReload: toggle без аргумента и значения по умолчанию', () => {
    const hr = new HotReload();
    assert.equal(hr.enabled, false);
    assert.equal(hr.toggle(), true);
    assert.equal(hr.toggle(), false);
    assert.equal(hr.toggle(true), true);
    assert.equal(hr.toggle(false), false);
});

test('createDebouncer: flush без ожидающего вызова ничего не делает', () => {
    let calls = 0;
    const d = createDebouncer(() => { calls++; }, 1000);
    d.flush();
    assert.equal(calls, 0);
});
