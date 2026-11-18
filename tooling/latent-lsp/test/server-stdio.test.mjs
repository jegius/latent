// tooling/latent-lsp/test/server-stdio.test.mjs — e2e: настоящий дочерний
// процесс bin/server.mjs, JSON-RPC 2.0 поверх stdio с Content-Length.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { SERVER_BIN, REPO_ROOT, LspClient, waitForExit } from './helpers.mjs';

const URI = 'file:///e2e.lat';
const BROKEN = 'fn main() {\n    let x = ;\n}\n';
const VALID = 'fn main() -> int {\n    let x = 1;\n    return x;\n}\n';

/**
 * Запускает сервер, гарантированно убивая процесс после теста.
 * @param {import('node:test').TestContext} t
 * @param {string[]} [args]
 */
function spawnServer(t, args = ['--stdio']) {
    const client = LspClient.spawn(args);
    t.after(() => client.kill());
    return client;
}

test('stdio: initialize → возможности → shutdown/exit (код 0)', async (t) => {
    const client = spawnServer(t);
    const init = await client.initialize();
    assert.equal(init.jsonrpc, '2.0');
    assert.equal(init.id, 1);
    assert.equal(init.error, undefined);
    assert.equal(init.result.serverInfo.name, 'latent-lsp');
    assert.equal(init.result.capabilities.textDocumentSync.change, 2);
    assert.deepEqual(init.result.capabilities.completionProvider.triggerCharacters, ['.', ':']);

    const code = await client.shutdown();
    assert.equal(code, 0, 'exit после shutdown → код 0');
});

test('stdio: didOpen/didChange, диагностика и incremental sync', async (t) => {
    const client = spawnServer(t);
    await client.initialize();

    client.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text: BROKEN },
    });
    const broken = await client.waitForNotification('textDocument/publishDiagnostics',
        (params) => params.uri === URI && params.diagnostics.length > 0);
    assert.equal(broken.diagnostics[0].range.start.line, 1);
    assert.match(broken.diagnostics[0].message, /на строке 2:/);

    // Чиним код инкрементальной правкой: вставляем "1" после "=".
    client.notify('textDocument/didChange', {
        textDocument: { uri: URI, version: 2 },
        contentChanges: [{
            range: { start: { line: 1, character: 12 }, end: { line: 1, character: 12 } },
            text: '1',
        }],
    });
    const fixed = await client.waitForNotification('textDocument/publishDiagnostics',
        (params) => params.uri === URI && params.version === 2);
    assert.deepEqual(fixed.diagnostics, []);

    // Полная замена и снова ошибка.
    client.notify('textDocument/didChange', {
        textDocument: { uri: URI, version: 3 },
        contentChanges: [{ text: BROKEN }],
    });
    const again = await client.waitForNotification('textDocument/publishDiagnostics',
        (params) => params.uri === URI && params.version === 3);
    assert.equal(again.diagnostics.length, 1);

    const code = await client.shutdown();
    assert.equal(code, 0);
});

test('stdio: completion, hover, signatureHelp, formatting, symbols, definition', async (t) => {
    const client = spawnServer(t);
    await client.initialize();
    // Специально неотформатированный код: formatting должен вернуть правку.
    const text = 'fn add(a: int, b: int) -> int {\nreturn a + b;\n}\n\nfn main() -> int {\nlet v = add(1, 2);\nprint(v);\nreturn v;\n}\n';
    client.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text },
    });
    await client.waitForNotification('textDocument/publishDiagnostics', (p) => p.uri === URI);

    const completion = await client.request(10, 'textDocument/completion', {
        textDocument: { uri: URI },
        position: { line: 6, character: 3 },
    });
    assert.ok(completion.result.items.some((i) => i.label === 'print'));

    const hover = await client.request(11, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 5, character: 4 },
    });
    assert.match(hover.result.contents.value, /переменная/);

    const help = await client.request(12, 'textDocument/signatureHelp', {
        textDocument: { uri: URI },
        position: { line: 5, character: 16 },
    });
    assert.equal(help.result.activeParameter, 1);
    assert.match(help.result.signatures[0].label, /add/);

    const formatting = await client.request(13, 'textDocument/formatting', {
        textDocument: { uri: URI },
        options: { tabSize: 4, insertSpaces: true },
    });
    assert.equal(formatting.result.length, 1);
    assert.ok(formatting.result[0].newText.includes('    return a + b;'));

    const symbols = await client.request(14, 'textDocument/documentSymbol', {
        textDocument: { uri: URI },
    });
    assert.deepEqual(symbols.result.map((s) => s.name), ['add', 'main']);

    const definition = await client.request(15, 'textDocument/definition', {
        textDocument: { uri: URI },
        position: { line: 5, character: 9 },
    });
    assert.equal(definition.result.uri, URI);
    assert.deepEqual(definition.result.range.start, { line: 0, character: 3 });

    const code = await client.shutdown();
    assert.equal(code, 0);
});

test('stdio: неизвестный метод → MethodNotFound; запрос до initialize → -32002', async (t) => {
    const client = spawnServer(t);
    const early = await client.request(1, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 0, character: 0 },
    });
    assert.equal(early.error.code, -32002);

    const init = await client.initialize();
    assert.ok(init.result);

    const unknown = await client.request(2, 'textDocument/unknownMethod', {});
    assert.equal(unknown.error.code, -32601);

    const code = await client.shutdown();
    assert.equal(code, 0);
});

test('stdio: $/cancelRequest отменяет запрос (-32800)', async (t) => {
    const client = spawnServer(t);
    await client.initialize();
    client.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text: VALID },
    });
    client.notify('$/cancelRequest', { id: 50 });
    const response = await client.request(50, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 1, character: 5 },
    });
    assert.equal(response.error.code, -32800);
    const code = await client.shutdown();
    assert.equal(code, 0);
});

test('stdio: exit без shutdown → код 1', async (t) => {
    const client = spawnServer(t);
    await client.initialize();
    client.notify('exit', null);
    try {
        client.child.stdin.end();
    } catch (e) { /* already closed */ }
    const code = await waitForExit(client.child);
    assert.equal(code, 1);
});

test('stdio: без compiler.wasm сервер работает без диагностики (graceful)', async (t) => {
    const missing = path.join(REPO_ROOT, 'web-ide', 'no-such-compiler.wasm');
    const client = spawnServer(t, ['--stdio', '--compiler-wasm', missing]);
    await client.initialize();
    client.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text: BROKEN },
    });
    const published = await client.waitForNotification('textDocument/publishDiagnostics',
        (params) => params.uri === URI);
    assert.deepEqual(published.diagnostics, [], 'диагностика пуста без компилятора');

    const hover = await client.request(20, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 0, character: 4 },
    });
    assert.ok(hover.result, 'hover обязан работать без wasm');

    const code = await client.shutdown();
    assert.equal(code, 0);
    assert.match(client.stderr, /Диагностика отключена/);
});

test('stdio: --log пишет лог в файл, stdout остаётся протоколом', async (t) => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const logPath = path.join(os.tmpdir(), `latent-lsp-${process.pid}-${Date.now()}.log`);
    const client = spawnServer(t, ['--stdio', '--log', logPath]);
    await client.initialize();
    await client.request(30, 'textDocument/hover', {
        textDocument: { uri: 'file:///none.lat' },
        position: { line: 0, character: 0 },
    });
    const code = await client.shutdown();
    assert.equal(code, 0);
    assert.ok(fs.existsSync(logPath), 'файл лога должен существовать');
    const log = fs.readFileSync(logPath, 'utf8');
    assert.match(log, /initialize/);
    fs.unlinkSync(logPath);
});

// --- CLI (без интерактивного протокола) ------------------------------------

/**
 * Запускает bin/server.mjs и собирает вывод.
 * @param {string[]} args
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
function runCli(args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [SERVER_BIN, ...args], {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });
}

test('cli: без --stdio → код 2 и подсказка', async () => {
    const result = await runCli([]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--stdio/);
});

test('cli: --help → код 0 и справка', async () => {
    const result = await runCli(['--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /latent-lsp/);
    assert.match(result.stdout, /--compiler-wasm/);
});

test('cli: --version → версия сервера', async () => {
    const result = await runCli(['--version']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /latent-lsp \d+\.\d+\.\d+/);
});

test('cli: неизвестная опция → код 2', async () => {
    const result = await runCli(['--stdio', '--nope']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /неизвестная опция/);
});
