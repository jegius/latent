// tooling/latent-lsp/test/jsonrpc.test.mjs — кадрирование JSON-RPC 2.0 (LSP
// Content-Length) и коды ошибок.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ErrorCodes,
    errorResponse,
    FrameReader,
    parseContentLength,
    response,
    serializeMessage,
} from '../src/jsonrpc.mjs';

test('serializeMessage: заголовок Content-Length и UTF-8 тело', () => {
    const frame = serializeMessage({ jsonrpc: '2.0', id: 1, method: 'test' });
    const headerEnd = frame.indexOf('\r\n\r\n');
    assert.ok(headerEnd > 0);
    const header = frame.subarray(0, headerEnd).toString('ascii');
    const body = frame.subarray(headerEnd + 4);
    assert.match(header, /^Content-Length: \d+$/);
    assert.equal(Number.parseInt(header.split(': ')[1], 10), body.length);
    assert.deepEqual(JSON.parse(body.toString('utf8')),
        { jsonrpc: '2.0', id: 1, method: 'test' });
});

test('кириллица в теле измеряется в байтах UTF-8', () => {
    const frame = serializeMessage({ jsonrpc: '2.0', method: 'x', params: { text: 'привет' } });
    const headerEnd = frame.indexOf('\r\n\r\n');
    const declared = Number.parseInt(
        frame.subarray(0, headerEnd).toString('ascii').split(': ')[1], 10);
    assert.equal(declared, frame.length - headerEnd - 4);
    assert.ok(declared > 'привет'.length, 'байт больше, чем UTF-16 code units');
});

test('FrameReader: два кадра в одном chunk', () => {
    const reader = new FrameReader();
    const one = serializeMessage({ jsonrpc: '2.0', id: 1, method: 'a' });
    const two = serializeMessage({ jsonrpc: '2.0', id: 2, method: 'b' });
    reader.push(Buffer.concat([one, two]));
    assert.deepEqual(reader.next().message.id, 1);
    assert.deepEqual(reader.next().message.id, 2);
    assert.equal(reader.next(), null);
});

test('FrameReader: кадр, приходящий по частям', () => {
    const reader = new FrameReader();
    const frame = serializeMessage({ jsonrpc: '2.0', id: 7, result: null });
    const half = Math.floor(frame.length / 2);
    reader.push(frame.subarray(0, half));
    assert.equal(reader.next(), null, 'неполный кадр не читается');
    reader.push(frame.subarray(half));
    assert.deepEqual(reader.next().message, { jsonrpc: '2.0', id: 7, result: null });
});

test('FrameReader: битый JSON → parseError, буфер продолжает работу', () => {
    const reader = new FrameReader();
    const bad = Buffer.from('Content-Length: 3\r\n\r\n{[]', 'ascii');
    reader.push(bad);
    const entry = reader.next();
    assert.ok(entry.parseError);
    // Следующий валидный кадр всё ещё читается.
    reader.push(serializeMessage({ jsonrpc: '2.0', id: 1, method: 'ok' }));
    assert.equal(reader.next().message.method, 'ok');
});

test('FrameReader: отсутствующий Content-Length → frameError', () => {
    const reader = new FrameReader();
    reader.push(Buffer.from('X-Test: 1\r\n\r\n{}', 'ascii'));
    const entry = reader.next();
    assert.ok(entry.frameError);
    assert.match(entry.frameError.message, /Content-Length/);
});

test('parseContentLength: регистронезависимый заголовок', () => {
    assert.equal(parseContentLength('content-length: 42'), 42);
    assert.equal(parseContentLength('Content-Type: x\r\nContent-Length: 7'), 7);
    assert.throws(() => parseContentLength('Content-Length: abc'), /Content-Length/);
});

test('response/errorResponse: структура JSON-RPC', () => {
    assert.deepEqual(response(1, { ok: true }), { jsonrpc: '2.0', id: 1, result: { ok: true } });
    const error = errorResponse(2, ErrorCodes.MethodNotFound, 'unknown');
    assert.equal(error.jsonrpc, '2.0');
    assert.equal(error.id, 2);
    assert.equal(error.error.code, -32601);
    assert.equal(error.error.message, 'unknown');
    assert.equal(errorResponse(null, ErrorCodes.ParseError, 'x').id, null);
});
