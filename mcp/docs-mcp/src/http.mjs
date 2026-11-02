// http.mjs — Streamable HTTP транспорт MCP-сервера документации.
//
// Единственная ответственность: поднять HTTP-сервер, маршрутизировать запросы
// (/, /health, /mcp), отдавать статус и лендинг и корректно останавливаться.
// Семантика MCP-endpoint /mcp — в http-mcp.mjs, ответы/CORS/чтение тела —
// в http-util.mjs и http-cors.mjs.

import http from 'node:http';

import { SessionStore } from './sessions.mjs';
import { renderLanding } from './landing.mjs';
import { SERVER_NAME, SERVER_VERSION } from './version.mjs';
import { SUPPORTED_PROTOCOL_VERSIONS } from './handlers.mjs';
import { ErrorCodes, failure } from './jsonrpc.mjs';
import { createMcpRoutes, logRequestError } from './http-mcp.mjs';
import { corsHeaders, sendHtml, sendJson, sendMethodNotAllowed } from './http-util.mjs';

/**
 * Запускает HTTP-транспорт.
 * @param {{core: object, host?: string, port?: number, stateless?: boolean, logger?: Console}} options
 * @returns {Promise<{server: http.Server, host: string, port: number, url: string, close: () => Promise<void>, sessions: SessionStore|null, stateless: boolean}>}
 */
export async function startHttpServer(options) {
    const { core, host = '127.0.0.1', port = 8765, stateless = false, logger = console } = options;
    const sessions = stateless ? null : new SessionStore();
    const sseClients = new Set();
    const startedAt = Date.now();
    const routes = createMcpRoutes({ core, sessions, stateless, sseClients, logger });

    /** Порт, на котором реально слушает сервер (важно для --port 0). */
    const currentPort = () => {
        const address = server.address();
        return address && typeof address === 'object' ? address.port : port;
    };

    /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
    function handleHealth(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendMethodNotAllowed(res, 'GET, HEAD, OPTIONS', '/health');
            return;
        }
        const health = {
            status: 'ok',
            name: SERVER_NAME,
            version: SERVER_VERSION,
            transport: 'http',
            stateless,
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0],
            docs: {
                root: core.docsRoot,
                exists: core.index.exists,
                count: core.index.docs.length,
                sections: core.index.sections,
            },
            sessions: stateless ? 0 : sessions.size,
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
            timestamp: new Date().toISOString(),
        };
        if (req.method === 'HEAD') {
            const body = Buffer.from(JSON.stringify(health), 'utf8');
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': String(body.length),
                ...corsHeaders(),
            });
            res.end();
            return;
        }
        sendJson(res, 200, health);
    }

    /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
    function handleLanding(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendMethodNotAllowed(res, 'GET, HEAD, OPTIONS', '/');
            return;
        }
        if (req.method === 'HEAD') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
            res.end();
            return;
        }
        const html = renderLanding({
            host,
            port: currentPort(),
            docsRoot: core.docsRoot,
            docCount: core.index.docs.length,
            stateless,
            version: SERVER_VERSION,
        });
        sendHtml(res, 200, html);
    }

    /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
    async function handleRequest(req, res) {
        const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
        const pathname = url.pathname;

        if (req.method === 'OPTIONS') {
            if (res.headersSent || res.writableEnded) return;
            res.writeHead(204, { ...corsHeaders(), 'Content-Length': '0' });
            res.end();
            return;
        }

        if (pathname === '/health') {
            handleHealth(req, res);
            return;
        }
        if (pathname === '/' || pathname === '/index.html') {
            handleLanding(req, res);
            return;
        }
        if (pathname === '/favicon.ico') {
            if (res.headersSent || res.writableEnded) return;
            res.writeHead(204, { ...corsHeaders(), 'Content-Length': '0' });
            res.end();
            return;
        }
        if (pathname === '/mcp') {
            if (req.method === 'POST') {
                await routes.handlePost(req, res);
                return;
            }
            if (req.method === 'GET') {
                routes.handleSse(req, res);
                return;
            }
            if (req.method === 'DELETE') {
                await routes.handleDelete(req, res);
                return;
            }
            sendMethodNotAllowed(res, 'GET, POST, DELETE, OPTIONS', '/mcp');
            return;
        }

        sendJson(res, 404, {
            error: 'Not Found',
            message: `Маршрут ${pathname} не найден`,
            available: ['/', '/health', '/mcp'],
        });
    }

    const server = http.createServer((req, res) => {
        handleRequest(req, res).catch((error) => {
            logRequestError(logger, error);
            sendJson(res, 500, failure(null, ErrorCodes.InternalError, 'Внутренняя ошибка сервера'));
        });
    });
    server.keepAliveTimeout = 5000;

    await new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off('error', onError);
            reject(error);
        };
        server.once('error', onError);
        server.listen(port, host, () => {
            server.off('error', onError);
            resolve();
        });
    });

    const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const url = `http://${displayHost}:${currentPort()}/mcp`;

    /**
     * Останавливает сервер: закрывает SSE, сессии и все соединения.
     * @returns {Promise<void>}
     */
    async function close() {
        for (const client of sseClients) {
            try {
                client.end();
            } catch {
                // Соединение уже закрыто.
            }
        }
        sseClients.clear();
        if (sessions) sessions.clear();

        await new Promise((resolve) => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            server.close(done);
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            else if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
            setTimeout(done, 2000).unref?.();
        });
    }

    return {
        server,
        host: displayHost,
        port: currentPort(),
        url,
        sessions,
        stateless,
        close,
    };
}
