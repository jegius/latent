// http-cors.mjs — CORS-политика HTTP-транспорта.
//
// Единственная ответственность: набор заголовков, разрешающих браузерным
// MCP-клиентам (и web IDE) обращаться к локальному серверу. Вынесено отдельно,
// чтобы CORS-политику было легко найти и изменить.

/**
 * Заголовки CORS для всех ответов.
 * @returns {Record<string, string>}
 */
export function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Access-Control-Max-Age': '86400',
    };
}
