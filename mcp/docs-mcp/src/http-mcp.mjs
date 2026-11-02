// http-mcp.mjs — обработчики endpoint /mcp.
//
// Единственная ответственность: семантика Streamable HTTP для MCP — POST
// JSON-RPC с сессиями (Mcp-Session-Id), GET SSE-поток и DELETE сессии.
// Маршрутизация уровня сервера и /health лежат в http.mjs.

import { ErrorCodes, failure, isNotification } from './jsonrpc.mjs';
import { SUPPORTED_PROTOCOL_VERSIONS } from './handlers.mjs';
import { SERVER_NAME, SERVER_VERSION } from './version.mjs';
import { corsHeaders, readBody, sendJson } from './http-util.mjs';

/** Методы, разрешённые до initialize (плюс само initialize). */
const PRE_INIT_ALLOWED = new Set(['initialize', 'ping', 'shutdown']);

/**
 * Создаёт обработчики /mcp для одного HTTP-сервера.
 * @param {{core: object, sessions: import('./sessions.mjs').SessionStore|null, stateless: boolean, sseClients: Set, logger: Console}} context
 * @returns {{handlePost: Function, handleSse: Function, handleDelete: Function}}
 */
export function createMcpRoutes({ core, sessions, stateless, sseClients, logger }) {
    /**
     * POST /mcp — JSON-RPC запрос/уведомление/batch.
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     */
    async function handlePost(req, res) {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('application/json')) {
            sendJson(res, 415, {
                error: 'Unsupported Media Type',
                message: 'Content-Type должен быть application/json',
            });
            return;
        }

        const protocolHeader = req.headers['mcp-protocol-version'];
        if (typeof protocolHeader === 'string' && protocolHeader && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolHeader)) {
            sendJson(res, 400, {
                error: 'Unsupported protocol version',
                message: `Версия ${protocolHeader} не поддерживается`,
                supported: SUPPORTED_PROTOCOL_VERSIONS,
            });
            return;
        }

        let body;
        try {
            body = await readBody(req);
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: 'Bad Request', message: error.message });
            return;
        }

        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch {
            sendJson(res, 400, failure(null, ErrorCodes.ParseError, 'Не удалось разобрать JSON-тело запроса'));
            return;
        }

        const messages = Array.isArray(payload) ? payload : [payload];
        const requests = messages.filter((message) => message && typeof message.method === 'string' && !isNotification(message));
        const hasInitialize = messages.some((message) => message && message.method === 'initialize');
        const nonInitRequests = requests.filter((message) => !PRE_INIT_ALLOWED.has(message.method));

        let session = null;
        if (!stateless) {
            const headerSessionId = req.headers['mcp-session-id'];
            if (typeof headerSessionId === 'string' && headerSessionId) {
                session = sessions.get(headerSessionId);
                if (!session) {
                    sendJson(
                        res,
                        404,
                        failure(
                            nonInitRequests.length > 0 ? nonInitRequests[0].id : null,
                            ErrorCodes.SessionNotFound,
                            'Сессия не найдена или истекла',
                            { sessionId: headerSessionId },
                        ),
                    );
                    return;
                }
            }
            if (!session && nonInitRequests.length > 0) {
                const first = nonInitRequests[0];
                sendJson(
                    res,
                    400,
                    failure(
                        first.id === undefined ? null : first.id,
                        ErrorCodes.ServerNotInitialized,
                        'Сервер не инициализирован: сначала отправьте запрос initialize',
                        { hint: 'Либо запустите сервер с флагом --stateless, чтобы initialize не требовался.' },
                    ),
                );
                return;
            }
        }

        const responsePayload = await core.handlePayload(payload);

        const extraHeaders = {};
        if (!stateless && hasInitialize && !session && responsePayload) {
            const responses = Array.isArray(responsePayload) ? responsePayload : [responsePayload];
            const initialized = responses.some((response) => response && response.result && response.result.protocolVersion);
            if (initialized) {
                const initMessage = messages.find((message) => message && message.method === 'initialize');
                const created = sessions.create({
                    clientInfo: initMessage && initMessage.params ? initMessage.params.clientInfo : {},
                    protocolVersion: initMessage && initMessage.params ? initMessage.params.protocolVersion : '',
                });
                extraHeaders['Mcp-Session-Id'] = created.id;
            }
        }

        if (responsePayload === null || (Array.isArray(responsePayload) && responsePayload.length === 0)) {
            if (res.headersSent || res.writableEnded) return;
            res.writeHead(202, { ...corsHeaders(), ...extraHeaders });
            res.end();
            return;
        }

        sendJson(res, 200, responsePayload, extraHeaders);
    }

    /**
     * GET /mcp — SSE-поток с heartbeat.
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     */
    function handleSse(req, res) {
        const accept = String(req.headers.accept || '');
        if (accept && !accept.includes('text/event-stream') && !accept.includes('*/*')) {
            sendJson(res, 406, {
                error: 'Not Acceptable',
                message: 'Для GET /mcp требуется заголовок Accept: text/event-stream',
            });
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...corsHeaders(),
        });
        res.write(`: подключено к ${SERVER_NAME} MCP (${SERVER_VERSION})\n\n`);

        const heartbeat = setInterval(() => {
            try {
                res.write(': keep-alive\n\n');
            } catch {
                // Соединение уже закрыто — уборка ниже.
            }
        }, 15000);
        heartbeat.unref?.();

        sseClients.add(res);
        const cleanup = () => {
            clearInterval(heartbeat);
            sseClients.delete(res);
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
    }

    /**
     * DELETE /mcp — завершение сессии.
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     */
    async function handleDelete(req, res) {
        if (stateless) {
            sendJson(res, 200, { ok: true, stateless: true });
            return;
        }
        const sessionId = req.headers['mcp-session-id'];
        if (typeof sessionId !== 'string' || !sessionId) {
            sendJson(res, 400, { error: 'Bad Request', message: 'Не указан заголовок Mcp-Session-Id' });
            return;
        }
        if (!sessions.delete(sessionId)) {
            sendJson(res, 404, failure(null, ErrorCodes.SessionNotFound, 'Сессия не найдена', { sessionId }));
            return;
        }
        sendJson(res, 200, { ok: true });
    }

    return { handlePost, handleSse, handleDelete };
}

/**
 * Логирует ошибку обработки запроса, не раскрывая клиенту внутренних деталей.
 * @param {Console} logger
 * @param {unknown} error
 */
export function logRequestError(logger, error) {
    logger.error?.('[docs-mcp] ошибка обработки HTTP-запроса:', error);
}
