// core.mjs — сборка MCP-сервера документации.
//
// Единственная ответственность: создать индекс, каталог примеров, клиент
// компилятора и диспетчер методов, а затем предоставить единую точку входа
// `handlePayload` для транспортов (stdio и HTTP). Здесь нет ни чтения stdin,
// ни HTTP-сервера — только протокольное ядро.
//
// `handlePayload` поддерживает одиночные сообщения и JSON-RPC batch
// (для stdio; HTTP-транспорт MCP 2025-06-18 batch не использует).

import { buildDocsIndex } from './docs-index.mjs';
import { createExamplesProvider } from './examples.mjs';
import { createCompiler } from './compiler.mjs';
import { createHandlers } from './handlers.mjs';
import { buildResourceList } from './resources.mjs';
import { ErrorCodes, errorResponse, failure, invalidRequest, isValidRequestShape } from './jsonrpc.mjs';
import { SERVER_NAME, SERVER_VERSION } from './version.mjs';

/**
 * Создаёт ядро MCP-сервера.
 * @param {{docsRoot: string, repoRoot: string, wasmPath: string, hooks?: object}} options
 * @returns {object} ядро сервера
 */
export function createCore({ docsRoot, repoRoot, wasmPath, hooks = {} }) {
    const index = buildDocsIndex({ docsRoot });
    const examples = createExamplesProvider({ repoRoot, docsRoot });
    const compiler = createCompiler({ wasmPath });
    const handlers = createHandlers({ index, examples, compiler, docsRoot, hooks });

    /**
     * Обрабатывает один JSON-RPC объект.
     * @param {object} message
     * @returns {Promise<object|null>}
     */
    async function handleSingle(message) {
        if (!isValidRequestShape(message)) {
            return errorResponse(
                message && typeof message === 'object' && message.id !== undefined ? message.id : null,
                invalidRequest(message),
            );
        }
        return handlers.handle(message);
    }

    /**
     * Обрабатывает полезную нагрузку: объект, batch-массив или мусор.
     * @param {unknown} payload
     * @returns {Promise<object|object[]|null>} null — отвечать не нужно (уведомления)
     */
    async function handlePayload(payload) {
        if (Array.isArray(payload)) {
            if (payload.length === 0) {
                return failure(null, ErrorCodes.InvalidRequest, 'Пустой batch-запрос JSON-RPC');
            }
            const responses = [];
            for (const item of payload) {
                const response = await handleSingle(item);
                if (response) responses.push(response);
            }
            return responses.length > 0 ? responses : null;
        }
        return handleSingle(payload);
    }

    return {
        docsRoot,
        repoRoot,
        wasmPath,
        index,
        examples,
        compiler,
        handlePayload,
        resourceCount() {
            return buildResourceList(index).resources.length;
        },
        get initialized() {
            return handlers.initialized;
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
}
