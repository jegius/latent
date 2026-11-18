// tooling/latent-lsp/test/helpers.mjs — общие утилиты тестов.
//
// Два способа проверки сервера:
//   1) in-process: LatentLanguageServer с перехватом send (быстро, без I/O);
//   2) stdio: дочерний процесс bin/server.mjs + JSON-RPC кадры (e2e).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LatentLanguageServer } from '../src/server.mjs';
import { loadLanguageData } from '../src/language-data.mjs';
import { NOOP_LOGGER } from '../src/logger.mjs';
import { FrameReader, serializeMessage } from '../src/jsonrpc.mjs';

/** Корень репозитория Latent. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Путь к исполняемому серверу. */
export const SERVER_BIN = path.join(REPO_ROOT, 'tooling/latent-lsp/bin/server.mjs');

/** Путь к тестовому компилятору (реальный web-ide/compiler.wasm). */
export const COMPILER_WASM = path.join(REPO_ROOT, 'web-ide/compiler.wasm');

/** Загружает данные о языке (кешируется на процесс). */
let cachedLanguageData = null;
export function languageData() {
    if (!cachedLanguageData) cachedLanguageData = loadLanguageData();
    return cachedLanguageData;
}

/**
 * Создаёт сервер в памяти и перехватывает исходящие сообщения.
 * @param {{compiler?: any, diagnostics?: boolean, languageData?: any}} [opts]
 */
export function createInProcessServer(opts = {}) {
    /** @type {any[]} */
    const messages = [];
    const server = new LatentLanguageServer({
        languageData: opts.languageData || languageData(),
        compiler: opts.compiler || null,
        logger: NOOP_LOGGER,
        send: (message) => messages.push(message),
    });
    if (opts.diagnostics === false) server.diagnosticsEnabled = false;

    return {
        server,
        messages,
        /** @param {any} message */
        handle: (message) => server.handleMessage(message),
        /**
         * Отправляет запрос и возвращает ответ.
         * @param {string|number} id
         * @param {string} method
         * @param {any} [params]
         */
        request(id, method, params) {
            server.handleMessage({ jsonrpc: '2.0', id, method, params });
            return messages.find((m) => m.id === id) || null;
        },
        /** @param {string} method @param {any} [params] */
        notify(method, params) {
            server.handleMessage({ jsonrpc: '2.0', method, params });
        },
        /** Все уведомления указанного метода. */
        notifications(method) {
            return messages.filter((m) => m.method === method);
        },
        /** Последняя диагностика для uri. */
        lastDiagnostics(uri) {
            const found = messages.filter((m) => m.method === 'textDocument/publishDiagnostics'
                && m.params?.uri === uri);
            return found.length > 0 ? found[found.length - 1].params : null;
        },
    };
}

/**
 * Клиент stdio-сервера (запускает дочерний процесс).
 */
export class LspClient {
    /**
     * @param {string[]} [args]
     * @param {{cwd?: string}} [opts]
     */
    static spawn(args = ['--stdio'], opts = {}) {
        const child = spawn(process.execPath, [SERVER_BIN, ...args], {
            cwd: opts.cwd || REPO_ROOT,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return new LspClient(child);
    }

    /** @param {import('node:child_process').ChildProcess} child */
    constructor(child) {
        this.child = child;
        this.reader = new FrameReader();
        /** @type {Map<string|number, (message: any) => void>} */
        this.pending = new Map();
        /** @type {any[]} */
        this.messages = [];
        /** @type {any[]} */
        this.notifications = [];
        this.stderr = '';
        this.exitCode = null;
        this.closed = false;

        child.stdout.on('data', (chunk) => this.onData(chunk));
        child.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); });
        child.on('exit', (code) => {
            this.exitCode = code;
            for (const resolve of this.pending.values()) resolve(null);
            this.pending.clear();
        });
    }

    /** @param {Buffer} chunk */
    onData(chunk) {
        this.reader.push(chunk);
        for (;;) {
            const entry = this.reader.next();
            if (!entry) return;
            if (entry.parseError || entry.frameError) continue;
            const message = entry.message;
            this.messages.push(message);
            if (message.id !== undefined) {
                const resolve = this.pending.get(message.id);
                if (resolve) {
                    this.pending.delete(message.id);
                    resolve(message);
                }
            } else if (message.method) {
                this.notifications.push(message);
            }
        }
    }

    /**
     * Отправляет запрос и ждёт ответ.
     * @param {string|number} id
     * @param {string} method
     * @param {any} [params]
     * @param {number} [timeoutMs]
     * @returns {Promise<any>}
     */
    request(id, method, params, timeoutMs = 10000) {
        const promise = new Promise((resolve) => {
            this.pending.set(id, resolve);
        });
        this.send({ jsonrpc: '2.0', id, method, params });
        return withTimeout(promise, timeoutMs, `ответ на ${method} (id=${id})`);
    }

    /**
     * @param {string} method
     * @param {any} [params]
     */
    notify(method, params) {
        this.send({ jsonrpc: '2.0', method, params });
    }

    /** @param {any} message */
    send(message) {
        this.child.stdin.write(serializeMessage(message));
    }

    /** Выполняет initialize + initialized. */
    async initialize(initializationOptions) {
        const response = await this.request(1, 'initialize', {
            processId: process.pid,
            rootUri: 'file://' + REPO_ROOT.replace(/\\/g, '/'),
            capabilities: {},
            initializationOptions,
        });
        this.notify('initialized', {});
        return response;
    }

    /**
     * Ждёт уведомление, удовлетворяющее предикату.
     * @param {string} method
     * @param {(params: any) => boolean} [predicate]
     * @param {number} [timeoutMs]
     */
    async waitForNotification(method, predicate = () => true, timeoutMs = 10000) {
        const started = Date.now();
        for (;;) {
            const found = this.notifications.find((n) => n.method === method
                && predicate(n.params));
            if (found) return found.params;
            if (Date.now() - started > timeoutMs) {
                throw new Error(`таймаут ожидания ${method}; stderr: ${this.stderr.slice(0, 500)}`);
            }
            await delay(20);
        }
    }

    /**
     * Завершает клиента: shutdown, exit, ожидание выхода процесса.
     * @returns {Promise<number|null>} код выхода процесса
     */
    async shutdown() {
        if (this.closed) return this.exitCode;
        this.closed = true;
        await this.request(9999, 'shutdown', null, 5000).catch(() => null);
        this.notify('exit', null);
        try {
            this.child.stdin.end();
        } catch (e) { /* already closed */ }
        const code = await waitForExit(this.child, 10000);
        return code;
    }

    /** Аварийно убивает процесс. */
    kill() {
        this.closed = true;
        try {
            this.child.kill();
        } catch (e) { /* already dead */ }
    }
}

/**
 * Промис с таймаутом.
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {string} label
 */
export function withTimeout(promise, ms, label = 'операция') {
    return Promise.race([
        promise,
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`таймаут: ${label}`)), ms);
            if (typeof timer.unref === 'function') timer.unref();
            promise.then(() => clearTimeout(timer), () => clearTimeout(timer));
            void resolve;
        }),
    ]);
}

/**
 * Ждёт завершения дочернего процесса.
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [timeoutMs]
 * @returns {Promise<number|null>}
 */
export function waitForExit(child, timeoutMs = 10000) {
    if (child.exitCode !== null) return Promise.resolve(child.exitCode);
    return withTimeout(new Promise((resolve) => {
        child.on('exit', (code) => resolve(code));
    }), timeoutMs, 'выход дочернего процесса');
}

/** @param {number} ms */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** LSP-позиция конца документа (для правок). */
export function endPosition(text) {
    const lines = text.split('\n');
    return { line: lines.length - 1, character: lines[lines.length - 1].length };
}
