// handlers.mjs — диспетчер MCP-методов.
//
// Единственная ответственность: по имени JSON-RPC метода вызвать нужный
// обработчик MCP (initialize, tools/*, resources/*, prompts/*, ping,
// shutdown, exit) и вернуть результат либо объект ошибки. Транспортные
// детали (stdio/HTTP) здесь отсутствуют.

import {
    ErrorCodes,
    RpcError,
    errorResponse,
    invalidParams,
    isNotification,
    isValidRequestShape,
    invalidRequest,
    success,
} from './jsonrpc.mjs';
import { buildResourceList, buildResourceTemplates, readResource } from './resources.mjs';
import { buildPromptList, getPrompt, requiredArguments } from './prompts.mjs';
import { ToolError, createToolHandlers } from './tools.mjs';
import { TOOLS } from './tool-defs.mjs';
import { SERVER_NAME, SERVER_VERSION } from './version.mjs';

/** Поддерживаемые версии протокола MCP (первая — предпочтительная). */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Инструкции, которые сервер отдаёт клиенту в initialize. */
export const SERVER_INSTRUCTIONS =
    'Сервер документации языка Latent. Начните с list_docs или search_docs, читайте страницы через read_doc, '
    + 'справочник доступен в get_language_reference, примеры — в get_example, проверка кода — в check_code. '
    + 'Все ресурсы (latent-docs://...) — read-only Markdown.';

/**
 * Создаёт набор обработчиков MCP-методов.
 * @param {{index: object, examples: object, compiler: object, docsRoot: string, hooks: object}} ctx
 * @returns {{handle: (message: object) => Promise<object|null>, initialized: boolean}}
 */
export function createHandlers(ctx) {
    const toolRuntime = createToolHandlers(ctx);
    const state = { initialized: false };

    /**
     * Формирует ответ initialize с согласованием версии протокола.
     * @param {Record<string, unknown>} params
     * @returns {object}
     */
    function initializeResult(params) {
        const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0];
        state.initialized = true;

        return {
            protocolVersion,
            capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
            },
            serverInfo: {
                name: SERVER_NAME,
                title: 'Документация языка Latent',
                version: SERVER_VERSION,
            },
            instructions: SERVER_INSTRUCTIONS,
        };
    }

    /**
     * Упаковывает успешный вызов инструмента в MCP-результат.
     * @param {{text: string, structured: object}} outcome
     * @returns {object}
     */
    function toolResult(outcome) {
        const result = { content: [{ type: 'text', text: outcome.text }] };
        if (outcome.structured && typeof outcome.structured === 'object') {
            result.structuredContent = outcome.structured;
        }
        return result;
    }

    /** @type {Record<string, (params: Record<string, unknown>) => Promise<object>|object>} */
    const methods = {
        initialize(params) {
            return initializeResult(params);
        },

        ping() {
            return {};
        },

        shutdown() {
            state.initialized = false;
            return null;
        },

        'tools/list'() {
            return { tools: TOOLS };
        },

        async 'tools/call'(params) {
            const name = params.name;
            try {
                const outcome = await toolRuntime.call(typeof name === 'string' ? name : '', params.arguments);
                return toolResult(outcome);
            } catch (error) {
                if (error instanceof ToolError) {
                    return {
                        content: [{ type: 'text', text: error.message }],
                        isError: true,
                    };
                }
                throw error;
            }
        },

        'resources/list'() {
            return buildResourceList(ctx.index);
        },

        'resources/templates/list'() {
            return buildResourceTemplates();
        },

        'resources/read'(params) {
            const uri = params.uri;
            if (typeof uri !== 'string' || !uri.trim()) {
                throw invalidParams('Параметр «uri» обязателен и должен быть строкой');
            }
            const resource = readResource(ctx.index, uri);
            if (!resource) {
                throw new RpcError(ErrorCodes.InvalidParams, `Ресурс не найден: ${uri}`, {
                    hint: 'Список ресурсов: resources/list; оглавление: latent-docs://index',
                });
            }
            return resource;
        },

        'prompts/list'() {
            return buildPromptList();
        },

        async 'prompts/get'(params) {
            const name = params.name;
            if (typeof name !== 'string' || !name.trim()) {
                throw invalidParams('Параметр «name» промпта обязателен');
            }
            const known = buildPromptList().prompts.some((prompt) => prompt.name === name);
            if (!known) {
                throw invalidParams(`Неизвестный prompt «${name}». Доступно: ${buildPromptList().prompts.map((item) => item.name).join(', ')}`);
            }

            const promptArgs = params.arguments;
            if (promptArgs !== undefined && (typeof promptArgs !== 'object' || promptArgs === null || Array.isArray(promptArgs))) {
                throw invalidParams('Параметр «arguments» должен быть JSON-объектом');
            }
            const values = /** @type {Record<string, unknown>} */ (promptArgs || {});

            for (const required of requiredArguments(name)) {
                if (typeof values[required] !== 'string' || !values[required].trim()) {
                    throw invalidParams(`Для prompt «${name}» обязателен аргумент «${required}»`);
                }
            }

            const prompt = await getPrompt(ctx, name, values);
            if (!prompt) {
                throw invalidParams(`Не удалось собрать prompt «${name}»`);
            }
            return prompt;
        },
    };

    /**
     * Обрабатывает одно JSON-RPC сообщение.
     * @param {object} message
     * @returns {Promise<object|null>} null — уведомление (ответ не отправляется)
     */
    async function handle(message) {
        if (!isValidRequestShape(message)) {
            return errorResponse(message && message.id !== undefined ? message.id : null, invalidRequest(message));
        }

        const id = message.id;
        const method = message.method;
        const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
            ? message.params
            : {};

        // Уведомления: initialized/exit/прочие — без ответа.
        if (isNotification(message)) {
            if (method === 'notifications/initialized' || method === 'initialized') {
                state.initialized = true;
            } else if (method === 'exit') {
                if (ctx.hooks && typeof ctx.hooks.onExit === 'function') ctx.hooks.onExit();
            } else if (method === 'notifications/cancelled') {
                // Отмена запроса: синхронных долгих операций у сервера нет.
            }
            return null;
        }

        const handler = methods[method];
        if (!handler) {
            return errorResponse(id, new RpcError(ErrorCodes.MethodNotFound, `Метод не найден: ${method}`));
        }

        try {
            const result = await handler(params);
            return success(id, result);
        } catch (error) {
            return errorResponse(id, error);
        }
    }

    return {
        handle,
        get initialized() {
            return state.initialized;
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
}
