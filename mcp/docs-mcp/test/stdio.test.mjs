// stdio.test.mjs — интеграционные тесты stdio-транспорта через реальный процесс.
//
// Проверяем Content-Length-фрейминг, NDJSON, EOF, порядок ответов, завершение
// по exit, а также флаги CLI (--help/--version/некорректные аргументы).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES_DOCS, SERVER_BIN, createFixtureCore, createStdioClient } from './helpers.mjs';
import { createCore } from '../src/core.mjs';
import { REPO_ROOT, resolveWasmPath } from '../src/paths.mjs';
import { startStdio } from '../src/stdio.mjs';

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

// --- unit-тесты stdio-транспорта на фейковых потоках -----------------------
//
// Реальный процесс проверяет «счастливый путь». Здесь — частичные чанки,
// битый фрейминг, ошибки парсинга/записи и завершение по exit/EOF.

/**
 * Создаёт фейковый stdin (EventEmitter с pause).
 * @param {{pauseThrows?: boolean}} [options]
 * @returns {EventEmitter & {pause: Function}}
 */
function fakeStdin(options = {}) {
    const stdin = new EventEmitter();
    stdin.pause = () => {
        if (options.pauseThrows) throw new Error('stdin уже закрыт');
    };
    return stdin;
}

/**
 * Создаёт фейковый stdout, собирающий записанные байты.
 * @param {{writeThrows?: boolean, noWrite?: boolean}} [options]
 * @returns {object}
 */
function fakeStdout(options = {}) {
    const chunks = [];
    const sink = {
        chunks,
        writes: 0,
        write(chunk, callback) {
            sink.writes += 1;
            if (options.writeThrows) throw new Error('EPIPE');
            if (chunk && chunk.length > 0) chunks.push(Buffer.from(chunk));
            if (typeof callback === 'function') callback();
            return true;
        },
        text() {
            return Buffer.concat(chunks).toString('utf8');
        },
    };
    if (options.noWrite) delete sink.write;
    return sink;
}

/**
 * Разбирает Content-Length-фреймы из вывода.
 * @param {string} text
 * @returns {object[]}
 */
function parseFrames(text) {
    const buffer = Buffer.from(text, 'utf8');
    const messages = [];
    let offset = 0;
    while (offset < buffer.length) {
        const separator = buffer.indexOf('\r\n\r\n', offset);
        if (separator === -1) break;
        const header = buffer.slice(offset, separator).toString('utf8');
        const match = /content-length:\s*(\d+)/i.exec(header);
        if (!match) break;
        const length = Number(match[1]);
        const start = separator + 4;
        if (buffer.length < start + length) break;
        messages.push(JSON.parse(buffer.slice(start, start + length).toString('utf8')));
        offset = start + length;
    }
    return messages;
}

/**
 * Ждёт, пока условие станет истинным (очередь stdio асинхронна).
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 */
async function waitUntil(predicate, timeoutMs = 2000) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error('условие не выполнено за отведённое время');
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * Поднимает stdio-транспорт на фейковых потоках.
 * @param {{onExit?: Function, exitOnEof?: boolean, core?: object, stdinOptions?: object, stdoutOptions?: object}} [options]
 * @returns {{handle: object, stdin: object, stdout: object, errors: any[], exits: number[]}}
 */
function startFakeStdio(options = {}) {
    const stdin = fakeStdin(options.stdinOptions);
    const stdout = fakeStdout(options.stdoutOptions);
    const errors = [];
    const exits = [];
    let handle;
    const stdioOptions = {
        stdin,
        stdout,
        logger: { error: (...args) => errors.push(args) },
        exitOnEof: options.exitOnEof === true,
        onExit: options.onExit || (() => exits.push(1)),
    };
    if (options.core) {
        handle = startStdio(options.core, stdioOptions);
    } else {
        const hooks = {};
        const core = createCore({
            docsRoot: FIXTURES_DOCS,
            repoRoot: REPO_ROOT,
            wasmPath: resolveWasmPath({ repoRoot: REPO_ROOT }),
            hooks,
        });
        handle = startStdio(core, stdioOptions);
        // Как в bin/server.mjs: уведомление exit просит транспорт завершиться.
        hooks.onExit = () => handle.requestExit();
    }
    return { handle, stdin, stdout, errors, exits };
}

/**
 * Кодирует сообщение как Content-Length-фрейм.
 * @param {unknown} message
 * @returns {string}
 */
function frame(message) {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    return `Content-Length: ${payload.length}\r\n\r\n${payload.toString('utf8')}`;
}

test('stdio unit: частичные чанки заголовка и тела собираются в сообщение', async () => {
    const { handle, stdin, stdout } = startFakeStdio();
    try {
        const text = frame({ jsonrpc: '2.0', id: 1, method: 'ping' });
        stdin.emit('data', Buffer.from(text.slice(0, 10)));
        stdin.emit('data', Buffer.from(text.slice(10, 22)));
        stdin.emit('data', Buffer.from(text.slice(22)));
        await waitUntil(() => stdout.chunks.length > 0);
        const messages = parseFrames(stdout.text());
        assert.equal(messages.length, 1);
        assert.deepEqual(messages[0], { jsonrpc: '2.0', id: 1, result: {} });
    } finally {
        handle.close();
    }
});

test('stdio unit: разделитель LF LF и NDJSON, разбитый между чанками', async () => {
    const { handle, stdin, stdout } = startFakeStdio();
    try {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' });
        stdin.emit('data', Buffer.from(`Content-Length: ${Buffer.byteLength(payload)}\n\n${payload}`));
        await waitUntil(() => stdout.chunks.length > 0);
        assert.equal(parseFrames(stdout.text())[0].id, 2);

        const line = `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' })}\n`;
        stdin.emit('data', Buffer.from(line.slice(0, 5)));
        stdin.emit('data', Buffer.from(line.slice(5)));
        await waitUntil(() => stdout.chunks.length > 1);
        assert.equal(parseFrames(stdout.text())[1].id, 3);
    } finally {
        handle.close();
    }
});

test('stdio unit: чанк из одних пробелов сбрасывается, следующий NDJSON обрабатывается', async () => {
    const { handle, stdin, stdout } = startFakeStdio();
    try {
        stdin.emit('data', Buffer.from('   \r\n\t'));
        stdin.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'ping' })}\n`));
        await waitUntil(() => stdout.chunks.length > 0);
        assert.equal(parseFrames(stdout.text())[0].id, 4);
    } finally {
        handle.close();
    }
});

test('stdio unit: отсутствующий Content-Length и огромный Content-Length — ошибки фрейминга', async () => {
    const { handle, stdin, stdout } = startFakeStdio();
    try {
        stdin.emit('data', Buffer.from('X-Test: 1\r\n\r\n'));
        await waitUntil(() => stdout.chunks.length > 0);
        const missing = parseFrames(stdout.text())[0];
        assert.equal(missing.error.code, -32700);
        assert.match(missing.error.message, /отсутствует заголовок Content-Length/);

        stdin.emit('data', Buffer.from('Content-Length: 999999999\r\n\r\n'));
        await waitUntil(() => stdout.chunks.length > 1);
        const tooBig = parseFrames(stdout.text())[1];
        assert.equal(tooBig.error.code, -32700);
        assert.match(tooBig.error.message, /некорректный Content-Length: 999999999/);

        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 5, method: 'ping' })));
        await waitUntil(() => stdout.chunks.length > 2);
        assert.equal(parseFrames(stdout.text())[2].id, 5, 'после ошибок транспорт остаётся рабочим');
    } finally {
        handle.close();
    }
});

test('stdio unit: битый JSON во фрейме и ошибка ядра дают -32700 и -32603', async () => {
    const failingCore = {
        handlePayload: async () => {
            throw new Error('ядро сломано');
        },
    };
    const { handle, stdin, stdout, errors } = startFakeStdio({ core: failingCore });
    try {
        const bad = Buffer.from('{ не json', 'utf8');
        stdin.emit('data', Buffer.from(`Content-Length: ${bad.length}\r\n\r\n`));
        stdin.emit('data', bad);
        await waitUntil(() => stdout.chunks.length > 0);
        assert.match(parseFrames(stdout.text())[0].error.message, /Не удалось разобрать JSON-RPC/);

        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 6, method: 'ping' })));
        await waitUntil(() => stdout.chunks.length > 1);
        const internal = parseFrames(stdout.text())[1];
        assert.equal(internal.id, null);
        assert.equal(internal.error.code, -32603);
        assert.equal(errors.length, 1, 'ошибка ядра должна логироваться');
    } finally {
        handle.close();
    }
});

test('stdio unit: ошибка записи в stdout не роняет транспорт', async () => {
    const { handle, stdin, errors } = startFakeStdio({ stdoutOptions: { writeThrows: true } });
    try {
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 7, method: 'ping' })));
        await waitUntil(() => errors.length >= 1);
        assert.match(String(errors[0][0]), /не удалось записать ответ в stdout/);
        assert.equal(handle.isClosed(), false);
    } finally {
        handle.close();
    }
});

test('stdio unit: exit завершает транспорт, late-сообщения игнорируются', async () => {
    const { handle, stdin, stdout, exits } = startFakeStdio();
    try {
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', method: 'exit' })));
        await waitUntil(() => exits.length === 1);
        assert.equal(handle.isClosed(), true);
        assert.equal(stdout.text(), '', 'уведомление exit не имеет ответа');
        const before = stdout.chunks.length;
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 8, method: 'ping' })));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(stdout.chunks.length, before, 'после close данные не обрабатываются');
    } finally {
        handle.close();
    }
});

test('stdio unit: writeMessage после exit всё ещё пишет (exitRequested)', async () => {
    const { handle, stdout, exits } = startFakeStdio();
    try {
        handle.requestExit();
        await waitUntil(() => exits.length === 1);
        handle.writeMessage({ jsonrpc: '2.0', id: 9, result: {} });
        const messages = parseFrames(stdout.text());
        assert.equal(messages.at(-1).id, 9);
    } finally {
        handle.close();
    }
});

test('stdio unit: requestExit ждёт обработки очереди', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slowCore = {
        handlePayload: async (payload) => {
            await gate;
            return { jsonrpc: '2.0', id: payload.id, result: {} };
        },
    };
    const { handle, stdin, stdout, exits } = startFakeStdio({ core: slowCore });
    try {
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 10, method: 'ping' })));
        handle.requestExit();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(exits.length, 0, 'exit не должен происходить до слива очереди');
        release();
        await waitUntil(() => exits.length === 1);
        assert.equal(parseFrames(stdout.text()).at(-1).id, 10);
    } finally {
        handle.close();
    }
});

test('stdio unit: EOF дообрабатывает NDJSON без перевода строки и не завершает при exitOnEof=false', async () => {
    const { handle, stdin, stdout, exits } = startFakeStdio({ exitOnEof: false });
    try {
        stdin.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' })));
        stdin.emit('end');
        await waitUntil(() => stdout.chunks.length > 0);
        assert.equal(parseFrames(stdout.text())[0].id, 11);
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(exits.length, 0);
        assert.equal(handle.isClosed(), true);
    } finally {
        handle.close();
    }
});

test('stdio unit: EOF с мусором в буфере не пытается его парсить', async () => {
    const { handle, stdin, stdout, exits } = startFakeStdio({ exitOnEof: true });
    try {
        stdin.emit('data', Buffer.from('не json в конце'));
        stdin.emit('end');
        await waitUntil(() => exits.length === 1);
        assert.equal(stdout.chunks.length, 0);
    } finally {
        handle.close();
    }
});

test('stdio unit: close() снимает обработчики и идемпотентен, pause-ошибка подавляется', async () => {
    const { handle, stdin, stdout } = startFakeStdio({ stdinOptions: { pauseThrows: true } });
    assert.equal(handle.isClosed(), false);
    handle.close();
    assert.equal(handle.isClosed(), true);
    handle.close();
    handle.writeMessage({ jsonrpc: '2.0', id: 12, result: {} });
    assert.equal(stdout.chunks.length, 0, 'closed без exitRequested не пишет');
    stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 13, method: 'ping' })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(stdout.chunks.length, 0);
});

test('stdio unit: ошибка stdin логируется, но транспорт продолжает работу', async () => {
    const { handle, stdin, errors } = startFakeStdio();
    try {
        stdin.emit('error', new Error('EIO'));
        await waitUntil(() => errors.length >= 1);
        assert.match(String(errors[0][0]), /ошибка stdin/);
        assert.equal(handle.isClosed(), false);
    } finally {
        handle.close();
    }
});

test('stdio unit: end после close игнорируется', async () => {
    const { handle, stdin } = startFakeStdio({ exitOnEof: true });
    handle.close();
    stdin.emit('end');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(handle.isClosed(), true);
});

test('stdio unit: без logger используется console по умолчанию', async () => {
    const stdin = fakeStdin();
    const stdout = fakeStdout();
    const handle = startStdio(createCore({
        docsRoot: FIXTURES_DOCS,
        repoRoot: REPO_ROOT,
        wasmPath: resolveWasmPath({ repoRoot: REPO_ROOT }),
        hooks: {},
    }), { stdin, stdout });
    try {
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', id: 14, method: 'ping' })));
        await waitUntil(() => stdout.chunks.length > 0);
        assert.equal(parseFrames(stdout.text())[0].id, 14);
    } finally {
        handle.close();
    }
});

test('stdio unit: finish через exit с брошенным pause не падает', async () => {
    const { handle, stdin, exits } = startFakeStdio({ stdinOptions: { pauseThrows: true } });
    try {
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', method: 'exit' })));
        await waitUntil(() => exits.length === 1);
        assert.equal(handle.isClosed(), true);
    } finally {
        handle.close();
    }
});

test('stdio unit: stdout без write завершает транспорт синхронно', async () => {
    const { handle, stdin, exits } = startFakeStdio({ stdoutOptions: { noWrite: true } });
    try {
        stdin.emit('data', Buffer.from(frame({ jsonrpc: '2.0', method: 'exit' })));
        await waitUntil(() => exits.length === 1);
        assert.equal(handle.isClosed(), true);
    } finally {
        handle.close();
    }
});

test('stdio unit: без onExit вызывается process.exit(0)', async () => {
    const originalExit = process.exit;
    const codes = [];
    process.exit = (code) => { codes.push(code); };
    const stdin = fakeStdin();
    const handle = startStdio(createFixtureCore(), {
        stdin,
        stdout: { write: undefined },
        logger: { error() {} },
    });
    try {
        handle.requestExit();
        assert.deepEqual(codes, [0]);
    } finally {
        process.exit = originalExit;
        handle.close();
    }
});

test('CLI: некорректный порт и флаг без значения — код 2', async () => {
    const badPort = await runCli(['--http', '--port', 'не-число']);
    assert.equal(badPort.code, 2);
    assert.match(badPort.stderr, /Некорректный порт/);

    const missingValue = await runCli(['--http', '--port']);
    assert.equal(missingValue.code, 2);
    assert.match(missingValue.stderr, /требует значения/);

    const unknown = await runCli(['--stdio', '--nope']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /Неизвестный аргумент/);
});

test('CLI: -h и -v работают как длинные флаги', async () => {
    const help = await runCli(['-h']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Использование/);

    const version = await runCli(['-v']);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /latent-docs \d+\.\d+\.\d+/);
});

test('CLI: отсутствующий каталог документации — предупреждение, но сервер работает', async () => {
    const missing = path.join(os.tmpdir(), 'latent-docs-cli-missing-xyz');
    const result = await runCli(['--stdio', '--docs', missing], { stdin: '' });
    assert.equal(result.code, 0);
    assert.match(result.stderr, /предупреждение/);
    assert.match(result.stderr, /не найден/);
    assert.match(result.stderr, /документов: 0/);
});

test('CLI: --http --stateless не требует initialize', async () => {
    const child = spawn(process.execPath, [
        SERVER_BIN, '--http', '--port', '0', '--stateless', '--docs', FIXTURES_DOCS,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    try {
        const started = Date.now();
        let url = '';
        while (Date.now() - started < 10000) {
            const match = stdout.match(/url:\s+(http:\/\/\S+\/mcp)/);
            if (match) { url = match[1]; break; }
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (child.exitCode !== null) break;
        }
        assert.ok(url, `нет URL: ${stdout}`);
        assert.match(stdout, /stateless/);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.result.tools.length, 6);
    } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
            if (child.exitCode !== null) { resolve(); return; }
            child.once('exit', resolve);
            setTimeout(resolve, 3000).unref?.();
        });
    }
});
