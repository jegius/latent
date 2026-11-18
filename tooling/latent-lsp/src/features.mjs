// tooling/latent-lsp/src/features.mjs — обработчики запросов-возможностей и
// уведомлений о документах.
//
// Функции принимают объект сервера (`server`) и не хранят состояния сами:
// состояние (документы, флаги жизненного цикла) живёт в server.mjs. Так ядро
// остаётся компактным, а каждый обработчик тестируется через сервер.

import { documentRange, positionToOffset } from './positions.mjs';
import { provideCompletion } from './completion.mjs';
import { provideHover } from './hover.mjs';
import { provideSignatureHelp } from './signature-help.mjs';
import { provideDefinition, provideDocumentSymbols } from './symbols.mjs';
import { formatLatent } from './formatter.mjs';
import { buildDiagnostics } from './diagnostics.mjs';
import { ErrorCodes } from './jsonrpc.mjs';

/**
 * Обрабатывает запрос после initialize. Отправляет ответ через server.respond*.
 * @param {any} server
 * @param {string|number} id
 * @param {string} method
 * @param {any} params
 */
export function handleFeatureRequest(server, id, method, params) {
    switch (method) {
        case 'textDocument/completion': {
            const doc = server.documentFor(params);
            if (!doc) return server.respond(id, { isIncomplete: false, items: [] });
            const offset = positionToOffset(doc.text, params.position);
            return server.respond(id, provideCompletion({
                text: doc.text,
                offset,
                languageData: server.languageData,
            }));
        }
        case 'textDocument/hover': {
            const doc = server.documentFor(params);
            if (!doc) return server.respond(id, null);
            const offset = positionToOffset(doc.text, params.position);
            return server.respond(id, provideHover({
                text: doc.text,
                offset,
                languageData: server.languageData,
            }));
        }
        case 'textDocument/signatureHelp': {
            const doc = server.documentFor(params);
            if (!doc) return server.respond(id, null);
            const offset = positionToOffset(doc.text, params.position);
            return server.respond(id, provideSignatureHelp({
                text: doc.text,
                offset,
                languageData: server.languageData,
            }));
        }
        case 'textDocument/formatting': {
            const doc = server.documentFor(params);
            if (!doc) return server.respond(id, []);
            return server.respond(id, formatDocument(doc));
        }
        case 'textDocument/documentSymbol': {
            const doc = server.documentFor(params);
            if (!doc) return server.respond(id, []);
            return server.respond(id, provideDocumentSymbols(doc.text));
        }
        case 'textDocument/definition': {
            const doc = server.documentFor(params);
            if (!doc) return server.respond(id, null);
            const offset = positionToOffset(doc.text, params.position);
            return server.respond(id, provideDefinition({
                text: doc.text,
                offset,
                uri: doc.uri,
            }));
        }
        default:
            return server.respondError(id, ErrorCodes.MethodNotFound,
                `метод не поддерживается: ${method}`);
    }
}

/**
 * TextEdit[] для полного документа; пустой массив, если текст уже отформатирован.
 * @param {import('./documents.mjs').TextDocument} doc
 * @returns {any[]}
 */
export function formatDocument(doc) {
    const formatted = formatLatent(doc.text);
    if (formatted === doc.text) return [];
    return [{ range: documentRange(doc.text), newText: formatted }];
}

/**
 * Обрабатывает уведомление. Возвращает true, если уведомление известно.
 * @param {any} server
 * @param {string} method
 * @param {any} params
 * @returns {boolean}
 */
export function handleNotification(server, method, params) {
    switch (method) {
        case 'exit':
            server.exitRequested = true;
            server.exitCode = server.shutdownReceived ? 0 : 1;
            return true;
        case 'initialized':
            server.clientReady = true;
            return true;
        case '$/cancelRequest': {
            const id = params?.id;
            if (id !== undefined && id !== null) server.cancelled.add(id);
            return true;
        }
        case 'textDocument/didOpen':
            handleDidOpen(server, params);
            return true;
        case 'textDocument/didChange':
            handleDidChange(server, params);
            return true;
        case 'textDocument/didSave':
            handleDidSave(server, params);
            return true;
        case 'textDocument/didClose':
            handleDidClose(server, params);
            return true;
        case '$/setTrace':
        case 'window/workDoneProgress/cancel':
        case 'workspace/didChangeConfiguration':
            return true; // известные, но ненужные уведомления
        default:
            return false;
    }
}

/** @param {any} server @param {any} params */
function handleDidOpen(server, params) {
    const textDocument = params?.textDocument;
    if (!textDocument?.uri) return;
    server.documents.open(textDocument.uri, {
        languageId: textDocument.languageId || 'latent',
        version: textDocument.version ?? 0,
        text: textDocument.text ?? '',
    });
    publishDiagnostics(server, textDocument.uri);
}

/** @param {any} server @param {any} params */
function handleDidChange(server, params) {
    const uri = params?.textDocument?.uri;
    const doc = uri ? server.documents.get(uri) : undefined;
    if (!doc) return;
    doc.applyChanges(params.textDocument.version, params.contentChanges || []);
    publishDiagnostics(server, uri);
}

/** @param {any} server @param {any} params */
function handleDidSave(server, params) {
    const uri = params?.textDocument?.uri;
    const doc = uri ? server.documents.get(uri) : undefined;
    if (!doc) return;
    if (typeof params.text === 'string') doc.setText(params.text);
    publishDiagnostics(server, uri);
}

/** @param {any} server @param {any} params */
function handleDidClose(server, params) {
    const uri = params?.textDocument?.uri;
    if (!uri) return;
    server.documents.close(uri);
    server.notify('textDocument/publishDiagnostics', { uri, diagnostics: [] });
}

/**
 * Компилирует документ и отправляет publishDiagnostics.
 * Без wasm-компилятора отправляется пустой список (graceful degradation).
 * @param {any} server
 * @param {string} uri
 */
export function publishDiagnostics(server, uri) {
    if (!server.diagnosticsEnabled) return;
    const doc = server.documents.get(uri);
    if (!doc) return;
    let diagnostics = [];
    if (server.compiler) {
        try {
            diagnostics = buildDiagnostics(server.compiler, doc.text, server.languageData);
        } catch (e) {
            server.logger.error(`ошибка диагностики: ${e.stack || e.message}`);
            diagnostics = [];
        }
    }
    server.notify('textDocument/publishDiagnostics', {
        uri,
        version: doc.version,
        diagnostics,
    });
}
