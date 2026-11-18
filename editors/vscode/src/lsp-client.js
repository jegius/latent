'use strict';

// Минимальный LSP-клиент для VS Code-расширения Latent.
//
// Zero deps: только Node.js stdlib. Транспорт — stdio JSON-RPC 2.0 с
// заголовком `Content-Length` (LSP 3.17). Клиент не знает про API VS Code:
// он принимает колбэки на диагностику/уведомления, поэтому полностью
// покрывается тестами с фейковым сервером.
//
// Сервер по умолчанию: <repo>/tooling/latent-lsp/bin/server.mjs.
// Если файла нет — start() возвращает false (graceful degradation), и
// расширение продолжает работать без LSP.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONTENT_LENGTH_RE = /Content-Length:\s*(\d+)/iu;
const HEADER_SEPARATOR = '\r\n\r\n';

const CLIENT_CAPABILITIES = {
    workspace: {
        workspaceFolders: true,
        configuration: false,
        didChangeConfiguration: { dynamicRegistration: false },
    },
    textDocument: {
        synchronization: {
            dynamicRegistration: false,
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true,
        },
        completion: {
            dynamicRegistration: false,
            completionItem: {
                snippetSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                insertReplaceSupport: false,
            },
            contextSupport: true,
        },
        hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext'],
        },
        signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
                documentationFormat: ['markdown', 'plaintext'],
                parameterInformation: { labelOffsetSupport: true },
            },
        },
        formatting: { dynamicRegistration: false },
        documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
        definition: { dynamicRegistration: false },
        publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
            tagSupport: { valueSet: [1, 2] },
        },
    },
};

/**
 * Корень репозитория относительно каталога расширения.
 * @param {string} extensionPath
 * @returns {string|null}
 */
function repoRootFor(extensionPath) {
    if (!extensionPath) return null;
    return path.resolve(extensionPath, '..', '..');
}

/**
 * Путь к LSP-серверу: явная настройка → <repo>/tooling/latent-lsp/bin/server.mjs.
 * @param {{configuredPath?: string, extensionPath?: string, workspaceRoot?: string}} [options]
 * @returns {string}
 */
function resolveServerPath(options = {}) {
    if (options.configuredPath) return path.resolve(options.configuredPath);
    const root = repoRootFor(options.extensionPath);
    if (root) {
        return path.join(root, 'tooling', 'latent-lsp', 'bin', 'server.mjs');
    }
    if (options.workspaceRoot) {
        return path.join(options.workspaceRoot, 'tooling', 'latent-lsp', 'bin', 'server.mjs');
    }
    return '';
}

/**
 * Существует ли LSP-сервер.
 * @param {string} serverPath
 * @returns {boolean}
 */
function serverExists(serverPath) {
    try {
        return Boolean(serverPath) && fs.existsSync(serverPath);
    } catch (e) {
        return false;
    }
}

/**
 * Конечная позиция текста в координатах LSP (0-based, UTF-16).
 * @param {string} text
 * @returns {{line: number, character: number}}
 */
function endPosition(text) {
    const lines = String(text ?? '').split('\n');
    return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
    };
}

class LspClient {
    /**
     * @param {{
     *   serverPath?: string,
     *   extensionPath?: string,
     *   workspaceRoot?: string,
     *   nodePath?: string,
     *   args?: Array<string>,
     *   cwd?: string,
     *   env?: Record<string, string>,
     *   rootUri?: string|null,
     *   logger?: (message: string) => void,
     *   onDiagnostics?: (params: object) => void,
     *   onNotification?: (method: string, params: object|undefined) => void,
     *   onStateChange?: (state: string, detail: string) => void,
     *   requestTimeout?: number,
     * }} [options]
     */
    constructor(options = {}) {
        this.serverPath = options.serverPath || resolveServerPath(options);
        this.nodePath = options.nodePath || process.execPath;
        this.args = Array.isArray(options.args) ? options.args.slice() : ['--stdio'];
        this.cwd = options.cwd || (options.extensionPath || process.cwd());
        this.env = { ...process.env, ...(options.env || {}) };
        this.rootUri = options.rootUri || null;
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this.onDiagnostics = typeof options.onDiagnostics === 'function' ? options.onDiagnostics : () => {};
        this.onNotification = typeof options.onNotification === 'function' ? options.onNotification : () => {};
        this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
        this.requestTimeout = Number.isFinite(options.requestTimeout) ? options.requestTimeout : 10000;

        this.child = null;
        this.state = 'stopped';
        this.serverInfo = null;
        this.capabilities = {};
        this.lastError = '';
        this._seq = 0;
        this._pending = new Map();
        this._buffer = Buffer.alloc(0);
        this._documents = new Map();
        this._stopping = false;
    }

    /** @returns {boolean} */
    get isRunning() {
        return this.state === 'running';
    }

    /** @returns {string} */
    get stateLabel() {
        switch (this.state) {
            case 'running': return 'LSP: работает';
            case 'starting': return 'LSP: запуск…';
            case 'missing': return 'LSP: сервер не найден';
            case 'error': return 'LSP: ошибка';
            default: return 'LSP: выключен';
        }
    }

    _setState(state, detail = '') {
        this.state = state;
        try {
            this.onStateChange(state, detail);
        } catch (e) {
            this.logger(`onStateChange: ${e.message}`);
        }
    }

    /**
     * Запускает сервер и выполняет initialize/initialized.
     * @returns {Promise<boolean>}
     */
    async start() {
        if (this.state === 'running' || this.state === 'starting') return true;
        if (!serverExists(this.serverPath)) {
            this.lastError = `LSP-сервер не найден: ${this.serverPath || '(путь не задан)'}`;
            this._setState('missing', this.lastError);
            return false;
        }

        this._setState('starting', this.serverPath);
        this._buffer = Buffer.alloc(0);
        this._stopping = false;

        const isScript = /\.(?:mjs|cjs|js)$/iu.test(this.serverPath);
        const command = isScript ? (this.nodePath || process.execPath) : this.serverPath;
        const args = isScript ? [this.serverPath, ...this.args] : this.args;

        try {
            this.child = spawn(command, args, {
                cwd: this.cwd,
                env: this.env,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (e) {
            this.lastError = `Не удалось запустить LSP-сервер: ${e.message}`;
            this._setState('error', this.lastError);
            return false;
        }

        const child = this.child;
        child.on('error', (error) => {
            if (this.child !== child) return;
            this.lastError = `Ошибка LSP-сервера: ${error.message}`;
            this.logger(this.lastError);
            this._rejectPending(this.lastError);
            this._setState('error', this.lastError);
        });
        // EPIPE при записи в уже завершившийся процесс — штатная ситуация при
        // остановке/падении сервера; не даём ей стать uncaughtException.
        child.stdin.on('error', (error) => {
            if (this.child !== child) return;
            this.logger(`[lsp stdin] ${error.message}`);
            this._rejectPending(`LSP stdin: ${error.message}`);
        });
        child.stdout.on('error', (error) => this.logger(`[lsp stdout] ${error.message}`));
        child.stderr.on('error', (error) => this.logger(`[lsp stderr] ${error.message}`));
        child.stdout.on('data', (chunk) => {
            if (this.child === child) this._onData(chunk);
        });
        child.stderr.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (text) this.logger(`[lsp stderr] ${text}`);
        });
        child.on('exit', (code, signal) => {
            if (this.child !== child) return;
            const reason = `LSP-сервер завершился (code=${code}, signal=${signal || 'нет'})`;
            this._rejectPending(reason);
            this.child = null;
            this._buffer = Buffer.alloc(0);
            if (!this._stopping) {
                this.lastError = reason;
                this._setState('stopped', reason);
            }
        });

        const rootUri = this.rootUri;
        const initializeParams = {
            processId: process.pid,
            clientInfo: { name: 'latent-vscode', version: '1.0.0' },
            locale: 'ru',
            rootUri,
            capabilities: CLIENT_CAPABILITIES,
            workspaceFolders: rootUri ? [{ uri: rootUri, name: path.basename(rootUri) || 'workspace' }] : null,
            initializationOptions: {},
            trace: 'off',
        };

        try {
            const result = await this.request('initialize', initializeParams, this.requestTimeout);
            this.capabilities = (result && result.capabilities) || {};
            this.serverInfo = (result && result.serverInfo) || null;
            if (this.serverInfo && this.serverInfo.name) {
                this.logger(`LSP-сервер: ${this.serverInfo.name} ${this.serverInfo.version || ''}`.trim());
            }
            this._setState('running', this.serverInfo ? this.serverInfo.name : '');
            this.notify('initialized', {});
            return true;
        } catch (e) {
            this.lastError = `Инициализация LSP не удалась: ${e.message}`;
            this._setState('error', this.lastError);
            this._shutdownChild();
            return false;
        }
    }

    /**
     * Перезапуск сервера.
     * @returns {Promise<boolean>}
     */
    async restart() {
        await this.stop();
        return this.start();
    }

    /**
     * Останавливает сервер (shutdown/exit, затем kill при необходимости).
     * @returns {Promise<void>}
     */
    async stop() {
        this._stopping = true;
        const child = this.child;
        if (!child) {
            this._rejectPending('LSP остановлен');
            this._setState('stopped', 'остановлен');
            this._stopping = false;
            return;
        }
        if (this.state === 'running') {
            try {
                await this.request('shutdown', null, 1000);
            } catch (e) {
                // Сервер мог уже умереть — это нормально.
            }
            try {
                this.notify('exit', null);
            } catch (e) {
                // Игнорируем.
            }
        }
        this._rejectPending('LSP остановлен');
        this._shutdownChild();
        this._stopping = false;
        this._setState('stopped', 'остановлен');
    }

    /** Освобождает ресурсы (алиас stop для deactivate). */
    async dispose() {
        await this.stop();
    }

    _shutdownChild() {
        const child = this.child;
        this.child = null;
        if (!child) return;
        try {
            if (child.stdin && !child.stdin.destroyed) child.stdin.end();
        } catch (e) { /* ignore */ }
        try {
            child.kill();
        } catch (e) { /* ignore */ }
    }

    _rejectPending(reason) {
        for (const [, pending] of this._pending) {
            if (pending.timer) clearTimeout(pending.timer);
            try {
                pending.reject(new Error(reason));
            } catch (e) { /* ignore */ }
        }
        this._pending.clear();
    }

    _canSend() {
        return Boolean(this.child && this.child.stdin && !this.child.stdin.destroyed && this.child.stdin.writable);
    }

    _send(message) {
        if (!this._canSend()) {
            throw new Error('LSP-сервер не запущен');
        }
        const body = Buffer.from(JSON.stringify(message), 'utf8');
        const header = `Content-Length: ${body.length}${HEADER_SEPARATOR}`;
        this.child.stdin.write(header, 'ascii');
        this.child.stdin.write(body);
    }

    _onData(chunk) {
        if (!chunk || chunk.length === 0) return;
        this._buffer = this._buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this._buffer, chunk]);
        while (true) {
            const headerEnd = this._buffer.indexOf(HEADER_SEPARATOR);
            if (headerEnd < 0) break;
            const header = this._buffer.subarray(0, headerEnd).toString('ascii');
            const match = CONTENT_LENGTH_RE.exec(header);
            if (!match) {
                this.logger('LSP: заголовок без Content-Length — пропускаю пакет');
                this._buffer = this._buffer.subarray(headerEnd + HEADER_SEPARATOR.length);
                continue;
            }
            const length = Number(match[1]);
            const bodyStart = headerEnd + HEADER_SEPARATOR.length;
            if (this._buffer.length < bodyStart + length) break;
            const body = this._buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
            this._buffer = this._buffer.subarray(bodyStart + length);
            let message;
            try {
                message = JSON.parse(body);
            } catch (e) {
                this.logger(`LSP: некорректный JSON — ${e.message}`);
                continue;
            }
            this._dispatch(message);
        }
    }

    _dispatch(message) {
        if (!message || typeof message !== 'object') return;

        if (message.id !== undefined && message.method === undefined) {
            const pending = this._pending.get(message.id);
            if (!pending) return;
            this._pending.delete(message.id);
            if (pending.timer) clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(new Error(message.error.message || 'Ошибка LSP-запроса'));
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        if (typeof message.method !== 'string') return;

        if (message.method === 'textDocument/publishDiagnostics') {
            try {
                this.onDiagnostics(message.params || {});
            } catch (e) {
                this.logger(`onDiagnostics: ${e.message}`);
            }
        }

        try {
            this.onNotification(message.method, message.params);
        } catch (e) {
            this.logger(`onNotification: ${e.message}`);
        }

        // Запросы сервера к клиенту: отвечаем null/[] — расширению они не нужны.
        if (message.id !== undefined) {
            let result = null;
            if (message.method === 'workspace/configuration') result = [];
            try {
                this._send({ jsonrpc: '2.0', id: message.id, result });
            } catch (e) {
                this.logger(`LSP: не удалось ответить на ${message.method}: ${e.message}`);
            }
        }
    }

    /**
     * JSON-RPC-запрос к серверу.
     * @param {string} method
     * @param {object|null} params
     * @param {number} [timeoutMs]
     * @returns {Promise<any>}
     */
    request(method, params = null, timeoutMs = this.requestTimeout) {
        if (!this._canSend()) {
            return Promise.reject(new Error('LSP-сервер не запущен'));
        }
        const id = ++this._seq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`Таймаут LSP-запроса «${method}» (${timeoutMs} мс)`));
            }, timeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
            this._pending.set(id, { resolve, reject, timer, method });
            try {
                this._send({ jsonrpc: '2.0', id, method, params });
            } catch (e) {
                clearTimeout(timer);
                this._pending.delete(id);
                reject(e);
            }
        });
    }

    /**
     * JSON-RPC-уведомление (без ответа).
     * @param {string} method
     * @param {object|null} params
     * @returns {boolean}
     */
    notify(method, params = null) {
        if (!this._canSend()) return false;
        try {
            this._send({ jsonrpc: '2.0', method, params });
            return true;
        } catch (e) {
            this.logger(`LSP notify ${method}: ${e.message}`);
            return false;
        }
    }

    openDocument(uri, text, options = {}) {
        this._documents.set(uri, String(text ?? ''));
        return this.notify('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: options.languageId || 'latent',
                version: options.version || 1,
                text,
            },
        });
    }

    changeDocument(uri, version, text) {
        const nextText = String(text ?? '');
        const previous = this._documents.get(uri);
        this._documents.set(uri, nextText);
        // Сервер объявляет инкрементальную синхронизацию, поэтому даже полную
        // замену отправляем как изменение диапазона всего предыдущего текста.
        const change = typeof previous === 'string'
            ? {
                range: {
                    start: { line: 0, character: 0 },
                    end: endPosition(previous),
                },
                text: nextText,
            }
            : { text: nextText };
        return this.notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [change],
        });
    }

    saveDocument(uri, text) {
        const params = { textDocument: { uri } };
        if (typeof text === 'string') params.text = text;
        return this.notify('textDocument/didSave', params);
    }

    closeDocument(uri) {
        this._documents.delete(uri);
        return this.notify('textDocument/didClose', { textDocument: { uri } });
    }

    completion(uri, position, context = null) {
        const params = { textDocument: { uri }, position };
        if (context) params.context = context;
        return this.request('textDocument/completion', params);
    }

    hover(uri, position) {
        return this.request('textDocument/hover', { textDocument: { uri }, position });
    }

    signatureHelp(uri, position) {
        return this.request('textDocument/signatureHelp', { textDocument: { uri }, position });
    }

    formatting(uri, options = {}) {
        return this.request('textDocument/formatting', {
            textDocument: { uri },
            options: {
                tabSize: options.tabSize || 4,
                insertSpaces: options.insertSpaces !== false,
            },
        });
    }

    documentSymbols(uri) {
        return this.request('textDocument/documentSymbol', { textDocument: { uri } });
    }

    definition(uri, position) {
        return this.request('textDocument/definition', { textDocument: { uri }, position });
    }
}

module.exports = {
    CLIENT_CAPABILITIES,
    LspClient,
    repoRootFor,
    resolveServerPath,
    serverExists,
};
