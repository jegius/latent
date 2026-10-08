// test/services.test.js — тесты сервисного слоя и утилит IDE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebouncer, HotReload } from '../hot-reload.js';
import {
    encodeBase64Utf8, decodeBase64Utf8, ShareService,
} from '../services/share-service.js';
import { CompilerService } from '../services/compiler-service.js';
import { formatLatent } from '../services/formatter-service.js';
import { loadExamples, loadExampleById } from '../examples.js';

test('createDebouncer: склеивает частые вызовы в один', async () => {
    let calls = 0;
    const d = createDebouncer(() => { calls++; }, 20);
    d.run(); d.run(); d.run();
    assert.equal(calls, 0);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(calls, 1);
});

test('createDebouncer: cancel отменяет вызов', async () => {
    let calls = 0;
    const d = createDebouncer(() => { calls++; }, 20);
    d.run();
    d.cancel();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(calls, 0);
});

test('createDebouncer: flush вызывает немедленно', () => {
    let calls = 0;
    const d = createDebouncer(() => { calls++; }, 1000);
    d.run();
    d.flush();
    assert.equal(calls, 1);
});

test('HotReload: notifyChange игнорируется при выключенном режиме', async () => {
    let reloads = 0;
    const hr = new HotReload({ onReload: () => { reloads++; }, delay: 10 });
    hr.notifyChange();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(reloads, 0);
});

test('HotReload: notifyChange срабатывает при включённом режиме', async () => {
    let reloads = 0;
    const hr = new HotReload({ onReload: () => { reloads++; }, delay: 10 });
    hr.enable();
    hr.notifyChange();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(reloads, 1);
});

test('HotReload: disable отменяет отложенный перезапуск', async () => {
    let reloads = 0;
    const hr = new HotReload({ onReload: () => { reloads++; }, delay: 20 });
    hr.enable();
    hr.notifyChange();
    hr.disable();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(reloads, 0);
});

test('base64 UTF-8: round-trip с кириллицей', () => {
    const src = 'fn main() { print("Привет, мир! 🚀"); }';
    const encoded = encodeBase64Utf8(src);
    assert.equal(decodeBase64Utf8(encoded), src);
});

test('ShareService: buildShareUrl и readCodeFromHash', () => {
    const svc = new ShareService();
    const src = 'fn main() { return 42; }';
    const url = svc.buildShareUrl(src, 'https://ide.example/');
    assert.ok(url.startsWith('https://ide.example/#code='));
    const hash = url.slice(url.indexOf('#'));
    assert.equal(svc.readCodeFromHash(hash), src);
});

test('ShareService: readCodeFromHash без кода → null', () => {
    const svc = new ShareService();
    assert.equal(svc.readCodeFromHash('#other=1'), null);
    assert.equal(svc.readCodeFromHash(''), null);
});

test('ShareService: save/load source (in-memory localStorage stub)', () => {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    };
    const svc = new ShareService();
    svc.saveSource('let a = 1;');
    assert.equal(svc.loadSource(), 'let a = 1;');
    delete globalThis.localStorage;
});

test('CompilerService: formatResult', () => {
    const svc = new CompilerService();
    assert.equal(svc.formatResult(null), 'null');
    assert.equal(svc.formatResult(true), 'true');
    assert.equal(svc.formatResult([1, 2, 3]), '[1, 2, 3]');
    assert.equal(svc.formatResult([1, [2, 3]]), '[1, [2, 3]]');
});

test('CompilerService: formatBytecode hex-дамп', () => {
    const svc = new CompilerService();
    const out = svc.formatBytecode(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
    assert.match(out, /Bytecode size: 4 bytes/);
    assert.match(out, /00 61 73 6d/);
    assert.match(out, /\.asm/);
});

test('CompilerService: formatBytecode пустой', () => {
    const svc = new CompilerService();
    assert.equal(svc.formatBytecode(new Uint8Array([])), '(empty)');
});

test('CompilerService: compileAndRun простой программы', async () => {
    const svc = new CompilerService();
    const { result, logs, analysis, bytecode } = await svc.compileAndRun(
        'fn main() { print("ok"); return 7; }', false);
    assert.equal(result, 7);
    assert.deepEqual(logs, ['ok']);
    assert.equal(analysis.functions, 1);
    assert.ok(bytecode.length > 0);
});

test('CompilerService: compileAndRunWithRepair чинит несбалансированные скобки (mock)', async () => {
    const svc = new CompilerService();
    const broken = 'fn main() {\n    return 1;\n'; // не хватает закрывающей }
    const out = await svc.compileAndRunWithRepair(broken, false, 3);
    assert.equal(out.result, 1);
    assert.ok(out.attempts >= 2);
    assert.ok(out.repaired);
});

test('примеры: все исполняются без ошибок', async () => {
    const svc = new CompilerService();
    const examples = await loadExamples();
    assert.ok(examples.length > 0, 'примеры не найдены');
    for (const ex of examples) {
        const { result } = await svc.compileAndRun(ex.code, ex.needsAI === true);
        assert.notEqual(result, undefined, `example ${ex.id} produced undefined`);
    }
});

test('getExampleById / loadExampleById', async () => {
    assert.ok(await loadExampleById('sorting'));
    assert.equal(await loadExampleById('nope'), undefined);
});

test('formatLatent: выравнивает отступы по фигурным скобкам', () => {
    const src = 'fn main() {\nlet x = 1;\nif (x) {\nprint(x);\n}\n}\n';
    const out = formatLatent(src);
    assert.equal(out, 'fn main() {\n    let x = 1;\n    if (x) {\n        print(x);\n    }\n}\n');
});

test('formatLatent: пробелы вокруг операторов и после запятых', () => {
    const out = formatLatent('let x=[1,2,3];\nlet y=2+3*4;\n');
    assert.equal(out, 'let x = [1, 2, 3];\nlet y = 2 + 3 * 4;\n');
});

test('formatLatent: не трогает строки и комментарии', () => {
    const src = 'let s = "a,  b";  // double  space\n';
    const out = formatLatent(src);
    assert.ok(out.includes('"a,  b"'));
    assert.ok(out.includes('// double  space'));
});

test('formatLatent: унарный минус не получает пробел справа', () => {
    const out = formatLatent('let z=-5;\nlet w = a - -b;\n');
    assert.ok(out.includes('let z = -5;'));
    assert.ok(out.includes('a - -b'));
});

test('formatLatent: идемпотентен на всех примерах', async () => {
    const examples = await loadExamples();
    for (const ex of examples) {
        const once = formatLatent(ex.code);
        const twice = formatLatent(once);
        assert.equal(once, twice, `example ${ex.id} not idempotent`);
    }
});