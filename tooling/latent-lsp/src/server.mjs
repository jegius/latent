// tooling/latent-lsp/src/server.mjs — ядро LSP-сервера Latent.
//
// Диспетчеризация JSON-RPC, жизненный цикл (initialize / initialized /
// shutdown / exit), хранилище документов и отправка ответов. Сами возможности
// (completion/hover/...) и обработка didOpen/didChange живут в features.mjs,
// константы протокола — в capabilities.mjs, транспорт — в jsonrpc.mjs + main.mjs.
// Благодаря этому ядро тестируется напрямую: подаём объекты сообщений и
// перехватываем `send`.

import { DocumentStore } from './documents.mjs';
import { ErrorCodes, errorResponse, response } from './jsonrpc.mjs';
import { NOOP_LOGGER } from './logger.mjs';
import { SERVER_CAPABILITIES, SERVER_NAME, LSP_SERVER_VERSION } from './capabilities.mjs';
import { handleFeatureRequest, handleNotification } from './features.mjs';

export { SERVER_CAPABILITIES, SERVER_NAME } from './capabilities.mjs';

/**
 * Language Server для Latent.
 */
export class LatentLanguageServer {
    /**
     * @param {{
     *   languageData: import('./language-data.mjs').LanguageData,
     *   compiler?: import('./wasm-compiler.mjs').WasmCompiler|null,
     *   logger?: any,
     *   send?: (message: any) => void,
     * }} deps
     */
    constructor({ languageData, compiler = null, logger = NOOP_LOGGER, send = () => {} }) {
        this.languageData = languageData;
        this.compiler = compiler;
        this.logger = logger;
        this.send = send;

        this.documents = new DocumentStore();
        this.initialized = false;
        this.clientReady = false;
        this.shutdownReceived = false;
        this.exitRequested = false;
        this.exitCode = 1;
        /** @type {Set<string|number>} */
        this.cancelled = new Set();
        this.diagnosticsEnabled = true;
        this.clientCapabilities = null;
        this.rootUri = null;
    }

    // --- Точка входа -------------------------------------------------------

    /**
     * Обрабатывает одно входящее сообщение (request или notification).
     * @param {any} message
     */
    handleMessage(message) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            this.send(errorResponse(null, ErrorCodes.InvalidRequest, 'сообщение не является объектом'));
            return;
        }
        if (typeof message.method !== 'string') {
            if (hasId(message)) {
                this.respondError(message.id, ErrorCodes.InvalidRequest, 'в запросе нет method');
            }
            return;
        }
        if (hasId(message)) this.handleRequest(message);
        else this.handleNotification(message);
    }

    /**
     * @param {{id: string|number, method: string, params?: any}} message
     */
    handleRequest(message) {
        const { id, method, params } = message;
        if (this.cancelled.has(id)) {
            this.cancelled.delete(id);
            this.respondError(id, ErrorCodes.RequestCancelled, 'запрос отменён клиентом');
            return;
        }
        try {
            if (method === 'initialize') {
                this.handleInitialize(id, params);
                return;
            }
            if (this.shutdownReceived) {
                this.respondError(id, ErrorCodes.InvalidRequest, 'сервер уже завершён (shutdown)');
                return;
            }
            if (method === 'shutdown') {
                this.shutdownReceived = true;
                this.respond(id, null);
                return;
            }
            if (!this.initialized) {
                this.respondError(id, ErrorCodes.ServerNotInitialized, 'сначала вызовите initialize');
                return;
            }
            handleFeatureRequest(this, id, method, params);
        } catch (e) {
            this.logger.error(`внутренняя ошибка при обработке ${method}: ${e.stack || e.message}`);
            this.respondError(id, ErrorCodes.InternalError, String(e.message || e));
        }
    }

    /**
     * @param {{method: string, params?: any}} message
     */
    handleNotification(message) {
        const known = handleNotification(this, message.method, message.params);
        if (!known) this.logger.debug(`игнорируется уведомление ${message.method}`);
    }

    // --- Жизненный цикл -----------------------------------------------------

    /**
     * @param {string|number} id
     * @param {any} params
     */
    handleInitialize(id, params) {
        if (this.initialized) {
            this.respondError(id, ErrorCodes.InvalidRequest, 'initialize уже был вызван');
            return;
        }
        this.initialized = true;
        this.clientCapabilities = params?.capabilities || null;
        this.rootUri = params?.rootUri || params?.workspaceFolders?.[0]?.uri || null;

        const initOptions = params?.initializationOptions;
        const latentOptions = initOptions?.latent || initOptions || {};
        if (latentOptions.diagnostics === false) {
            this.diagnosticsEnabled = false;
            this.logger.info('диагностика отключена через initializationOptions.latent.diagnostics=false');
        }
        this.logger.info(`initialize: клиент ${params?.clientInfo?.name || 'unknown'}`);
        this.respond(id, {
            capabilities: SERVER_CAPABILITIES,
            serverInfo: { name: SERVER_NAME, version: LSP_SERVER_VERSION },
        });
    }

    // --- Вспомогательные ----------------------------------------------------

    /**
     * Документ из params.textDocument.uri.
     * @param {any} params
     * @returns {import('./documents.mjs').TextDocument|undefined}
     */
    documentFor(params) {
        const uri = params?.textDocument?.uri;
        return uri ? this.documents.get(uri) : undefined;
    }

    /** @param {string|number} id @param {any} result */
    respond(id, result) {
        this.send(response(id, result));
    }

    /** @param {string|number} id @param {number} code @param {string} message */
    respondError(id, code, message) {
        this.send(errorResponse(id, code, message));
    }

    /** @param {string} method @param {any} params */
    notify(method, params) {
        this.send({ jsonrpc: '2.0', method, params });
    }
}

/**
 * Есть ли у сообщения поле id (null — тоже валидный id запроса в JSON-RPC).
 * @param {any} message
 * @returns {boolean}
 */
function hasId(message) {
    return Object.prototype.hasOwnProperty.call(message, 'id');
}
