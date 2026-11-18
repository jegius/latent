import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    CLIENT_CAPABILITIES,
    LspClient,
    repoRootFor,
    resolveServerPath,
    serverExists,
} = require('../src/lsp-client.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');
const fakeLsp = path.join(__dirname, 'fixtures', 'fake-lsp.mjs');
const crashLsp = path.join(__dirname, 'fixtures', 'fake-crash.mjs');

const URI = 'file:///tmp/latent-test.lat';

function waitFor(predicate, timeoutMs = 5000, label = 'условие') {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            let value;
            try {
                value = predicate();
            } catch (e) {
                reject(e);
                return;
            }
            if (value) {
                resolve(value);
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error(`Таймаут ожидания: ${label}`));
                return;
            }
            setTimeout(tick, 10);
        };
        tick();
    });
}

function createClient(overrides = {}) {
    return new LspClient({
        serverPath: fakeLsp,
        nodePath: process.execPath,
        cwd: repoRoot,
        logger: () => {},
        requestTimeout: 5000,
        ...overrides,
    });
}

test('lsp-client: resolveServerPath и serverExists', () => {
    assert.equal(resolveServerPath({ extensionPath: extensionRoot }),
        path.join(repoRoot, 'tooling', 'latent-lsp', 'bin', 'server.mjs'));
    assert.equal(resolveServerPath({ configuredPath: fakeLsp }), path.resolve(fakeLsp));
    assert.equal(resolveServerPath({ workspaceRoot: repoRoot }),
        path.join(repoRoot, 'tooling', 'latent-lsp', 'bin', 'server.mjs'));
    assert.equal(resolveServerPath({}), '');
    assert.equal(repoRootFor(extensionRoot), repoRoot);
    assert.equal(repoRootFor(''), null);
    assert.equal(serverExists(fakeLsp), true);
    assert.equal(serverExists(path.join(os.tmpdir(), 'no-such-lsp.mjs')), false);
    assert.equal(serverExists(''), false);
    assert.ok(CLIENT_CAPABILITIES.textDocument.completion.completionItem.snippetSupport);
});

test('lsp-client: полный цикл — initialize, диагностика, запросы, stop', async () => {
    const diagnosticsEvents = [];
    const notifications = [];
    const states = [];
    const client = createClient({
        onDiagnostics: (params) => diagnosticsEvents.push(params),
        onNotification: (method, params) => notifications.push({ method, params }),
        onStateChange: (state, detail) => states.push({ state, detail }),
    });

    try {
        assert.equal(await client.start(), true);
        assert.equal(client.state, 'running');
        assert.equal(client.isRunning, true);
        assert.equal(client.capabilities.completionProvider.triggerCharacters[0], '.');
        assert.equal(client.serverInfo.name, 'fake-latent-lsp');

        client.openDocument(URI, 'fn main() -> int { return 0; }', { version: 1 });
        await waitFor(() => diagnosticsEvents.length >= 1, 5000, 'diagnostics после didOpen');
        assert.equal(diagnosticsEvents[0].uri, URI);
        assert.equal(diagnosticsEvents[0].diagnostics.length, 0);

        client.changeDocument(URI, 2, 'fn main() -> int { ERROR }');
        await waitFor(() => diagnosticsEvents.some((event) => event.diagnostics.length === 1),
            5000, 'диагностика после didChange');
        await waitFor(() => notifications.some((item) => item.params
            && item.params.message === 'incremental-change'), 5000, 'инкрементальный didChange');
        const errorEvent = diagnosticsEvents.find((event) => event.diagnostics.length === 1);
        assert.equal(errorEvent.diagnostics[0].message, 'Тестовая ошибка');
        assert.equal(errorEvent.diagnostics[0].severity, 1);

        const completion = await client.completion(URI, { line: 0, character: 0 });
        assert.equal(completion.items.length, 2);
        assert.equal(completion.items[0].label, 'print');
        assert.equal(completion.items[0].insertTextFormat, 2);

        const hover = await client.hover(URI, { line: 0, character: 0 });
        assert.match(hover.contents.value, /print/u);

        const signature = await client.signatureHelp(URI, { line: 0, character: 3 });
        assert.equal(signature.signatures[0].label, 'fn f(a: int)');
        assert.equal(signature.activeParameter, 0);

        const edits = await client.formatting(URI, { tabSize: 2, insertSpaces: true });
        assert.equal(edits.length, 1);
        assert.equal(edits[0].newText, 'fn');

        const symbols = await client.documentSymbols(URI);
        assert.equal(symbols[0].name, 'main');

        const definition = await client.definition(URI, { line: 0, character: 1 });
        assert.equal(definition.uri, URI);

        client.saveDocument(URI, 'fn main() {}');
        await waitFor(() => diagnosticsEvents.some((event) => event.diagnostics.length === 1
            && event.diagnostics[0].severity === 2), 5000, 'диагностика после didSave');

        const beforeClose = diagnosticsEvents.length;
        client.closeDocument(URI);
        await waitFor(() => diagnosticsEvents.slice(beforeClose).some((event) => event.diagnostics.length === 0
            && event.uri === URI), 5000, 'очистка диагностики после didClose');

        await client.stop();
        assert.equal(client.isRunning, false);
        assert.equal(client.state, 'stopped');
        assert.ok(states.some((item) => item.state === 'running'));
        assert.ok(states.some((item) => item.state === 'starting'));
        assert.ok(states.some((item) => item.state === 'stopped'));
        assert.ok(notifications.some((item) => item.method === 'window/logMessage'));
        assert.match(client.stateLabel, /выключен|остановлен/u);

        await assert.rejects(client.completion(URI, { line: 0, character: 0 }), /не запущен|остановлен/u);
        assert.equal(client.notify('textDocument/didSave', {}), false);
    } finally {
        await client.stop();
    }
});

test('lsp-client: отсутствие сервера — graceful false без исключений', async () => {
    const states = [];
    const client = createClient({
        serverPath: path.join(os.tmpdir(), 'definitely-missing-lsp.mjs'),
        onStateChange: (state, detail) => states.push({ state, detail }),
    });
    try {
        assert.equal(await client.start(), false);
        assert.equal(client.state, 'missing');
        assert.match(client.lastError, /не найден/u);
        assert.match(client.stateLabel, /сервер не найден/u);
        assert.ok(states.some((item) => item.state === 'missing'));
        assert.equal(await client.restart(), false);
    } finally {
        await client.stop();
    }
});

test('lsp-client: падающий сервер — graceful false', async () => {
    const client = createClient({ serverPath: crashLsp, requestTimeout: 1000 });
    try {
        const started = await client.start();
        assert.equal(started, false);
        assert.ok(client.lastError.length > 0);
    } finally {
        await client.stop();
    }
});

test('lsp-client: restart поднимает сервер заново', async () => {
    const client = createClient();
    try {
        assert.equal(await client.start(), true);
        assert.equal(await client.restart(), true);
        assert.equal(client.state, 'running');
    } finally {
        await client.stop();
    }
});

test('lsp-client: таймаут запроса', async () => {
    const client = createClient({ requestTimeout: 5000 });
    try {
        assert.equal(await client.start(), true);
        await assert.rejects(client.request('test/noResponse', {}, 80), /Таймаут LSP-запроса/u);
        // После таймаута клиент остаётся работоспособным.
        const completion = await client.completion(URI, { line: 0, character: 0 });
        assert.equal(completion.items[0].label, 'print');
    } finally {
        await client.stop();
    }
});

test('lsp-client: битые пакеты логируются, но не ломают клиент', async () => {
    const logs = [];
    const client = createClient({ logger: (message) => logs.push(message) });
    try {
        assert.equal(await client.start(), true);
        const result = await client.request('test/garbage', {});
        assert.equal(result, null);
        await waitFor(() => logs.some((line) => line.includes('без Content-Length'))
            && logs.some((line) => line.includes('некорректный JSON')), 5000, 'логи о битых пакетах');
    } finally {
        await client.stop();
    }
});

test('lsp-client: отвечает на запрос workspace/configuration от сервера', async () => {
    const notifications = [];
    const client = createClient({
        env: { FAKE_LSP_REQUEST_CONFIG: '1' },
        onNotification: (method, params) => notifications.push({ method, params }),
    });
    try {
        assert.equal(await client.start(), true);
        await waitFor(() => notifications.some((item) => item.params
            && item.params.message === 'config-received'), 5000, 'ответ на configuration');
    } finally {
        await client.stop();
    }
});

test('lsp-client: исключения в колбэках не ломают клиент', async () => {
    const logs = [];
    const client = createClient({
        logger: (message) => logs.push(message),
        onDiagnostics: () => { throw new Error('diagnostics boom'); },
        onNotification: () => { throw new Error('notification boom'); },
        onStateChange: () => { throw new Error('state boom'); },
    });
    try {
        // onStateChange бросает — start всё равно должен пройти.
        assert.equal(await client.start(), true);
        client.openDocument(URI, 'ERROR', { version: 1 });
        await waitFor(() => logs.some((line) => line.includes('diagnostics boom')), 5000, 'лог diagnostics');
    } finally {
        await client.stop();
    }

    const missingStates = [];
    const missing = createClient({
        serverPath: path.join(os.tmpdir(), 'no-such-server.mjs'),
        onStateChange: (state) => { missingStates.push(state); throw new Error('state boom'); },
    });
    assert.equal(await missing.start(), false);
    assert.deepEqual(missingStates, ['missing']);
});

test('lsp-client: stop без запуска и повторный dispose безопасны', async () => {
    const client = createClient();
    await client.stop();
    assert.equal(client.state, 'stopped');
    await client.dispose();
    await client.stop();
    assert.equal(client.notify('initialized', {}), false);
    await assert.rejects(client.request('initialize', {}), /не запущен/u);
    assert.throws(() => client._send({ jsonrpc: '2.0', method: 'x' }), /не запущен/u);
});

test('lsp-client: ошибка JSON-RPC и неизвестный id', async () => {
    const client = createClient();
    try {
        assert.equal(await client.start(), true);
        await assert.rejects(client.request('test/error', {}), /Тестовая ошибка сервера/u);
        assert.equal(await client.request('test/unknownResponse', {}), null);
    } finally {
        await client.stop();
    }
});

test('lsp-client: сбой записи в stdin не роняет notify/request', async () => {
    const client = createClient();
    // Подменяем процесс на «живой» объект, но _send намеренно бросает.
    client.child = { stdin: { writable: true, destroyed: false, end() {} }, kill() {} };
    const originalSend = client._send.bind(client);
    client._send = () => { throw new Error('boom'); };
    assert.equal(client.notify('test', {}), false);
    await assert.rejects(client.request('test', {}), /boom/u);
    client._send = originalSend;
    await client.stop();
    assert.equal(client.state, 'stopped');
});

test('lsp-client: ошибка остановки сервера не мешает stop', async () => {
    const client = createClient();
    client.child = {
        stdin: { writable: true, destroyed: false, end() {} },
        kill() {},
    };
    client.state = 'running';
    client.request = async () => { throw new Error('shutdown timeout'); };
    client.notify = () => { throw new Error('notify boom'); };
    await client.stop();
    assert.equal(client.state, 'stopped');
    assert.equal(client.child, null);
});

test('lsp-client: serverExists устойчив к ошибкам fs', () => {
    const original = fs.existsSync;
    fs.existsSync = () => { throw new Error('EACCES'); };
    try {
        assert.equal(serverExists('C:/secret/server.mjs'), false);
    } finally {
        fs.existsSync = original;
    }
});

test('lsp-client: ошибка spawn (неисполняемый файл) — graceful false', async () => {
    const dir = path.join(os.tmpdir(), `latent-bad-server-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    const badServer = path.join(dir, 'server.exe');
    fs.writeFileSync(badServer, 'not an executable');
    const logs = [];
    const client = createClient({ serverPath: badServer, logger: (message) => logs.push(message) });
    try {
        assert.equal(await client.start(), false);
        assert.ok(client.lastError.length > 0);
    } finally {
        await client.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
