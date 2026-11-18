#!/usr/bin/env node
// Фейковый LSP-сервер для тестов расширения Latent.
//
// Реализует минимум LSP 3.17 поверх stdio: initialize/initialized,
// didOpen/didChange/didSave/didClose, completion, hover, signatureHelp,
// formatting, documentSymbol, definition, shutdown/exit.
//
// Специальные команды для проверки устойчивости клиента:
//   test/noResponse   — запрос без ответа (проверка таймаута);
//   test/garbage      — два битых пакета (без Content-Length и невалидный JSON).
// Если в тексте документа есть «ERROR», сервер публикует одну диагностику.

import process from 'node:process';

let buffer = Buffer.alloc(0);
let currentUri = 'file:///tmp/unknown.lat';
let currentText = '';

function send(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
}

function respond(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function notify(method, params) {
    send({ jsonrpc: '2.0', method, params });
}

function publish(uri, diagnostics) {
    notify('textDocument/publishDiagnostics', { uri, diagnostics });
}

function diagnosticsFor(uri, text) {
    if (text.includes('ERROR')) {
        return [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
            source: 'latent-lsp',
            message: 'Тестовая ошибка',
        }];
    }
    return [];
}

function handle(message) {
    if (message.method === 'initialize') {
        if (message.id !== undefined) {
            respond(message.id, {
                capabilities: {
                    textDocumentSync: 1,
                    completionProvider: { triggerCharacters: ['.', ':'] },
                    hoverProvider: true,
                    signatureHelpProvider: { triggerCharacters: ['(', ','] },
                    documentFormattingProvider: true,
                    documentSymbolProvider: true,
                    definitionProvider: true,
                },
                serverInfo: { name: 'fake-latent-lsp', version: '0.0.1' },
            });
        }
        return;
    }

    if (message.method === 'initialized') {
        notify('window/logMessage', { type: 3, message: 'fake-lsp initialized' });
        if (process.env.FAKE_LSP_REQUEST_CONFIG === '1') {
            // Запрос от сервера к клиенту: клиент обязан ответить (result: []).
            send({
                jsonrpc: '2.0',
                id: 9000,
                method: 'workspace/configuration',
                params: { items: [{ section: 'latent' }] },
            });
        }
        return;
    }

    if (message.id === 9000 && message.method === undefined) {
        notify('window/logMessage', { type: 3, message: 'config-received' });
        return;
    }

    switch (message.method) {
        case 'textDocument/didOpen':
            currentUri = message.params.textDocument.uri;
            currentText = message.params.textDocument.text;
            publish(currentUri, diagnosticsFor(currentUri, currentText));
            return;
        case 'textDocument/didChange': {
            const change = message.params.contentChanges[0] || {};
            currentText = change.text || '';
            if (change.range) {
                notify('window/logMessage', { type: 3, message: 'incremental-change' });
            }
            publish(currentUri, diagnosticsFor(currentUri, currentText));
            return;
        }
        case 'textDocument/didSave':
            publish(currentUri, [{
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                severity: 2,
                source: 'latent-lsp',
                message: 'Сохранено',
            }]);
            return;
        case 'textDocument/didClose':
            publish(currentUri, []);
            return;
        case 'textDocument/completion':
            respond(message.id, {
                isIncomplete: false,
                items: [
                    {
                        label: 'print',
                        kind: 3,
                        detail: 'print(value, ...)',
                        documentation: { kind: 'markdown', value: 'Печатает значение' },
                        insertText: 'print(${1:value})',
                        insertTextFormat: 2,
                    },
                    { label: 'len', kind: 3 },
                ],
            });
            return;
        case 'textDocument/hover':
            respond(message.id, {
                contents: { kind: 'markdown', value: '**print** — builtin' },
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            });
            return;
        case 'textDocument/signatureHelp':
            respond(message.id, {
                signatures: [{
                    label: 'fn f(a: int)',
                    documentation: 'doc',
                    parameters: [{ label: 'a: int' }],
                }],
                activeSignature: 0,
                activeParameter: 0,
            });
            return;
        case 'textDocument/formatting':
            respond(message.id, [{
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                newText: 'fn',
            }]);
            return;
        case 'textDocument/documentSymbol':
            respond(message.id, [{
                name: 'main',
                kind: 12,
                range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
            }]);
            return;
        case 'textDocument/definition':
            respond(message.id, {
                uri: currentUri,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
            });
            return;
        case 'test/noResponse':
            // Намеренно не отвечаем: клиент должен сработать по таймауту.
            return;
        case 'test/error':
            send({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32000, message: 'Тестовая ошибка сервера' },
            });
            return;
        case 'test/unknownResponse':
            // Ответ на неизвестный id: клиент должен молча проигнорировать.
            send({ jsonrpc: '2.0', id: 424242, result: null });
            respond(message.id, null);
            return;
        case 'test/garbage':
            process.stdout.write('X-Test: 1\r\n\r\n');
            process.stdout.write('Content-Length: 3\r\n\r\n{bad');
            respond(message.id, null);
            return;
        case 'shutdown':
            if (message.id !== undefined) respond(message.id, null);
            return;
        case 'exit':
            process.exit(0);
            return;
        default:
            if (message.id !== undefined) respond(message.id, null);
    }
}

function onData(chunk) {
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
            buffer = buffer.subarray(headerEnd + 4);
            continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) break;
        const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
        buffer = buffer.subarray(bodyStart + length);
        try {
            handle(JSON.parse(body));
        } catch (e) {
            process.stderr.write(`fake-lsp: ${e.message}\n`);
        }
    }
}

process.stdin.on('data', onData);
process.stdin.on('end', () => process.exit(0));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
