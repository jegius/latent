// tooling/latent-lsp/src/capabilities.mjs — статическое описание возможностей
// сервера (ответ на initialize). Вынесено отдельно, чтобы server.mjs оставался
// про диспетчеризацию, а не про константы протокола.

import { SERVER_VERSION } from './cli.mjs';

/** Имя сервера в ответе initialize. */
export const SERVER_NAME = 'latent-lsp';

/** Версия сервера. */
export const LSP_SERVER_VERSION = SERVER_VERSION;

/**
 * Возможности сервера (LSP 3.17).
 * textDocumentSync.change = 2 → Incremental: клиент присылает range-правки,
 * которые сервер применяет в documents.applyContentChanges.
 */
export const SERVER_CAPABILITIES = {
    textDocumentSync: {
        openClose: true,
        change: 2,
        save: { includeText: false },
    },
    completionProvider: {
        triggerCharacters: ['.', ':'],
        resolveProvider: false,
    },
    hoverProvider: true,
    signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [','],
    },
    documentFormattingProvider: true,
    documentSymbolProvider: true,
    definitionProvider: true,
};
