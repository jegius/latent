// http.test.mjs — тесты Streamable HTTP транспорта: маршруты, сессии, CORS, SSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import {
    JSON_HEADERS,
    createFixtureCore,
    httpPost,
    startFixtureHttp,
} from './helpers.mjs';
import { createMcpRoutes } from '../src/http-mcp.mjs';
import { startHttpServer } from '../src/http.mjs';
import { renderLanding } from '../src/landing.mjs';

/** Параметры initialize по умолчанию. */
const INIT_PARAMS = {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
};

/**
 * Инициализирует сессию и возвращает её id.
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function openSession(baseUrl) {
    const response = await httpPost(baseUrl, { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT_PARAMS });
    assert.equal(response.status, 200);
    const sessionId = response.headers.get('mcp-session-id');
    assert.ok(sessionId, 'ответ initialize должен содержать Mcp-Session-Id');
    return sessionId;
}

test('GET /health возвращает статус и состояние документации', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(`${handle.url.replace(/\/mcp$/, '/health')}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.name, 'latent-docs');
    assert.equal(body.transport, 'http');
    assert.equal(body.stateless, false);
    assert.equal(body.docs.count, 9);
    assert.equal(body.docs.exists, true);
    assert.equal(typeof body.uptimeSeconds, 'number');
});

test('GET / отдаёт HTML-лендинг с примерами подключения', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const base = handle.url.replace(/\/mcp$/, '');
    const response = await fetch(`${base}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /latent-docs/);
    assert.match(html, /claude_desktop_config\.json/);
    assert.match(html, /search_docs/);
    assert.match(html, new RegExp(handle.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('POST initialize создаёт сессию, tools/list по ней работает', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const sessionId = await openSession(handle.url);
    assert.match(sessionId, /^[0-9a-f-]{36}$/);

    const toolsResponse = await httpPost(
        handle.url,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { 'Mcp-Session-Id': sessionId },
    );
    assert.equal(toolsResponse.status, 200);
    assert.equal(toolsResponse.body.result.tools.length, 6);
});

test('POST до initialize без сессии — 400 и ошибка -32002 по спецификации', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(handle.url, { jsonrpc: '2.0', id: 7, method: 'tools/list' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, -32002);
    assert.match(response.body.error.message, /не инициализирован/);
});

test('POST ping до initialize разрешён', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(handle.url, { jsonrpc: '2.0', id: 8, method: 'ping' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.result, {});
});

test('stateless-режим не требует initialize', async (t) => {
    const handle = await startFixtureHttp({ stateless: true });
    t.after(() => handle.close());

    const toolsResponse = await httpPost(handle.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(toolsResponse.status, 200);
    assert.equal(toolsResponse.body.result.tools.length, 6);
    assert.equal(toolsResponse.headers.get('mcp-session-id'), null);

    const callResponse = await httpPost(handle.url, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_docs', arguments: { query: 'переменные', limit: 2 } },
    });
    assert.equal(callResponse.status, 200);
    assert.ok(callResponse.body.result.structuredContent.results.length >= 1);

    const health = await (await fetch(`${handle.url.replace(/\/mcp$/, '/health')}`)).json();
    assert.equal(health.stateless, true);
});

test('неизвестная сессия — 404 и -32001', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(
        handle.url,
        { jsonrpc: '2.0', id: 3, method: 'tools/list' },
        { 'Mcp-Session-Id': '00000000-0000-0000-0000-000000000000' },
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, -32001);
});

test('DELETE /mcp завершает сессию', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const sessionId = await openSession(handle.url);
    const deleteResponse = await fetch(handle.url, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId },
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { ok: true });

    const afterResponse = await httpPost(
        handle.url,
        { jsonrpc: '2.0', id: 4, method: 'tools/list' },
        { 'Mcp-Session-Id': sessionId },
    );
    assert.equal(afterResponse.status, 404);
    assert.equal(afterResponse.body.error.code, -32001);
});

test('DELETE /mcp без сессии — 400', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, { method: 'DELETE' });
    assert.equal(response.status, 400);
});

test('две сессии независимы', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const first = await openSession(handle.url);
    const second = await openSession(handle.url);
    assert.notEqual(first, second);

    const firstTools = await httpPost(handle.url, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, { 'Mcp-Session-Id': first });
    const secondTools = await httpPost(handle.url, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, { 'Mcp-Session-Id': second });
    assert.equal(firstTools.status, 200);
    assert.equal(secondTools.status, 200);

    await fetch(handle.url, { method: 'DELETE', headers: { 'Mcp-Session-Id': first } });
    const secondStillWorks = await httpPost(handle.url, { jsonrpc: '2.0', id: 6, method: 'ping' }, { 'Mcp-Session-Id': second });
    assert.equal(secondStillWorks.status, 200);
});

test('notifications/initialized по POST — 202 без тела', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const sessionId = await openSession(handle.url);
    const response = await fetch(handle.url, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Mcp-Session-Id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
});

test('битый JSON — 400 и код -32700', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{not json',
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32700);
});

test('неверный Content-Type — 415', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    });
    assert.equal(response.status, 415);
});

test('неподдерживаемая версия протокола в заголовке — 400', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'MCP-Protocol-Version': '1999-01-01' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT_PARAMS }),
    });
    assert.equal(response.status, 400);
});

test('OPTIONS /mcp отвечает CORS preflight', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.match(response.headers.get('access-control-allow-headers'), /Mcp-Session-Id/i);
    assert.equal(response.headers.get('access-control-expose-headers'), 'Mcp-Session-Id');
});

test('CORS-заголовки есть и на обычных ответах', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(handle.url, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('неизвестный маршрут — 404', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const base = handle.url.replace(/\/mcp$/, '');
    const response = await fetch(`${base}/no-such-route`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not Found');
    assert.deepEqual(body.available, ['/', '/health', '/mcp']);
});

test('неподдерживаемый метод на /mcp — 405 с Allow', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, { method: 'PUT', body: '{}' });
    assert.equal(response.status, 405);
    assert.match(response.headers.get('allow'), /POST/);
    assert.match(response.headers.get('allow'), /GET/);
});

test('POST /health — 405', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const base = handle.url.replace(/\/mcp$/, '');
    const response = await fetch(`${base}/health`, { method: 'POST' });
    assert.equal(response.status, 405);
});

test('HEAD /health отвечает без тела', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const base = handle.url.replace(/\/mcp$/, '');
    const response = await fetch(`${base}/health`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.ok(Number(response.headers.get('content-length')) > 0);
});

test('GET /mcp отдаёт SSE-поток', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const controller = new AbortController();
    const response = await fetch(handle.url, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(response.headers.get('cache-control'), /no-cache/);

    const reader = response.body.getReader();
    const { value } = await reader.read();
    const chunk = Buffer.from(value).toString('utf8');
    assert.match(chunk, /подключено|keep-alive/);
    controller.abort();
    await response.body.cancel?.().catch(() => {});
});

test('GET /mcp без Accept: text/event-stream — 406', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, { headers: { Accept: 'application/json' } });
    assert.equal(response.status, 406);
});

test('close() останавливает сервер', async () => {
    const handle = await startFixtureHttp();
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    assert.equal((await fetch(healthUrl)).status, 200);
    await handle.close();
    await assert.rejects(() => fetch(healthUrl));
});

test('сервер на порту 0 отдаёт реальный порт', async () => {
    const handle = await startFixtureHttp();
    try {
        assert.ok(handle.port > 0);
        assert.match(handle.url, new RegExp(`:${handle.port}/mcp$`));
    } finally {
        await handle.close();
    }
});

// --- маршруты, лимиты и защитные ветви HTTP-транспорта ----------------------

/**
 * Сырой POST без автоматических заголовков fetch.
 * @param {string} endpoint
 * @param {string} body
 * @param {Record<string, string>} headers
 * @returns {Promise<{status: number, body: string}>}
 */
function rawPost(endpoint, body, headers) {
    const url = new URL(endpoint);
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString('utf8'); });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.end(body);
    });
}

test('POST без Content-Type — 415, ветка «заголовок отсутствует»', async (t) => {
    const handle = await startFixtureHttp({ stateless: true });
    t.after(() => handle.close());

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const response = await rawPost(handle.url, body, { 'Content-Length': String(Buffer.byteLength(body)) });
    assert.equal(response.status, 415);
    assert.match(JSON.parse(response.body).message, /application\/json/);
});

test('тело больше 1 МиБ отклоняется с кодом 413', async (t) => {
    const handle = await startFixtureHttp({ stateless: true });
    t.after(() => handle.close());

    const huge = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: { pad: 'x'.repeat(1024 * 1024 + 1) },
    });
    const response = await httpPost(handle.url, JSON.parse(huge));
    assert.equal(response.status, 413);
    assert.match(response.body.message, /больше 1048576 байт/);
});

test('HEAD / и POST / — контракт методов лендинга', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());
    const base = handle.url.replace(/\/mcp$/, '');

    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.match(head.headers.get('content-type'), /text\/html/);
    assert.equal(await head.text(), '');

    const post = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.match(post.headers.get('allow'), /GET/);
    assert.match(post.headers.get('allow'), /HEAD/);
});

test('GET /favicon.ico и OPTIONS /health — 204 без тела', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());
    const base = handle.url.replace(/\/mcp$/, '');

    const favicon = await fetch(`${base}/favicon.ico`);
    assert.equal(favicon.status, 204);
    assert.equal(await favicon.text(), '');

    const options = await fetch(`${base}/health`, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), '*');
});

test('POST /health и PUT /mcp — 405 с Allow', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());
    const base = handle.url.replace(/\/mcp$/, '');

    const health = await fetch(`${base}/health`, { method: 'POST' });
    assert.equal(health.status, 405);
    assert.match(health.headers.get('allow'), /GET/);

    const method = await fetch(handle.url, { method: 'PATCH' });
    assert.equal(method.status, 405);
    const body = await method.json();
    assert.match(body.message, /POST/);
    assert.match(body.message, /DELETE/);
    assert.match(body.message, /OPTIONS/);
});

test('initialize без params создаёт сессию с пустыми метаданными', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(handle.url, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.protocolVersion, '2025-06-18');
    const sessionId = response.headers.get('mcp-session-id');
    assert.ok(sessionId);
    const session = handle.sessions.get(sessionId);
    assert.deepEqual(session.clientInfo, {});
    assert.equal(session.protocolVersion, '');
});

test('batch initialize + notification создаёт сессию и отвечает только на запрос', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(handle.url, [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT_PARAMS },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].result.serverInfo.name, 'latent-docs');
    assert.ok(response.headers.get('mcp-session-id'));
});

test('batch, где кроме initialize есть запрос до инициализации, отклоняется', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(handle.url, [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT_PARAMS },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, -32002);
});

test('поддерживаемый MCP-Protocol-Version в заголовке не блокирует запрос', async (t) => {
    const handle = await startFixtureHttp({ stateless: true });
    t.after(() => handle.close());

    const response = await httpPost(
        handle.url,
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { 'MCP-Protocol-Version': '2025-03-26' },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.result, {});
});

test('DELETE в stateless-режиме отвечает подтверждением', async (t) => {
    const handle = await startFixtureHttp({ stateless: true });
    t.after(() => handle.close());

    const response = await fetch(handle.url, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, stateless: true });
});

test('DELETE несуществующей сессии — 404 и -32001', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await fetch(handle.url, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, -32001);
});

test('неизвестная сессия с уведомлением — 404 с id:null', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const response = await httpPost(
        handle.url,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { 'Mcp-Session-Id': '00000000-0000-0000-0000-000000000000' },
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, -32001);
    assert.equal(response.body.id, null);
});

test('истёкшая сессия отвергается на следующем запросе', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());

    const sessionId = await openSession(handle.url);
    const session = handle.sessions.get(sessionId);
    session.lastSeen = Date.now() - (31 * 60 * 1000);

    const response = await httpPost(
        handle.url,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { 'Mcp-Session-Id': sessionId },
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, -32001);
    assert.equal(handle.sessions.size, 0);
});

test('необработанное исключение ядра — 500 InternalError без деталей', async (t) => {
    const logged = [];
    const core = createFixtureCore();
    core.handlePayload = async () => {
        throw new Error('внутренний сбой');
    };
    const handle = await startHttpServer({
        core,
        host: '127.0.0.1',
        port: 0,
        stateless: true,
        logger: { error: (...args) => logged.push(args) },
    });
    t.after(() => handle.close());

    const response = await httpPost(handle.url, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, -32603);
    assert.match(response.body.error.message, /Внутренняя ошибка сервера/);
    assert.equal(logged.length, 1, 'ошибка должна попасть в лог');
});

test('SSE: heartbeat пишет keep-alive и снимает клиента при закрытии', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const sseClients = new Set();
    const handlers = {};
    const res = {
        headersSent: false,
        writableEnded: false,
        status: null,
        headers: null,
        chunks: [],
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        write(chunk) {
            this.chunks.push(String(chunk));
            return true;
        },
        on(event, handler) {
            handlers[event] = handler;
        },
        end() {},
    };
    const req = { headers: { accept: 'text/event-stream' }, on() {} };
    const routes = createMcpRoutes({
        core: createFixtureCore(),
        sessions: null,
        stateless: true,
        sseClients,
        logger: { error() {} },
    });

    routes.handleSse(req, res);
    assert.equal(res.status, 200);
    assert.match(res.headers['Content-Type'], /text\/event-stream/);
    assert.match(res.chunks[0], /подключено к latent-docs/);
    assert.equal(sseClients.size, 1);

    t.mock.timers.tick(15000);
    assert.match(res.chunks.at(-1), /keep-alive/);

    handlers.close();
    assert.equal(sseClients.size, 0);
    t.mock.timers.tick(30000);
    assert.equal(res.chunks.filter((chunk) => chunk.includes('keep-alive')).length, 1, 'таймер должен быть очищен');
});

test('SSE: ошибка записи heartbeat не роняет сервер', () => {
    // Детерминированно перехватываем setInterval, чтобы не зависеть от
    // реализации mock timers в разных версиях Node (в Node 22 тик может
    // вести себя иначе, чем в 24).
    const sseClients = new Set();
    let writes = 0;
    const timers = [];
    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    globalThis.setInterval = (fn) => {
        timers.push(fn);
        return { unref() {}, ref() {} };
    };
    globalThis.clearInterval = () => {};
    try {
        const res = {
            headersSent: false,
            writableEnded: false,
            writeHead() {},
            write() {
                writes += 1;
                if (writes > 1) throw new Error('сокет закрыт');
                return true;
            },
            on() {},
            end() {},
        };
        const routes = createMcpRoutes({
            core: createFixtureCore(),
            sessions: null,
            stateless: true,
            sseClients,
            logger: { error() {} },
        });

        routes.handleSse({ headers: { accept: '*/*' }, on() {} }, res);
        assert.equal(timers.length, 1, 'heartbeat должен быть запланирован');
        assert.doesNotThrow(() => timers[0](), 'ошибка write должна быть поймана');
        assert.equal(sseClients.size, 1);
    } finally {
        globalThis.setInterval = origSetInterval;
        globalThis.clearInterval = origClearInterval;
    }
});

test('handlePost: ошибка чтения тела без statusCode превращается в 400', async () => {
    const req = new EventEmitter();
    req.headers = { 'content-type': 'application/json' };
    req.method = 'POST';
    const res = {
        headersSent: false,
        writableEnded: false,
        status: null,
        body: null,
        writeHead(status) { this.status = status; },
        end(body) { this.body = body; },
    };
    const routes = createMcpRoutes({
        core: createFixtureCore(),
        sessions: null,
        stateless: true,
        sseClients: new Set(),
        logger: { error() {} },
    });

    const pending = routes.handlePost(req, res);
    req.emit('error', new Error('ECONNRESET при чтении тела'));
    await pending;
    assert.equal(res.status, 400);
    const payload = JSON.parse(res.body.toString('utf8'));
    assert.equal(payload.error, 'Bad Request');
    assert.match(payload.message, /ECONNRESET/);
});

test('GET /mcp без заголовка Accept открывает SSE-поток', async (t) => {
    const handle = await startFixtureHttp();
    t.after(() => handle.close());
    const url = new URL(handle.url);

    const response = await new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET',
        }, (res) => {
            res.resume();
            resolve(res);
            req.destroy();
        });
        req.on('error', (error) => {
            if (error.code !== 'ECONNRESET') reject(error);
        });
        req.end();
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/event-stream/);
});

test('startHttpServer: занятый порт отклоняет промис запуска', async (t) => {
    const first = await startFixtureHttp();
    t.after(() => first.close());

    await assert.rejects(
        () => startHttpServer({
            core: createFixtureCore(),
            host: '127.0.0.1',
            port: first.port,
            stateless: true,
            logger: { error() {} },
        }),
        (error) => error && ['EADDRINUSE', 'EACCES'].includes(error.code),
    );
});

test('лендинг: stateless-режим и host 0.0.0.0 отражаются в HTML', async (t) => {
    const html = renderLanding({
        host: '0.0.0.0',
        port: 8792,
        docsRoot: 'C:/docs',
        docCount: 3,
        stateless: true,
        version: '9.9.9',
    });
    assert.match(html, /http:\/\/127\.0\.0\.1:8792\/mcp/);
    assert.match(html, /HTTP \(stateless\)/);
    assert.match(html, /stateless-режиме/);

    const handle = await startHttpServer({
        core: createFixtureCore(),
        host: '0.0.0.0',
        port: 0,
        stateless: true,
        logger: { error() {} },
    });
    t.after(() => handle.close());
    assert.equal(handle.host, '127.0.0.1');
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
});
