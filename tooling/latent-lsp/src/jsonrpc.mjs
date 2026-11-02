// tooling/latent-lsp/src/jsonrpc.mjs — транспорт JSON-RPC 2.0 поверх stdio.
//
// LSP кодирует сообщения заголовком `Content-Length: N\r\n\r\n` и телом JSON в
// UTF-8. Модуль содержит только кадрирование и коды ошибок; диспетчеризация
// методов живёт в server.mjs.

/** Коды ошибок JSON-RPC 2.0 / LSP. */
export const ErrorCodes = {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    ServerNotInitialized: -32002,
    RequestCancelled: -32800,
};

/** Максимальный размер тела сообщения (защита от мусора в stdin). */
export const MAX_CONTENT_LENGTH = 64 * 1024 * 1024;

/**
 * Ошибка кадрирования (битый заголовок Content-Length).
 */
export class FrameError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'FrameError';
    }
}

/**
 * Инкрементальный читатель кадров LSP.
 */
export class FrameReader {
    constructor() {
        /** @type {Buffer} */
        this.buffer = Buffer.alloc(0);
    }

    /**
     * Добавляет полученные байты в буфер.
     * @param {Buffer|Uint8Array|string} chunk
     */
    push(chunk) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.buffer = this.buffer.length === 0 ? buf : Buffer.concat([this.buffer, buf]);
    }

    /**
     * Пытается прочитать следующее сообщение.
     * @returns {{message: any}|{parseError: Error}|{frameError: Error}|null}
     *   null — данных пока недостаточно.
     */
    next() {
        const header = findHeaderEnd(this.buffer);
        if (!header) return null;

        const headerText = this.buffer.subarray(0, header.index).toString('utf8');
        let contentLength;
        try {
            contentLength = parseContentLength(headerText);
        } catch (e) {
            // Битый заголовок: сбрасываем буфер, чтобы не зациклиться.
            this.buffer = this.buffer.subarray(header.next);
            return { frameError: e };
        }

        const bodyStart = header.next;
        if (this.buffer.length < bodyStart + contentLength) return null;

        const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
        this.buffer = this.buffer.subarray(bodyStart + contentLength);

        try {
            return { message: JSON.parse(body) };
        } catch (e) {
            return { parseError: e };
        }
    }

    /** Есть ли незавершённые данные. */
    hasPending() {
        return this.buffer.length > 0;
    }
}

/**
 * Ищет конец блока заголовков (\r\n\r\n или \n\n).
 * @param {Buffer} buffer
 * @returns {{index: number, next: number}|null}
 */
export function findHeaderEnd(buffer) {
    const crlf = buffer.indexOf('\r\n\r\n');
    const lf = buffer.indexOf('\n\n');
    if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { index: crlf, next: crlf + 4 };
    if (lf >= 0) return { index: lf, next: lf + 2 };
    return null;
}

/**
 * Разбирает Content-Length из заголовков.
 * @param {string} headerText
 * @returns {number}
 */
export function parseContentLength(headerText) {
    const match = /(?:^|\r?\n)content-length:\s*(\d+)/i.exec(headerText);
    if (!match) throw new FrameError('во фрейме нет заголовка Content-Length');
    const length = Number.parseInt(match[1], 10);
    if (!Number.isFinite(length) || length < 0 || length > MAX_CONTENT_LENGTH) {
        throw new FrameError(`недопустимый Content-Length: ${match[1]}`);
    }
    return length;
}

/**
 * Сериализует сообщение в кадр LSP.
 * @param {any} message
 * @returns {Buffer}
 */
export function serializeMessage(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    return Buffer.concat([header, body]);
}

/**
 * Формирует успешный ответ JSON-RPC.
 * @param {string|number} id
 * @param {any} result
 */
export function response(id, result) {
    return { jsonrpc: '2.0', id, result };
}

/**
 * Формирует ответ-ошибку JSON-RPC.
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {any} [data]
 */
export function errorResponse(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id, error };
}
