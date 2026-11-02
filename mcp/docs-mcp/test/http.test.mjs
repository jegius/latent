// http.test.mjs — тесты Streamable HTTP транспорта: маршруты, сессии, CORS, SSE.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    JSON_HEADERS,
    createFixtureCore,
    httpPost,
    startFixtureHttp,
} from './helpers.mjs';

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
