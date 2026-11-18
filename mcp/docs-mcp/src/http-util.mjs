// http-util.mjs — общие HTTP-утилиты транспорта.
//
// Единственная ответственность: CORS-заголовки, отправка JSON/HTML, ответ 405
// и чтение тела запроса с ограничением размера. Никакой маршрутизации и
// MCP-логики здесь нет.

import { corsHeaders } from './http-cors.mjs';

export { corsHeaders };

/** Максимальный размер JSON-RPC тела запроса — 1 МиБ. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Отправляет JSON-ответ.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [extraHeaders]
 */
export function sendJson(res, status, payload, extraHeaders = {}) {
    if (res.headersSent || res.writableEnded) return;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length),
        ...corsHeaders(),
        ...extraHeaders,
    });
    res.end(body);
}

/**
 * Отправляет HTML-страницу.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
export function sendHtml(res, status, html) {
    if (res.headersSent || res.writableEnded) return;
    const body = Buffer.from(html, 'utf8');
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(body.length),
        ...corsHeaders(),
    });
    res.end(body);
}

/**
 * 405 Method Not Allowed с пояснением и заголовком Allow.
 * @param {import('node:http').ServerResponse} res
 * @param {string} allow
 * @param {string} pathname
 */
export function sendMethodNotAllowed(res, allow, pathname) {
    sendJson(
        res,
        405,
        {
            error: 'Method Not Allowed',
            message: `Метод не поддерживается для ${pathname}. Допустимо: ${allow}.`,
            allow,
        },
        { Allow: allow },
    );
}

/**
 * Читает тело запроса с ограничением размера.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<Buffer>}
 */
export function readBody(req, limit = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let overflow = false;

        req.on('data', (chunk) => {
            if (overflow) return;
            size += chunk.length;
            if (size > limit) {
                overflow = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (overflow) {
                const error = new Error(`Тело запроса больше ${limit} байт`);
                error.statusCode = 413;
                reject(error);
                return;
            }
            resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
    });
}
