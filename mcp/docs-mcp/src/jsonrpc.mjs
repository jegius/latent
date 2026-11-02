// jsonrpc.mjs — минимальная реализация JSON-RPC 2.0 для MCP.
//
// Единственная ответственность: коды ошибок, конструкторы ответов и класс
// RpcError, который транспорт/диспетчер превращает в JSON-RPC-ошибку.
// Никакой привязки к MCP-методам здесь нет — только общий протокол.

/** Коды ошибок JSON-RPC 2.0 и MCP-расширения. */
export const ErrorCodes = Object.freeze({
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    /** MCP: сервер ещё не инициализирован (до initialize). */
    ServerNotInitialized: -32002,
    /** MCP: неизвестная/завершённая сессия Streamable HTTP. */
    SessionNotFound: -32001,
});

/**
 * Ошибка протокола: превращается в объект `error` JSON-RPC.
 */
export class RpcError extends Error {
    /**
     * @param {number} code
     * @param {string} message
     * @param {unknown} [data]
     */
    constructor(code, message, data) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
        if (data !== undefined) this.data = data;
    }
}

/**
 * Ошибка неверных параметров метода/инструмента.
 * @param {string} message
 * @param {unknown} [data]
 * @returns {RpcError}
 */
export function invalidParams(message, data) {
    return new RpcError(ErrorCodes.InvalidParams, message, data);
}

/**
 * Успешный ответ.
 * @param {string|number|null} id
 * @param {unknown} result
 * @returns {{jsonrpc: '2.0', id: string|number|null, result: unknown}}
 */
export function success(id, result) {
    return { jsonrpc: '2.0', id: id ?? null, result };
}

/**
 * Ответ с ошибкой.
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {unknown} [data]
 * @returns {{jsonrpc: '2.0', id: string|number|null, error: {code: number, message: string, data?: unknown}}}
 */
export function failure(id, code, message, data) {
    /** @type {{code: number, message: string, data?: unknown}} */
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id ?? null, error };
}

/**
 * Превращает RpcError в ответ; прочие исключения — в InternalError.
 * @param {string|number|null} id
 * @param {unknown} error
 * @returns {object}
 */
export function errorResponse(id, error) {
    if (error instanceof RpcError) {
        return failure(id, error.code, error.message, error.data);
    }
    const message = error && error.message ? String(error.message) : 'Внутренняя ошибка сервера';
    return failure(id, ErrorCodes.InternalError, message);
}

/**
 * Является ли сообщение уведомлением (нет поля id). По JSON-RPC 2.0
 * `id: null` — это запрос, а отсутствие id — уведомление.
 * @param {unknown} message
 * @returns {boolean}
 */
export function isNotification(message) {
    return Boolean(message) && typeof message === 'object' && !Object.prototype.hasOwnProperty.call(message, 'id');
}

/**
 * Проверяет базовую форму JSON-RPC-запроса.
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidRequestShape(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    return typeof message.method === 'string' && message.method.length > 0;
}

/**
 * Код и текст ошибки для некорректного запроса.
 * @param {unknown} message
 * @returns {RpcError}
 */
export function invalidRequest(message) {
    return new RpcError(ErrorCodes.InvalidRequest, 'Некорректный JSON-RPC запрос', {
        hint: 'Ожидается объект {jsonrpc:"2.0", id, method, params}',
        received: message === null ? 'null' : typeof message,
    });
}
