// infra.test.mjs — небольшие инфраструктурные модули: JSON-RPC, версия,
// пути, сессии Streamable HTTP, HTML-лендинг и HTTP-утилиты.
//
// Тесты проверяют защитные ветви (не-строки, отсутствующие файлы, истёкшие
// сессии, переполнение тела запроса), потому что эти ветви не встречаются в
// «счастливом пути» интеграционных тестов.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    ErrorCodes,
    RpcError,
    errorResponse,
    failure,
    invalidParams,
    invalidRequest,
    isNotification,
    isValidRequestShape,
    success,
} from '../src/jsonrpc.mjs';
import {
    defaultDocsRoot,
    exists,
    isFile,
    resolveRepoRoot,
    resolveWasmPath,
} from '../src/paths.mjs';
import { SessionStore } from '../src/sessions.mjs';
import { renderLanding } from '../src/landing.mjs';
import {
    MAX_BODY_BYTES,
    sendHtml,
    sendJson,
    sendMethodNotAllowed,
} from '../src/http-util.mjs';
import { REPO_ROOT } from '../src/paths.mjs';

/** Минимальный fake ServerResponse для проверки утилит без сети. */
function fakeResponse() {
    return {
        headersSent: false,
        writableEnded: false,
        status: null,
        headers: null,
        body: null,
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        end(body) {
            this.body = body;
            this.writableEnded = true;
        },
    };
}

test('jsonrpc: success подставляет null вместо отсутствующего id', () => {
    assert.deepEqual(success(undefined, { ok: true }), { jsonrpc: '2.0', id: null, result: { ok: true } });
    assert.deepEqual(success(0, 'x'), { jsonrpc: '2.0', id: 0, result: 'x' });
});

test('jsonrpc: failure включает data только когда оно задано', () => {
    const withData = failure(1, -1, 'err', { hint: 'x' });
    assert.deepEqual(withData.error, { code: -1, message: 'err', data: { hint: 'x' } });
    const withoutData = failure(1, -1, 'err');
    assert.deepEqual(withoutData.error, { code: -1, message: 'err' });
    assert.equal(Object.prototype.hasOwnProperty.call(withoutData.error, 'data'), false);
    assert.equal(failure(undefined, -1, 'err').id, null);
});

test('jsonrpc: errorResponse превращает RpcError и обычные ошибки в контракт', () => {
    const rpc = errorResponse(5, new RpcError(ErrorCodes.InvalidParams, 'плохо', { field: 'x' }));
    assert.equal(rpc.error.code, -32602);
    assert.deepEqual(rpc.error.data, { field: 'x' });

    const plain = errorResponse(6, new Error('сломалось'));
    assert.equal(plain.error.code, ErrorCodes.InternalError);
    assert.equal(plain.error.message, 'сломалось');

    const garbage = errorResponse(7, { message: 'строка-сообщение' });
    assert.equal(garbage.error.message, 'строка-сообщение');

    const empty = errorResponse(8, {});
    assert.equal(empty.error.message, 'Внутренняя ошибка сервера');

    const nullish = errorResponse(null, null);
    assert.equal(nullish.id, null);
    assert.equal(nullish.error.message, 'Внутренняя ошибка сервера');
});

test('jsonrpc: invalidParams и invalidRequest отдают код и подсказку', () => {
    const params = invalidParams('нужен uri');
    assert.equal(params.code, -32602);
    assert.equal(params.message, 'нужен uri');
    assert.equal(params.data, undefined);

    const fromNull = invalidRequest(null);
    assert.equal(fromNull.code, -32600);
    assert.equal(fromNull.data.received, 'null');
    const fromArray = invalidRequest([]);
    assert.equal(fromArray.data.received, 'object');
    const fromString = invalidRequest('x');
    assert.equal(fromString.data.received, 'string');
});

test('jsonrpc: isNotification отличает id:null от отсутствия id', () => {
    assert.equal(isNotification({ jsonrpc: '2.0', method: 'ping' }), true);
    assert.equal(isNotification({ jsonrpc: '2.0', id: null, method: 'ping' }), false);
    assert.equal(isNotification({ jsonrpc: '2.0', id: 1, method: 'ping' }), false);
    assert.equal(isNotification(null), false);
    assert.equal(isNotification('x'), false);
});

test('jsonrpc: isValidRequestShape проверяет объект и непустой method', () => {
    assert.equal(isValidRequestShape({ method: 'ping' }), true);
    assert.equal(isValidRequestShape({ method: '' }), false);
    assert.equal(isValidRequestShape({ method: 42 }), false);
    assert.equal(isValidRequestShape([]), false);
    assert.equal(isValidRequestShape(null), false);
    assert.equal(isValidRequestShape('ping'), false);
});

test('version: при недоступном package.json используется 0.0.0', async () => {
    const original = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
        if (String(file).endsWith('package.json')) throw new Error('EACCES');
        return original.call(this, file, ...rest);
    };
    try {
        const module = await import('../src/version.mjs?fallback=missing-package');
        assert.equal(module.SERVER_NAME, 'latent-docs');
        assert.equal(module.SERVER_VERSION, '0.0.0');
    } finally {
        fs.readFileSync = original;
    }
});

test('version: битый или пустой package.json не роняет сервер', async () => {
    const original = fs.readFileSync;
    for (const [query, content] of [
        ['broken-json', '{ not json'],
        ['empty-version', JSON.stringify({ version: '' })],
        ['no-version', JSON.stringify({ name: 'x' })],
        ['null-json', 'null'],
    ]) {
        fs.readFileSync = function patched(file, ...rest) {
            if (String(file).endsWith('package.json')) return content;
            return original.call(this, file, ...rest);
        };
        try {
            const module = await import(`../src/version.mjs?fallback=${query}`);
            assert.equal(module.SERVER_VERSION, '0.0.0', `случай ${query}`);
        } finally {
            fs.readFileSync = original;
        }
    }
});

test('paths: resolveRepoRoot разрешает относительный путь от cwd', () => {
    const resolved = resolveRepoRoot('relative-root');
    assert.equal(resolved, path.resolve('relative-root'));
    assert.equal(resolveRepoRoot(), REPO_ROOT);
});

test('paths: resolveWasmPath без repoRoot берёт корень репозитория', () => {
    const previous = process.env.LATENT_COMPILER_WASM;
    delete process.env.LATENT_COMPILER_WASM;
    try {
        assert.equal(resolveWasmPath(), path.join(REPO_ROOT, 'web-ide', 'compiler.wasm'));
        assert.equal(resolveWasmPath({ wasm: 'C:/custom/compiler.wasm' }), path.resolve('C:/custom/compiler.wasm'));
    } finally {
        if (previous !== undefined) process.env.LATENT_COMPILER_WASM = previous;
    }
});

test('paths: exists и isFile различают файл, каталог и отсутствие', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-paths-'));
    const file = path.join(root, 'file.txt');
    fs.writeFileSync(file, 'x', 'utf8');
    try {
        assert.equal(exists(root), true);
        assert.equal(exists(file), true);
        assert.equal(exists(path.join(root, 'missing')), false);
        assert.equal(isFile(file), true);
        assert.equal(isFile(root), false);
        assert.equal(isFile(path.join(root, 'missing')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('paths: defaultDocsRoot склеивает docs/docs', () => {
    assert.equal(defaultDocsRoot('/repo'), path.join('/repo', 'docs', 'docs'));
});

test('SessionStore: create заполняет метаданные и учитывает значения по умолчанию', () => {
    const store = new SessionStore();
    const bare = store.create();
    assert.equal(bare.initialized, true);
    assert.deepEqual(bare.clientInfo, {});
    assert.equal(bare.protocolVersion, '');
    assert.equal(store.size, 1);

    const withMeta = store.create({ clientInfo: { name: 'client' }, protocolVersion: '2025-06-18' });
    assert.deepEqual(withMeta.clientInfo, { name: 'client' });
    assert.equal(withMeta.protocolVersion, '2025-06-18');
    assert.equal(store.size, 2);

    store.clear();
    assert.equal(store.size, 0);
});

test('SessionStore: get продлевает сессию, отвергает не-строки и удаляет истёкшие', async () => {
    const store = new SessionStore({ ttlMs: 20 });
    const session = store.create();
    assert.equal(store.get(session.id).id, session.id);
    assert.equal(store.get(undefined), null);
    assert.equal(store.get(42), null);
    assert.equal(store.get(''), null);
    assert.equal(store.get('no-such-session'), null);

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(store.get(session.id), null, 'истёкшая сессия должна удаляться');
    assert.equal(store.size, 0);
});

test('SessionStore: delete возвращает признак удаления, ttlMs по умолчанию конечен', () => {
    const store = new SessionStore({ ttlMs: Number.NaN });
    assert.ok(Number.isFinite(store.ttlMs));
    const session = store.create();
    assert.equal(store.delete(session.id), true);
    assert.equal(store.delete(session.id), false);
});

test('renderLanding: stateless-режим и host 0.0.0.0 отражаются в HTML', () => {
    const html = renderLanding({
        host: '0.0.0.0',
        port: 4321,
        docsRoot: 'C:/docs/<root>',
        docCount: 7,
        stateless: true,
        version: '1.2.3',
    });
    assert.match(html, /http:\/\/127\.0\.0\.1:4321\/mcp/);
    assert.match(html, /HTTP \(stateless\)/);
    assert.match(html, /stateless-режиме: initialize не обязателен/);
    assert.match(html, /--stateless/);
    assert.match(html, /1\.2\.3/);
    assert.match(html, /C:\/docs\/&lt;root&gt;/, 'путь должен быть HTML-экранирован');
});

test('renderLanding: режим сессий и обычный host', () => {
    const html = renderLanding({
        host: '127.0.0.1',
        port: 8765,
        docsRoot: '/repo/docs/docs',
        docCount: 12,
        stateless: false,
        version: '0.0.0',
    });
    assert.match(html, /HTTP \+ stdio/);
    assert.match(html, /Сервер с сессиями/);
    assert.match(html, /Mcp-Session-Id/);
    assert.doesNotMatch(html, /stateless-режиме: initialize не обязателен/);
});

test('sendJson/sendHtml не пишут повторно после завершения ответа', () => {
    const res = fakeResponse();
    res.headersSent = true;
    sendJson(res, 200, { ok: true });
    sendHtml(res, 200, '<html></html>');
    assert.equal(res.status, null, 'ответ не должен отправляться повторно');

    const ended = fakeResponse();
    ended.writableEnded = true;
    sendJson(ended, 200, { ok: true });
    sendHtml(ended, 200, '<html></html>');
    assert.equal(ended.status, null);
});

test('sendJson/sendHtml/sendMethodNotAllowed формируют контракт ответа', () => {
    const json = fakeResponse();
    sendJson(json, 201, { ok: true }, { 'Mcp-Session-Id': 'abc' });
    assert.equal(json.status, 201);
    assert.equal(json.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(json.headers['Mcp-Session-Id'], 'abc');
    assert.equal(json.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(json.body.toString('utf8'), '{"ok":true}');

    const html = fakeResponse();
    sendHtml(html, 200, '<h1>ok</h1>');
    assert.equal(html.status, 200);
    assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(html.body.toString('utf8'), '<h1>ok</h1>');

    const notAllowed = fakeResponse();
    sendMethodNotAllowed(notAllowed, 'GET, POST', '/mcp');
    assert.equal(notAllowed.status, 405);
    assert.equal(notAllowed.headers.Allow, 'GET, POST');
    const payload = JSON.parse(notAllowed.body.toString('utf8'));
    assert.equal(payload.error, 'Method Not Allowed');
    assert.match(payload.message, /GET, POST/);
    assert.equal(payload.allow, 'GET, POST');
});

test('readBody собирает тело из нескольких чанков', async () => {
    const { readBody } = await import('../src/http-util.mjs');
    const req = new EventEmitter();
    const promise = readBody(req);
    req.emit('data', Buffer.from('{"a":', 'utf8'));
    req.emit('data', Buffer.from('1}', 'utf8'));
    req.emit('end');
    assert.equal((await promise).toString('utf8'), '{"a":1}');
});

test('readBody отклоняет тело больше лимита с кодом 413', async () => {
    const { readBody } = await import('../src/http-util.mjs');
    const req = new EventEmitter();
    const promise = readBody(req, 4);
    req.emit('data', Buffer.from('12345', 'utf8'));
    req.emit('data', Buffer.from('67890', 'utf8'));
    req.emit('end');
    await assert.rejects(promise, (error) => {
        assert.equal(error.statusCode, 413);
        assert.match(error.message, /больше 4 байт/);
        return true;
    });
    assert.equal(MAX_BODY_BYTES, 1024 * 1024);
});

test('readBody пробрасывает ошибку потока запроса', async () => {
    const { readBody } = await import('../src/http-util.mjs');
    const req = new EventEmitter();
    const promise = readBody(req);
    req.emit('error', new Error('ECONNRESET'));
    await assert.rejects(promise, /ECONNRESET/);
});
