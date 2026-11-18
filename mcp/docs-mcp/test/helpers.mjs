// helpers.mjs — общие утилиты тестов MCP-сервера документации.
//
// Не является тестом (имя без .test.mjs): здесь создание ядра на фикстурах,
// вызовы JSON-RPC, запуск HTTP-сервера и stdio-клиент для интеграционных тестов.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createCore } from '../src/core.mjs';
import { REPO_ROOT, resolveWasmPath } from '../src/paths.mjs';
import { startHttpServer } from '../src/http.mjs';

/** Каталог этого пакета (mcp/docs-mcp). */
export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Путь к bin/server.mjs. */
export const SERVER_BIN = path.join(PACKAGE_DIR, 'bin', 'server.mjs');

/** Каталог тестовых фикстур документации. */
export const FIXTURES_DOCS = path.join(PACKAGE_DIR, 'test', 'fixtures', 'docs');

/** Путь к настоящему compiler.wasm репозитория. */
export const REAL_WASM = resolveWasmPath({ repoRoot: REPO_ROOT });

/**
 * Создаёт ядро MCP-сервера на фикстурах документации.
 * @param {{docsRoot?: string, wasmPath?: string, hooks?: object}} [overrides]
 * @returns {object}
 */
export function createFixtureCore(overrides = {}) {
    return createCore({
        docsRoot: FIXTURES_DOCS,
        repoRoot: REPO_ROOT,
        wasmPath: REAL_WASM,
        hooks: {},
        ...overrides,
    });
}

/**
 * Отправляет JSON-RPC запрос в ядро.
 * @param {object} core
 * @param {string} method
 * @param {unknown} [params]
 * @param {number|string} [id]
 * @returns {Promise<object>}
 */
export function rpc(core, method, params, id = 1) {
    return core.handlePayload({ jsonrpc: '2.0', id, method, params });
}

/**
 * Вызывает MCP-инструмент.
 * @param {object} core
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {number|string} [id]
 * @returns {Promise<object>}
 */
export function callTool(core, name, args = {}, id = 2) {
    return rpc(core, 'tools/call', { name, arguments: args }, id);
}

/**
 * Достаёт structuredContent из успешного ответа инструмента.
 * @param {object} response
 * @returns {any}
 */
export function toolData(response) {
    if (!response || !response.result) throw new Error(`Нет result в ответе: ${JSON.stringify(response)}`);
    return response.result.structuredContent;
}

/**
 * Запускает HTTP-сервер на свободном порту.
 * @param {{core?: object, stateless?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function startFixtureHttp(options = {}) {
    const core = options.core || createFixtureCore();
    return startHttpServer({
        core,
        host: '127.0.0.1',
        port: 0,
        stateless: Boolean(options.stateless),
        logger: { error: () => {} },
    });
}

/** Заголовки клиента HTTP MCP. */
export const JSON_HEADERS = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
};

/**
 * POST JSON-RPC на /mcp.
 * @param {string} baseUrl корень сервера или полный URL /mcp
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{status: number, headers: Headers, body: any}>}
 */
export async function httpPost(baseUrl, payload, headers = {}) {
    const endpoint = baseUrl.endsWith('/mcp') ? baseUrl : `${baseUrl}/mcp`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...headers },
        body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    return { status: response.status, headers: response.headers, body };
}

/**
 * Создаёт stdio-клиент к серверу: пишет Content-Length фреймы, читает ответы.
 * @param {{args?: string[]}} [options]
 * @returns {object} клиент с методами
 */
export function createStdioClient(options = {}) {
    const child = spawn(process.execPath, [SERVER_BIN, '--stdio', ...(options.args || [])], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    /** @type {Buffer} */
    let buffer = Buffer.alloc(0);
    const messages = [];
    /** @type {{predicate: Function, resolve: Function, reject: Function, timer: NodeJS.Timeout}[]} */
    const waiters = [];
    let stderr = '';

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
    });

    /** @param {Buffer} chunk */
    function onData(chunk) {
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
        while (true) {
            const separator = buffer.indexOf('\r\n\r\n');
            if (separator === -1) break;
            const headerText = buffer.slice(0, separator).toString('utf8');
            const match = /content-length:\s*(\d+)/i.exec(headerText);
            if (!match) {
                buffer = buffer.slice(separator + 4);
                continue;
            }
            const length = Number(match[1]);
            const start = separator + 4;
            if (buffer.length < start + length) break;
            const payload = buffer.slice(start, start + length).toString('utf8');
            buffer = buffer.slice(start + length);
            let parsed;
            try {
                parsed = JSON.parse(payload);
            } catch {
                continue;
            }
            messages.push(parsed);
            for (let index = waiters.length - 1; index >= 0; index -= 1) {
                const waiter = waiters[index];
                if (waiter.predicate(parsed, messages)) {
                    clearTimeout(waiter.timer);
                    waiters.splice(index, 1);
                    waiter.resolve(parsed);
                }
            }
        }
    }

    child.stdout.on('data', onData);

    /**
     * Ждёт сообщение, удовлетворяющее предикату.
     * @param {(message: object, all: object[]) => boolean} predicate
     * @param {number} [timeoutMs]
     * @returns {Promise<object>}
     */
    function waitFor(predicate, timeoutMs = 10000) {
        for (const message of messages) {
            if (predicate(message, messages)) return Promise.resolve(message);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Таймаут ожидания stdio-сообщения. stderr: ${stderr}`));
            }, timeoutMs);
            waiters.push({ predicate, resolve, reject, timer });
        });
    }

    /**
     * Ждёт ответ с указанным id.
     * @param {string|number} id
     * @returns {Promise<object>}
     */
    function waitForId(id) {
        return waitFor((message) => message.id === id);
    }

    /**
     * Отправляет сообщение с Content-Length.
     * @param {unknown} message
     */
    function send(message) {
        const payload = Buffer.from(JSON.stringify(message), 'utf8');
        child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
        child.stdin.write(payload);
    }

    /**
     * Отправляет сырой текст (например, NDJSON-строку).
     * @param {string} text
     */
    function sendRaw(text) {
        child.stdin.write(text);
    }

    /** @returns {Promise<number>} код выхода */
    function waitForExit(timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            if (child.exitCode !== null) {
                resolve(child.exitCode);
                return;
            }
            const timer = setTimeout(() => reject(new Error(`Процесс не завершился. stderr: ${stderr}`)), timeoutMs);
            child.once('exit', (code) => {
                clearTimeout(timer);
                resolve(code ?? 0);
            });
        });
    }

    return {
        child,
        messages,
        send,
        sendRaw,
        waitFor,
        waitForId,
        waitForExit,
        getStderr: () => stderr,
        kill: () => {
            try {
                child.kill();
            } catch {
                // Процесс уже завершён.
            }
        },
    };
}
