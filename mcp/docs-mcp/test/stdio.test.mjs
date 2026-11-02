// stdio.test.mjs — интеграционные тесты stdio-транспорта через реальный процесс.
//
// Проверяем Content-Length-фрейминг, NDJSON, EOF, порядок ответов, завершение
// по exit, а также флаги CLI (--help/--version/некорректные аргументы).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { FIXTURES_DOCS, SERVER_BIN, createStdioClient } from './helpers.mjs';

/**
 * Запускает CLI с произвольными аргументами и собирает вывод.
 * @param {string[]} args
 * @param {{stdin?: string}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runCli(args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SERVER_BIN, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        if (options.stdin !== undefined) child.stdin.write(options.stdin);
        child.stdin.end();
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`CLI не завершился: ${stdout} ${stderr}`));
        }, 10000);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 0, stdout, stderr });
        });
        child.on('error', reject);
    });
}

/** Параметры initialize. */
const INIT_PARAMS = {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'stdio-test', version: '0.0.0' },
};

test('stdio: Content-Length обмен — initialize, ping, tools/list, shutdown, exit', { timeout: 20000 }, async (t) => {
    const client = createStdioClient({ args: ['--docs', FIXTURES_DOCS] });
    t.after(() => client.kill());

    client.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT_PARAMS });
    const initialize = await client.waitForId(1);
    assert.equal(initialize.result.serverInfo.name, 'latent-docs');
    assert.equal(initialize.result.protocolVersion, '2025-06-18');

    client.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    const ping = await client.waitForId(2);
    assert.deepEqual(ping.result, {});

    client.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = await client.waitForId(3);
    assert.equal(tools.result.tools.length, 6);

    client.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_docs', arguments: {} } });
    const docs = await client.waitForId(4);
    assert.equal(docs.result.structuredContent.docs.length, 9);
    assert.ok(docs.result.structuredContent.docs.some((doc) => doc.path === 'guide/variables.md'));

    client.send({ jsonrpc: '2.0', id: 5, method: 'shutdown' });
    const shutdown = await client.waitForId(5);
    assert.equal(shutdown.result, null);

    client.send({ jsonrpc: '2.0', method: 'exit' });
    const code = await client.waitForExit();
    assert.equal(code, 0);
    assert.match(client.getStderr(), /stdio/);
});

test('stdio: NDJSON-формат (одно сообщение на строку)', { timeout: 20000 }, async (t) => {
    const client = createStdioClient({ args: ['--docs', FIXTURES_DOCS] });
    t.after(() => client.kill());

    client.sendRaw(`${JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' })}\n`);
    const ping = await client.waitForId(10);
    assert.deepEqual(ping.result, {});

    client.sendRaw(`${JSON.stringify({ jsonrpc: '2.0', method: 'exit' })}\n`);
    const code = await client.waitForExit();
    assert.equal(code, 0);
});

test('stdio: закрытие stdin (EOF) завершает процесс с кодом 0', { timeout: 20000 }, async (t) => {
    const client = createStdioClient({ args: ['--docs', FIXTURES_DOCS] });
    t.after(() => client.kill());

    const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Нет exit. stderr: ${client.getStderr()}`)), 10000);
        client.child.once('exit', (code) => {
            clearTimeout(timer);
            resolve(code ?? 0);
        });
    });
    client.child.stdin.end();
    assert.equal(await result, 0);
});

test('stdio: exit не ждёт дополнительных сообщений', { timeout: 20000 }, async (t) => {
    const client = createStdioClient({ args: ['--docs', FIXTURES_DOCS] });
    t.after(() => client.kill());

    client.send({ jsonrpc: '2.0', method: 'exit' });
    const code = await client.waitForExit();
    assert.equal(code, 0);
});

test('CLI --help печатает справку и завершается с 0', async () => {
    const result = await runCli(['--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /--stdio/);
    assert.match(result.stdout, /--http/);
    assert.match(result.stdout, /--stateless/);
    assert.match(result.stdout, /--docs/);
});

test('CLI --version печатает версию', async () => {
    const result = await runCli(['--version']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /latent-docs \d+\.\d+\.\d+/);
});

test('CLI без транспорта — ошибка и код 1', async () => {
    const result = await runCli([]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--stdio|--http/);
});

test('CLI с неизвестным аргументом — код 2', async () => {
    const result = await runCli(['--stdio', '--unknown-flag']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Неизвестный аргумент/);
});

test('CLI --http на порту 0 печатает реальный URL и корректно завершается по stdin EOF', async () => {
    const child = spawn(process.execPath, [SERVER_BIN, '--http', '--port', '0', '--docs', FIXTURES_DOCS], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    /** @type {string} */
    let url = '';
    const started = Date.now();
    while (Date.now() - started < 10000) {
        const match = stdout.match(/url:\s+(http:\/\/\S+\/mcp)/);
        if (match) {
            url = match[1];
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (child.exitCode !== null) break;
    }

    try {
        assert.ok(url, `сервер не напечатал URL. stdout: ${stdout} stderr: ${stderr}`);
        const sessionResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT_PARAMS }),
        });
        assert.equal(sessionResponse.status, 200);
        const healthUrl = url.replace(/\/mcp$/, '/health');
        const health = await (await fetch(healthUrl)).json();
        assert.equal(health.status, 'ok');
        assert.equal(health.docs.count, 9);

        child.kill('SIGTERM');
        const code = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Сервер не остановился по SIGTERM')), 10000);
            child.once('exit', (exitCode) => {
                clearTimeout(timer);
                resolve(exitCode ?? 0);
            });
        });
        assert.equal(code, 0);
    } finally {
        if (child.exitCode === null) child.kill();
    }
});
