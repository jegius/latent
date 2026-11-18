// protocol.test.mjs — тесты MCP-протокола поверх ядра: методы, tools, resources, prompts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFixtureCore, rpc, callTool, toolData, FIXTURES_DOCS } from './helpers.mjs';
import { buildDocsIndex } from '../src/docs-index.mjs';
import { createExamplesProvider } from '../src/examples.mjs';
import { SUPPORTED_PROTOCOL_VERSIONS, createHandlers } from '../src/handlers.mjs';
import { REPO_ROOT } from '../src/paths.mjs';
import { buildPromptList, getPrompt, requiredArguments } from '../src/prompts.mjs';

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

// --- граничные случаи протокола, инструментов, ресурсов и prompts -----------

/** Каталог фикстур без документации (для проверки пустого индекса). */
const MISSING_DOCS = path.join(os.tmpdir(), 'latent-protocol-missing-docs-xyz');

/**
 * Создаёт диспетчер с подменяемыми зависимостями.
 * @param {{index?: object, examples?: object, compiler?: object, hooks?: object}} [overrides]
 * @returns {object}
 */
function makeHandlers(overrides = {}) {
    const index = overrides.index || buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const examples = overrides.examples || createExamplesProvider({ repoRoot: REPO_ROOT, docsRoot: FIXTURES_DOCS });
    const compiler = overrides.compiler || { check: async () => ({ ok: true, errors: [] }), version: async () => 'test' };
    return createHandlers({
        index,
        examples,
        compiler,
        docsRoot: FIXTURES_DOCS,
        hooks: overrides.hooks || {},
    });
}

/**
 * Вызывает инструмент через диспетчер.
 * @param {object} handlers
 * @param {string} name
 * @param {unknown} args
 * @returns {Promise<object>}
 */
function callHandler(handlers, name, args) {
    return handlers.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
}

test('core: resourceCount и initialized отражают состояние сервера', async () => {
    const core = createFixtureCore();
    assert.equal(core.initialized, false);
    assert.equal(core.resourceCount(), core.index.docs.length + 1);

    await rpc(core, 'initialize', { protocolVersion: '2025-03-26' });
    assert.equal(core.initialized, true);
    assert.deepEqual(core.serverInfo, { name: 'latent-docs', version: core.serverInfo.version });

    await rpc(core, 'shutdown');
    assert.equal(core.initialized, false);
});

test('batch только из уведомлений не требует ответа', async () => {
    const core = createFixtureCore();
    const response = await core.handlePayload([
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    ]);
    assert.equal(response, null);
});

test('batch с некорректным элементом возвращает ошибку для него', async () => {
    const core = createFixtureCore();
    const response = await core.handlePayload([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        42,
        null,
    ]);
    assert.equal(response.length, 3);
    assert.equal(response[1].error.code, -32600);
    assert.equal(response[1].id, null);
    assert.equal(response[2].error.code, -32600);
});

test('initialize без params и с нестроковой версией выбирает предпочтительную', async () => {
    const core = createFixtureCore();
    const withoutParams = await rpc(core, 'initialize');
    assert.equal(withoutParams.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);

    const withBadVersion = await rpc(core, 'initialize', { protocolVersion: 20250618 });
    assert.equal(withBadVersion.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);

    const legacy = await rpc(core, 'initialize', { protocolVersion: '2024-11-05' });
    assert.equal(legacy.result.protocolVersion, '2024-11-05');
});

test('tools/call: отсутствие name и не-объектные arguments — InvalidParams', async () => {
    const core = createFixtureCore();

    const noName = await rpc(core, 'tools/call', { arguments: {} });
    assert.equal(noName.error.code, -32602);
    assert.match(noName.error.message, /name/);

    const emptyName = await rpc(core, 'tools/call', { name: '', arguments: {} });
    assert.equal(emptyName.error.code, -32602);

    const numericName = await rpc(core, 'tools/call', { name: 42, arguments: {} });
    assert.equal(numericName.error.code, -32602);

    for (const args of [[], 'строка', 42, true]) {
        const response = await rpc(core, 'tools/call', { name: 'list_docs', arguments: args });
        assert.equal(response.error.code, -32602, `arguments=${JSON.stringify(args)}`);
        assert.match(response.error.message, /JSON-объектом/);
    }
});

test('tools/call: arguments=null трактуется как пустой объект', async () => {
    const core = createFixtureCore();
    const response = await rpc(core, 'tools/call', { name: 'list_docs', arguments: null });
    assert.equal(response.error, undefined);
    assert.equal(response.result.structuredContent.docs.length, 9);
});

test('search_docs: неверные типы query и limit отклоняются', async () => {
    const core = createFixtureCore();

    for (const query of [null, 42, {}, []]) {
        const response = await callTool(core, 'search_docs', { query });
        assert.equal(response.error.code, -32602, `query=${JSON.stringify(query)}`);
        assert.match(response.error.message, /query/);
    }

    for (const limit of [0, 51, 2.5, -1, '5', 1e9]) {
        const response = await callTool(core, 'search_docs', { query: 'типы', limit });
        assert.equal(response.error.code, -32602, `limit=${JSON.stringify(limit)}`);
        assert.match(response.error.message, /limit/);
    }
});

test('search_docs: границы limit 1 и 50 допустимы, пустой результат объясняется', async () => {
    const core = createFixtureCore();
    const one = await callTool(core, 'search_docs', { query: 'latent', limit: 1 });
    assert.equal(toolData(one).results.length, 1);

    const fifty = await callTool(core, 'search_docs', { query: 'latent', limit: 50 });
    assert.ok(toolData(fifty).results.length >= 1);

    const none = await callTool(core, 'search_docs', { query: 'квантовый_банан_zzz' });
    assert.deepEqual(toolData(none).results, []);
    assert.match(none.result.content[0].text, /ничего не найдено/);
    assert.match(none.result.content[0].text, /list_docs/);
});

test('read_doc: неверный path и подсказки при опечатке', async () => {
    const core = createFixtureCore();

    for (const pathValue of [null, 42, '', '   ']) {
        const response = await callTool(core, 'read_doc', { path: pathValue });
        assert.equal(response.error.code, -32602, `path=${JSON.stringify(pathValue)}`);
    }

    const typo = await callTool(core, 'read_doc', { path: 'функции' });
    assert.equal(typo.result.isError, true);
    assert.match(typo.result.content[0].text, /Возможно, вы имели в виду/);
    assert.match(typo.result.content[0].text, /guide\/functions\.md/);

    const missing = await callTool(core, 'read_doc', { path: 'guide/nope.md' });
    assert.match(missing.result.content[0].text, /Список всех страниц: list_docs/);
});

test('get_language_reference: topic по умолчанию all и валидация типа', async () => {
    const core = createFixtureCore();

    for (const params of [undefined, {}, { topic: null }, { topic: '' }]) {
        const response = await rpc(core, 'tools/call', { name: 'get_language_reference', arguments: params });
        assert.equal(toolData(response).topic, 'all');
    }

    const whitespaceTopic = await callTool(core, 'get_language_reference', { topic: '   ' });
    assert.equal(whitespaceTopic.error.code, -32602);

    const wrongType = await callTool(core, 'get_language_reference', { topic: 42 });
    assert.equal(wrongType.error.code, -32602);
    assert.match(wrongType.error.message, /topic/);
});

test('get_language_reference: отсутствующий раздел описывается, а не падает', async () => {
    const core = createFixtureCore();
    const response = await callTool(core, 'get_language_reference', { topic: 'grammar' });
    const data = toolData(response);

    assert.equal(data.topic, 'grammar');
    assert.match(data.content, /пока не найден/);
    assert.match(data.content, /Доступные страницы справочника/);
    assert.match(data.content, /reference\/types\.md/);
    assert.equal(response.result.content[0].text, data.content);
});

test('list_docs на пустом индексе объясняет причину', async () => {
    const handlers = makeHandlers({ index: buildDocsIndex({ docsRoot: MISSING_DOCS }) });
    const response = await callHandler(handlers, 'list_docs', {});
    assert.match(response.result.content[0].text, /Документация пуста или недоступна/);
    assert.match(response.result.content[0].text, /не найден/);
    assert.deepEqual(toolData(response).docs, []);
});

test('get_example: пустой каталог — isError с понятным сообщением', async () => {
    const emptyExamples = { list: async () => [], get: async () => null };

    const listHandlers = makeHandlers({ examples: emptyExamples });
    const listResponse = await callHandler(listHandlers, 'get_example', {});
    assert.equal(listResponse.result.isError, true);
    assert.match(listResponse.result.content[0].text, /Примеры не найдены/);

    const byId = await callHandler(listHandlers, 'get_example', { id: 'x' });
    assert.equal(byId.result.isError, true);
    assert.match(byId.result.content[0].text, /не найден/);
    assert.match(byId.result.content[0].text, /\(нет\)/);
});

test('get_example: id не-строка отклоняется, пробельный id — это список', async () => {
    const core = createFixtureCore();
    const wrongType = await callTool(core, 'get_example', { id: 42 });
    assert.equal(wrongType.error.code, -32602);
    assert.match(wrongType.error.message, /id/);

    const blank = await callTool(core, 'get_example', { id: '   ' });
    assert.ok(Array.isArray(toolData(blank).examples));
});

test('check_code: успех и ошибка с локацией форматируются по контракту', async () => {
    const okHandlers = makeHandlers({ compiler: { check: async () => ({ ok: true, errors: [] }) } });
    const ok = await callHandler(okHandlers, 'check_code', { code: 'fn main() {}' });
    assert.deepEqual(toolData(ok), { ok: true, errors: [] });
    assert.match(ok.result.content[0].text, /Компиляция успешна/);

    const failHandlers = makeHandlers({
        compiler: {
            check: async () => ({
                ok: false,
                errors: [
                    { message: 'Ошибка на строке 1:5', line: 1, column: 5 },
                    { message: 'Ошибка без локации', line: null, column: null },
                ],
            }),
        },
    });
    const fail = await callHandler(failHandlers, 'check_code', { code: 'bad' });
    const data = toolData(fail);
    assert.equal(data.ok, false);
    assert.equal(data.errors.length, 2);
    const text = fail.result.content[0].text;
    assert.match(text, /Компиляция не удалась: ошибок 2/);
    assert.match(text, /строка 1:5/);
    assert.match(text, /без локации/);
});

test('check_code: исключения компилятора превращаются в isError', async () => {
    const errorHandlers = makeHandlers({
        compiler: { check: async () => { throw new Error('WASM упал'); } },
    });
    const withError = await callHandler(errorHandlers, 'check_code', { code: 'x' });
    assert.equal(withError.result.isError, true);
    assert.match(withError.result.content[0].text, /WASM упал/);

    const stringHandlers = makeHandlers({
        compiler: { check: async () => { throw 'строка-ошибка'; } },
    });
    const withString = await callHandler(stringHandlers, 'check_code', { code: 'x' });
    assert.equal(withString.result.isError, true);
    assert.equal(withString.result.content[0].text, 'строка-ошибка');
});

test('tools/call: внутреннее исключение инструмента маппится в InternalError', async () => {
    const core = createFixtureCore();
    const explodingArgs = new Proxy({}, {
        get() {
            throw new Error('геттер сломан');
        },
    });
    const response = await rpc(core, 'tools/call', { name: 'search_docs', arguments: explodingArgs });
    assert.equal(response.error.code, -32603);
    assert.match(response.error.message, /геттер сломан/);
});

test('resources/read: uri обязателен и должен быть непустой строкой', async () => {
    const core = createFixtureCore();
    for (const params of [undefined, {}, { uri: null }, { uri: 42 }, { uri: '   ' }]) {
        const response = await rpc(core, 'resources/read', params);
        assert.equal(response.error.code, -32602, JSON.stringify(params));
        assert.match(response.error.message, /uri/);
    }
});

test('prompts/get: name и arguments валидируются', async () => {
    const core = createFixtureCore();
    for (const params of [undefined, {}, { name: null }, { name: 42 }, { name: '   ' }]) {
        const response = await rpc(core, 'prompts/get', params);
        assert.equal(response.error.code, -32602, JSON.stringify(params));
        assert.match(response.error.message, /name/);
    }

    for (const args of [[], 'строка', 42]) {
        const response = await rpc(core, 'prompts/get', { name: 'explain_syntax', arguments: args });
        assert.equal(response.error.code, -32602, JSON.stringify(args));
        assert.match(response.error.message, /arguments/);
    }

    const nullArguments = await rpc(core, 'prompts/get', { name: 'explain_syntax', arguments: null });
    assert.equal(nullArguments.error.code, -32602);
    assert.match(nullArguments.error.message, /arguments/);

    const omittedArguments = await rpc(core, 'prompts/get', { name: 'explain_syntax' });
    assert.equal(omittedArguments.error.code, -32602);
    assert.match(omittedArguments.error.message, /topic/);

    const nonStringTopic = await rpc(core, 'prompts/get', { name: 'explain_syntax', arguments: { topic: 42 } });
    assert.equal(nonStringTopic.error.code, -32602);
});

test('prompts/get: необязательные аргументы не ломают шаблон', async () => {
    const core = createFixtureCore();

    const write = await rpc(core, 'prompts/get', { name: 'write_program', arguments: { task: 'написать калькулятор' } });
    const writeText = write.result.messages[0].content.text;
    assert.match(writeText, /калькулятор/);
    assert.doesNotMatch(writeText, /Ограничения:/);

    const debug = await rpc(core, 'prompts/get', { name: 'debug_program', arguments: { code: 'fn main() {}' } });
    const debugText = debug.result.messages[0].content.text;
    assert.match(debugText, /Не указано — предложи, как его получить/);
});

test('getPrompt: неизвестный prompt и requiredArguments по умолчанию', async () => {
    const core = createFixtureCore();
    assert.equal(await getPrompt({ index: core.index }, 'no_such_prompt', {}), null);
    assert.deepEqual(requiredArguments('no_such_prompt'), []);
    assert.deepEqual(requiredArguments('explain_syntax'), ['topic']);
    assert.deepEqual(requiredArguments('write_program'), ['task']);
    assert.deepEqual(requiredArguments('debug_program'), ['code']);
    assert.equal(buildPromptList().prompts.length, 3);
});

test('getPrompt: пустая и недоступная документация отражается в тексте', async () => {
    const emptyIndex = buildDocsIndex({ docsRoot: MISSING_DOCS });
    const emptyPrompt = await getPrompt({ index: emptyIndex }, 'explain_syntax', { topic: 'что-то' });
    const emptyText = emptyPrompt.messages[0].content.text;
    assert.match(emptyText, /Документация недоступна/);
    assert.match(emptyText, /Релевантных страниц/);

    const blankRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-prompt-empty-'));
    try {
        const blankIndex = buildDocsIndex({ docsRoot: blankRoot });
        const blankPrompt = await getPrompt({ index: blankIndex }, 'write_program', { task: 'x' });
        const blankText = blankPrompt.messages[0].content.text;
        assert.match(blankText, /Документация пока пуста/);
        assert.doesNotMatch(blankText, /Готовые примеры/);
        assert.doesNotMatch(blankText, /## Справочник/);
    } finally {
        fs.rmSync(blankRoot, { recursive: true, force: true });
    }
});

test('getPrompt: write_program без examples и debug_program без reference/errors', async () => {
    const blankRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-prompt-bare-'));
    try {
        fs.writeFileSync(path.join(blankRoot, 'guide.md'), '# Гид\n\nТекст про функции.', 'utf8');
        const index = buildDocsIndex({ docsRoot: blankRoot });
        const write = await getPrompt({ index }, 'write_program', { task: 'задача' });
        assert.doesNotMatch(write.messages[0].content.text, /Готовые примеры/);

        const debug = await getPrompt({ index }, 'debug_program', { code: 'fn main() {}' });
        assert.doesNotMatch(debug.messages[0].content.text, /Полный список диагностик/);
        assert.match(debug.messages[0].content.text, /Релевантных страниц/);
    } finally {
        fs.rmSync(blankRoot, { recursive: true, force: true });
    }
});

test('handlers.handle: некорректное сообщение и неизвестное уведомление', async () => {
    const handlers = makeHandlers();
    const invalid = await handlers.handle({ jsonrpc: '2.0', id: 9 });
    assert.equal(invalid.error.code, -32600);
    assert.equal(invalid.id, 9);

    const invalidWithoutId = await handlers.handle(42);
    assert.equal(invalidWithoutId.error.code, -32600);
    assert.equal(invalidWithoutId.id, null);

    assert.equal(await handlers.handle({ jsonrpc: '2.0', method: 'notifications/other' }), null);
    assert.equal(await handlers.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.equal(handlers.initialized, true);
});

test('handlers.handle: exit вызывает hooks.onExit, если он задан', async () => {
    let exits = 0;
    const handlers = makeHandlers({ hooks: { onExit: () => { exits += 1; } } });
    assert.equal(await handlers.handle({ jsonrpc: '2.0', method: 'exit' }), null);
    assert.equal(exits, 1);

    const withoutHook = makeHandlers();
    assert.equal(await withoutHook.handle({ jsonrpc: '2.0', method: 'exit' }), null);
});

test('handlers.handle: ошибка метода без RpcError становится InternalError', async () => {
    const handlers = makeHandlers();
    const params = new Proxy({}, {
        get() {
            throw new TypeError('параметры сломаны');
        },
    });
    const response = await handlers.handle({ jsonrpc: '2.0', id: 3, method: 'initialize', params });
    assert.equal(response.error.code, -32603);
    assert.match(response.error.message, /параметры сломаны/);
});

test('getPrompt: пустые аргументы подставляют пустые строки по умолчанию', async () => {
    const core = createFixtureCore();

    const syntax = await getPrompt({ index: core.index }, 'explain_syntax', null);
    assert.match(syntax.messages[0].content.text, /тему «»/);

    const write = await getPrompt({ index: core.index }, 'write_program', {});
    assert.match(write.messages[0].content.text, /Задача пользователя: \n/);

    const debug = await getPrompt({ index: core.index }, 'debug_program', {});
    assert.match(debug.messages[0].content.text, /Не указано — предложи, как его получить/);
    assert.match(debug.messages[0].content.text, /```latent\n```/);
});

test('getPrompt: длинные выдержки обрезаются и ограничены суммарным объёмом', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-prompt-long-'));
    try {
        for (const name of ['a', 'b', 'c']) {
            const body = `# Лонг ${name}\n\n${'лонг '.repeat(400)}`;
            fs.writeFileSync(path.join(root, `${name}.md`), body, 'utf8');
        }
        const index = buildDocsIndex({ docsRoot: root });
        const prompt = await getPrompt({ index }, 'explain_syntax', { topic: 'лонг' });
        const text = prompt.messages[0].content.text;
        const excerptBlocks = text.split('### ').slice(1);
        assert.equal(excerptBlocks.length, 2, 'третий блок не должен поместиться в лимит');
        assert.match(text, /…/, 'длинная страница должна быть обрезана многоточием');
        assert.ok(text.length < 6000);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
