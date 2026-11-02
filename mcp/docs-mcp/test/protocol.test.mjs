// protocol.test.mjs — тесты MCP-протокола поверх ядра: методы, tools, resources, prompts.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFixtureCore, rpc, callTool, toolData } from './helpers.mjs';

const TOOL_NAMES = ['list_docs', 'search_docs', 'read_doc', 'get_language_reference', 'get_example', 'check_code'];

test('initialize возвращает capabilities, serverInfo и инструкции', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
    });

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    const result = response.result;
    assert.equal(result.protocolVersion, '2025-06-18');
    assert.equal(result.serverInfo.name, 'latent-docs');
    assert.match(result.serverInfo.version, /^\d+\.\d+\.\d+/);
    assert.ok(result.capabilities.tools);
    assert.ok(result.capabilities.resources);
    assert.ok(result.capabilities.prompts);
    assert.equal(typeof result.instructions, 'string');
    assert.match(result.instructions, /list_docs/);
});

test('initialize согласует неизвестную версию протокола на поддерживаемую', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'initialize', {
        protocolVersion: '1999-01-01',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '0' },
    });
    assert.equal(response.result.protocolVersion, '2025-06-18');
});

test('ping возвращает пустой результат', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'ping', undefined, 'p1');
    assert.deepEqual(response, { jsonrpc: '2.0', id: 'p1', result: {} });
});

test('уведомления не получают ответа', async () => {
    const core = createFixtureCore();
    const response = await core.handlePayload({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(response, null);
    const cancelled = await core.handlePayload({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    assert.equal(cancelled, null);
});

test('tools/list содержит все шесть инструментов с корректными схемами', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'tools/list');
    const tools = response.result.tools;

    assert.equal(tools.length, 6);
    assert.deepEqual(tools.map((tool) => tool.name), TOOL_NAMES);
    for (const tool of tools) {
        assert.equal(typeof tool.description, 'string');
        assert.ok(tool.description.length > 20);
        assert.equal(tool.inputSchema.type, 'object');
        assert.equal(tool.inputSchema.additionalProperties, false);
    }
});

test('tools/list не зависит от initialize (stateless-ядро)', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'tools/list');
    assert.equal(response.result.tools.length, 6);
});

test('tools/call list_docs отдаёт контрактные поля', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'list_docs');
    const data = toolData(response);

    assert.equal(data.docs.length, 9);
    for (const doc of data.docs) {
        assert.deepEqual(Object.keys(doc).sort(), ['description', 'path', 'section', 'title']);
    }
    const variables = data.docs.find((doc) => doc.path === 'guide/variables.md');
    assert.equal(variables.title, 'Переменные и типы');
    assert.equal(variables.section, 'guide');
    assert.match(variables.description, /аннотации типов/);
    assert.equal(response.result.content[0].type, 'text');
});

test('tools/call search_docs возвращает path/title/score/snippet', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'search_docs', { query: 'встроенные функции', limit: 2 });
    const data = toolData(response);

    assert.ok(data.results.length >= 1);
    assert.ok(data.results.length <= 2);
    assert.deepEqual(Object.keys(data.results[0]).sort(), ['path', 'score', 'snippet', 'title']);
    assert.equal(data.results[0].path, 'reference/builtins.md');
    assert.match(response.result.content[0].text, /Найдено результатов/);
});

test('tools/call read_doc отдаёт полный Markdown', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'read_doc', { path: 'guide/functions.md' });
    const data = toolData(response);

    assert.equal(data.path, 'guide/functions.md');
    assert.equal(data.title, 'Функции');
    assert.match(data.content, /# Функции/);
    assert.match(data.content, /fn square/);
    assert.equal(response.result.content[0].text, data.content);
});

test('tools/call read_doc для несуществующей страницы — isError', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'read_doc', { path: 'guide/nope.md' });

    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /не найден/);
});

test('tools/call search_docs без query — ошибка InvalidParams', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'search_docs', {});
    assert.equal(response.error.code, -32602);
});

test('tools/call с неизвестным инструментом — InvalidParams', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'no_such_tool');
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Неизвестный инструмент/);
});

test('get_language_reference агрегирует справочник по теме', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'get_language_reference', { topic: 'builtins' });
    const data = toolData(response);

    assert.equal(data.topic, 'builtins');
    assert.match(data.content, /# Справочник по языку Latent/);
    assert.match(data.content, /Встроенные функции/);
    assert.match(data.content, /reference\/builtins\.md/);
    assert.equal(response.result.content[0].text, data.content);
});

test('get_language_reference topic=abi находит reference/wasm-abi.md (синоним)', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'get_language_reference', { topic: 'abi' });
    const content = toolData(response).content;

    assert.match(content, /reference\/wasm-abi\.md/);
    assert.match(content, /ABI WebAssembly/);
});

test('get_language_reference topic=all возвращает все страницы reference/', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'get_language_reference', { topic: 'all' });
    const content = toolData(response).content;

    assert.match(content, /reference\/builtins\.md/);
    assert.match(content, /reference\/types\.md/);
    assert.match(content, /reference\/errors\.md/);
    assert.match(content, /Встроенные функции/);
    assert.match(content, /Типы/);
});

test('get_language_reference с неизвестной темой — InvalidParams', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'get_language_reference', { topic: 'magic' });
    assert.equal(response.error.code, -32602);
});

test('get_example возвращает пример по id и список без id', async () => {
    const core = createFixtureCore();
    const withId = await callTool(core, 'get_example', { id: 'arrays' });
    const example = toolData(withId);

    assert.deepEqual(Object.keys(example).sort(), ['code', 'id', 'title']);
    assert.equal(example.id, 'arrays');
    assert.match(example.code, /fn main/);
    assert.match(withId.result.content[0].text, /```latent/);

    const withoutId = await callTool(core, 'get_example', {});
    assert.ok(toolData(withoutId).examples.length > 5);
});

test('get_example с неизвестным id — isError со списком', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'get_example', { id: 'no-such-example' });

    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /не найден/);
});

test('resources/list содержит index и все документы', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'resources/list');
    const resources = response.result.resources;

    assert.equal(resources.length, core.index.docs.length + 1);
    assert.equal(resources[0].uri, 'latent-docs://index');
    assert.equal(resources[0].mimeType, 'text/markdown');
    const docUris = resources.slice(1).map((resource) => resource.uri);
    assert.ok(docUris.includes('latent-docs://guide/variables.md'));
    for (const resource of resources) {
        assert.equal(resource.mimeType, 'text/markdown');
        assert.equal(typeof resource.name, 'string');
        assert.equal(typeof resource.description, 'string');
    }
});

test('resources/templates/list отдаёт шаблоны URI', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'resources/templates/list');
    const templates = response.result.resourceTemplates;

    assert.ok(templates.length >= 1);
    assert.equal(templates[0].uriTemplate, 'latent-docs://{path}');
    assert.equal(templates[0].mimeType, 'text/markdown');
});

test('resources/read читает index и страницу', async () => {
    const core = createFixtureCore();

    const indexResponse = await rpc(core, 'resources/read', { uri: 'latent-docs://index' });
    const indexText = indexResponse.result.contents[0].text;
    assert.equal(indexResponse.result.contents[0].mimeType, 'text/markdown');
    assert.match(indexText, /# Индекс документации Latent/);
    assert.match(indexText, /latent-docs:\/\/guide\/variables\.md/);

    const docResponse = await rpc(core, 'resources/read', { uri: 'latent-docs://reference/builtins.md' });
    assert.match(docResponse.result.contents[0].text, /# Встроенные функции/);
});

test('resources/read несуществующего ресурса — ошибка', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'resources/read', { uri: 'latent-docs://guide/nope.md' });
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /не найден/);
});

test('prompts/list содержит три промпта с аргументами', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'prompts/list');
    const prompts = response.result.prompts;

    assert.deepEqual(prompts.map((prompt) => prompt.name), ['explain_syntax', 'write_program', 'debug_program']);
    for (const prompt of prompts) {
        assert.equal(typeof prompt.description, 'string');
        assert.ok(Array.isArray(prompt.arguments));
        assert.ok(prompt.arguments.length >= 1);
    }
});

test('prompts/get explain_syntax подставляет документацию по теме', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'prompts/get', { name: 'explain_syntax', arguments: { topic: 'переменные' } });
    const prompt = response.result;

    assert.equal(prompt.messages.length, 1);
    assert.equal(prompt.messages[0].role, 'user');
    const text = prompt.messages[0].content.text;
    assert.match(text, /переменные/);
    assert.match(text, /guide\/variables\.md/);
    assert.ok(text.length > 500);
});

test('prompts/get write_program подставляет примеры и документацию', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'prompts/get', {
        name: 'write_program',
        arguments: { task: 'посчитать сумму массива', constraints: 'движок №1' },
    });
    const text = response.result.messages[0].content.text;

    assert.match(text, /посчитать сумму массива/);
    assert.match(text, /движок №1/);
    assert.match(text, /Готовые примеры/);
    assert.match(text, /check_code/);
});

test('prompts/get debug_program включает код и раздел ошибок', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'prompts/get', {
        name: 'debug_program',
        arguments: { code: 'fn main() { let x = ; }', error: 'Ошибка парсинга на строке 1:18' },
    });
    const text = response.result.messages[0].content.text;

    assert.match(text, /```latent/);
    assert.match(text, /let x = ;/);
    assert.match(text, /Ошибка парсинга/);
    assert.match(text, /reference\/errors\.md/);
});

test('prompts/get без обязательного аргумента — InvalidParams', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'prompts/get', { name: 'explain_syntax', arguments: {} });
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /topic/);
});

test('prompts/get неизвестного промпта — InvalidParams', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'prompts/get', { name: 'no_such_prompt', arguments: {} });
    assert.equal(response.error.code, -32602);
});

test('неизвестный метод — MethodNotFound -32601', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'unknown/method');
    assert.equal(response.error.code, -32601);
    assert.match(response.error.message, /unknown\/method/);
});

test('некорректный JSON-RPC запрос — InvalidRequest', async () => {
    const core = createFixtureCore();
    const response = await core.handlePayload({ jsonrpc: '2.0', id: 42 });
    assert.equal(response.error.code, -32600);
    assert.equal(response.id, 42);

    const garbage = await core.handlePayload(42);
    assert.equal(garbage.error.code, -32600);
});

test('batch-запрос обрабатывается построчно', async () => {
    const core = createFixtureCore();
    const response = await core.handlePayload([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);

    assert.ok(Array.isArray(response));
    assert.equal(response.length, 2);
    assert.equal(response[0].id, 1);
    assert.equal(response[1].id, 2);
});

test('пустой batch — ошибка InvalidRequest', async () => {
    const core = createFixtureCore();
    const response = await core.handlePayload([]);
    assert.equal(response.error.code, -32600);
});

test('shutdown отвечает null и не ломает сервер', async () => {
    const core = createFixtureCore();
    const shutdown = await rpc(core, 'shutdown');
    assert.equal(shutdown.result, null);
    const ping = await rpc(core, 'ping');
    assert.ok(ping.result);
});
