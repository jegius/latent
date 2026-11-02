// tooling/latent-lsp/test/main.test.mjs — точка входа stdio-сервера:
// обработка ошибок запуска (нет/битые language data), битых кадров JSON-RPC
// и ошибок stdin. Проверяется через runStdioServer с подставными потоками,
// без дочернего процесса.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { runStdioServer } from '../src/main.mjs';

/** Подставные stdin/stdout/stderr с накоплением вывода. */
function makeStreams() {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = { out: '', err: '' };
    stdout.on('data', (chunk) => { captured.out += chunk.toString('utf8'); });
    stderr.on('data', (chunk) => { captured.err += chunk.toString('utf8'); });
    return { stdin, stdout, stderr, captured };
}

test('main: отсутствующий language data → код 1 и понятная ошибка', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'latent-lsp-main-'));
    const s = makeStreams();
    try {
        const result = await runStdioServer({
            argv: ['--stdio', '--language-data', join(dir, 'missing.json')],
            stdin: s.stdin,
            stdout: s.stdout,
            stderr: s.stderr,
        });
        assert.equal(result.code, 1);
        assert.match(s.captured.err, /language data/);
        s.stdin.end();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('main: битые кадры не роняют сервер, ошибки уходят в stdout, код 0', async () => {
    const s = makeStreams();
    let exited = null;
    const pending = runStdioServer({
        argv: ['--stdio'],
        stdin: s.stdin,
        stdout: s.stdout,
        stderr: s.stderr,
        exit: (code) => { exited = code; },
    });
    // 1) заголовок без Content-Length → frameError; 2) тело не JSON → parseError.
    s.stdin.write('Content-Length: abc\r\n\r\n');
    s.stdin.write('Content-Length: 9\r\n\r\n{"jsonrpc"');
    s.stdin.end();

    const result = await pending;
    assert.equal(result.code, 0);
    assert.equal(exited, 0, 'exit-колбэк получил код завершения');
    assert.equal((s.captured.out.match(/"code":-32700/g) ?? []).length, 2,
        'два ответа ParseError в stdout');
    assert.match(s.captured.err, /кадрирование/);
    assert.match(s.captured.err, /JSON/);
});

test('main: ошибка stdin → код 1', async () => {
    const s = makeStreams();
    const pending = runStdioServer({
        argv: ['--stdio'],
        stdin: s.stdin,
        stdout: s.stdout,
        stderr: s.stderr,
    });
    // runStdioServer сначала асинхронно грузит language data и compiler.wasm,
    // и только потом вешает обработчики stdin. Ждём регистрации 'error'.
    for (let i = 0; i < 200 && s.stdin.listenerCount('error') === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(s.stdin.listenerCount('error') > 0, 'сервер подписался на ошибки stdin');
    s.stdin.emit('error', new Error('boom'));

    const result = await pending;
    assert.equal(result.code, 1);
    assert.match(s.captured.err, /stdin: boom/);
});
