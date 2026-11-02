// tooling/latent-lsp/test/lifecycle.test.mjs — жизненный цикл LSP и публикация
// диагностик через in-process харнесс (без дочернего процесса).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInProcessServer, COMPILER_WASM } from './helpers.mjs';
import { WasmCompiler } from '../src/wasm-compiler.mjs';

const compiler = await WasmCompiler.load(COMPILER_WASM);

const VALID = 'fn main() -> int {\n    let x = 1;\n    return x;\n}\n';
const BROKEN = 'fn main() {\n    let x = ;\n}\n';
const URI = 'file:///test.lat';

/**
 * Инициализированный in-process сервер.
 * @param {{compiler?: any, diagnostics?: boolean}} [opts]
 */
function initialized(opts = {}) {
    const harness = createInProcessServer({ compiler, ...opts });
    const init = harness.request(1, 'initialize', {
        processId: process.pid,
        rootUri: 'file:///root',
        capabilities: {},
        initializationOptions: opts.diagnostics === false
            ? { latent: { diagnostics: false } } : undefined,
    });
    harness.notify('initialized', {});
    return { harness, init };
}

test('initialize отдаёт capabilities и serverInfo', () => {
    const { harness, init } = initialized();
    assert.equal(init.error, undefined);
    const { capabilities, serverInfo } = init.result;
    assert.equal(serverInfo.name, 'latent-lsp');
    assert.ok(serverInfo.version);
    assert.deepEqual(capabilities.textDocumentSync, {
        openClose: true,
        change: 2,
        save: { includeText: false },
    });
    assert.deepEqual(capabilities.completionProvider.triggerCharacters, ['.', ':']);
    assert.equal(capabilities.completionProvider.resolveProvider, false);
    assert.equal(capabilities.hoverProvider, true);
    assert.ok(capabilities.signatureHelpProvider.triggerCharacters.includes('('));
    assert.equal(capabilities.documentFormattingProvider, true);
    assert.equal(capabilities.documentSymbolProvider, true);
    assert.equal(capabilities.definitionProvider, true);
    assert.equal(harness.server.initialized, true);
});

test('запрос до initialize → ServerNotInitialized (-32002)', () => {
    const harness = createInProcessServer({ compiler });
    const response = harness.request(10, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 0, character: 0 },
    });
    assert.equal(response.error.code, -32002);
});

test('неизвестный метод → MethodNotFound (-32601)', () => {
    const { harness } = initialized();
    const response = harness.request(11, 'textDocument/thisDoesNotExist', {});
    assert.equal(response.error.code, -32601);
    assert.match(response.error.message, /thisDoesNotExist/);
});

test('shutdown → null; запрос после shutdown → InvalidRequest; exit → код 0', () => {
    const { harness } = initialized();
    const shutdown = harness.request(12, 'shutdown', null);
    assert.deepEqual(shutdown.result, null);
    assert.equal(harness.server.shutdownReceived, true);

    const after = harness.request(13, 'textDocument/completion', {
        textDocument: { uri: URI },
        position: { line: 0, character: 0 },
    });
    assert.equal(after.error.code, -32600);

    harness.notify('exit', null);
    assert.equal(harness.server.exitRequested, true);
    assert.equal(harness.server.exitCode, 0, 'exit после shutdown → код 0');
});

test('exit без shutdown → код 1', () => {
    const { harness } = initialized();
    harness.notify('exit', null);
    assert.equal(harness.server.exitRequested, true);
    assert.equal(harness.server.exitCode, 1);
});

test('$/cancelRequest отменяет запрос с тем же id', () => {
    const { harness } = initialized();
    harness.notify('$/cancelRequest', { id: 14 });
    const response = harness.request(14, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 0, character: 0 },
    });
    assert.equal(response.error.code, -32800);
});

test('мусорное сообщение → ответ InvalidRequest, сервер жив', () => {
    const { harness } = initialized();
    harness.handle({ jsonrpc: '2.0', id: 30 });
    const invalid = harness.messages.find((m) => m.id === 30);
    assert.equal(invalid.error.code, -32600);
});

test('didOpen: валидный код → пустая диагностика', () => {
    const { harness } = initialized();
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text: VALID },
    });
    const published = harness.lastDiagnostics(URI);
    assert.ok(published, 'publishDiagnostics не отправлен');
    assert.deepEqual(published.diagnostics, []);
    assert.equal(published.version, 1);
});

test('didOpen: битый код → ошибка с диапазоном строки', () => {
    const { harness } = initialized();
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text: BROKEN },
    });
    const published = harness.lastDiagnostics(URI);
    assert.equal(published.diagnostics.length, 1);
    const diagnostic = published.diagnostics[0];
    assert.equal(diagnostic.range.start.line, 1);
    assert.equal(diagnostic.severity, 1);
    assert.match(diagnostic.message, /на строке 2:/);
});

test('didChange (incremental) исправляет код и обновляет диагностику', () => {
    const { harness } = initialized();
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, version: 1, text: BROKEN },
    });
    assert.equal(harness.lastDiagnostics(URI).diagnostics.length, 1);

    // Заменяем `let x = ;` на `let x = 1;` (позиции UTF-16).
    harness.notify('textDocument/didChange', {
        textDocument: { uri: URI, version: 2 },
        contentChanges: [{
            range: {
                start: { line: 1, character: 12 },
                end: { line: 1, character: 12 },
            },
            text: '1',
        }],
    });
    const doc = harness.server.documents.get(URI);
    assert.equal(doc.text, 'fn main() {\n    let x = 1;\n}\n');
    assert.equal(doc.version, 2);
    assert.deepEqual(harness.lastDiagnostics(URI).diagnostics, []);
});

test('didChange: полная замена текста без range', () => {
    const { harness } = initialized();
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, version: 1, text: BROKEN },
    });
    harness.notify('textDocument/didChange', {
        textDocument: { uri: URI, version: 2 },
        contentChanges: [{ text: VALID }],
    });
    assert.equal(harness.server.documents.get(URI).text, VALID);
    assert.deepEqual(harness.lastDiagnostics(URI).diagnostics, []);
});

test('didSave: публикует диагностику и обновляет текст при includeText', () => {
    const { harness } = initialized();
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, version: 1, text: VALID },
    });
    const before = harness.notifications('textDocument/publishDiagnostics').length;
    harness.notify('textDocument/didSave', { textDocument: { uri: URI }, text: BROKEN });
    const after = harness.notifications('textDocument/publishDiagnostics');
    assert.equal(after.length, before + 1);
    assert.equal(after[after.length - 1].params.diagnostics.length, 1);
});

test('didClose: пустая диагностика и удаление документа', () => {
    const { harness } = initialized();
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, version: 1, text: BROKEN },
    });
    harness.notify('textDocument/didClose', { textDocument: { uri: URI } });
    assert.equal(harness.server.documents.has(URI), false);
    const published = harness.lastDiagnostics(URI);
    assert.deepEqual(published.diagnostics, []);
});

test('без wasm-компилятора: сервер работает, диагностика пустая (graceful)', () => {
    const harness = createInProcessServer({ compiler: null });
    harness.request(1, 'initialize', { capabilities: {} });
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, version: 1, text: BROKEN },
    });
    assert.deepEqual(harness.lastDiagnostics(URI).diagnostics, []);
    // completion/hover при этом доступны.
    const hover = harness.request(2, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 0, character: 4 },
    });
    assert.equal(hover.error, undefined);
    assert.ok(hover.result);
});

test('диагностика отключается через initializationOptions', () => {
    const harness = createInProcessServer({ compiler });
    harness.request(1, 'initialize', {
        capabilities: {},
        initializationOptions: { latent: { diagnostics: false } },
    });
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, version: 1, text: BROKEN },
    });
    assert.equal(harness.notifications('textDocument/publishDiagnostics').length, 0);
});
