// tooling/latent-lsp/test/features.test.mjs — возможности сервера через
// in-process харнесс: completion, hover, signatureHelp, formatting,
// documentSymbol, definition и устойчивость к неоткрытым документам.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInProcessServer, COMPILER_WASM, languageData } from './helpers.mjs';
import { WasmCompiler } from '../src/wasm-compiler.mjs';
import { formatLatent } from '../src/formatter.mjs';

const compiler = await WasmCompiler.load(COMPILER_WASM);
const URI = 'file:///features.lat';

/**
 * Инициализированный in-process сервер.
 * @returns {{harness: any, init: any}}
 */
function initialized() {
    const harness = createInProcessServer({ compiler });
    const init = harness.request(1, 'initialize', {
        processId: process.pid,
        rootUri: 'file:///root',
        capabilities: {},
    });
    harness.notify('initialized', {});
    return { harness, init };
}

/**
 * @param {any} harness
 * @param {string} text
 */
function open(harness, text) {
    harness.notify('textDocument/didOpen', {
        textDocument: { uri: URI, languageId: 'latent', version: 1, text },
    });
}

test('completion через сервер', () => {
    const { harness } = initialized();
    open(harness, 'fn main() {\n    pri\n}\n');
    const response = harness.request(20, 'textDocument/completion', {
        textDocument: { uri: URI },
        position: { line: 1, character: 7 },
    });
    const labels = response.result.items.map((i) => i.label);
    assert.ok(labels.includes('print'));
    assert.equal(response.result.isIncomplete, false);
});

test('hover через сервер', () => {
    const { harness } = initialized();
    open(harness, 'fn main() -> int {\n    let x = 1;\n    return x;\n}\n');
    const response = harness.request(21, 'textDocument/hover', {
        textDocument: { uri: URI },
        position: { line: 1, character: 5 },
    });
    assert.match(response.result.contents.value, /\*\*let\*\*/);
});

test('signatureHelp через сервер', () => {
    const { harness } = initialized();
    open(harness, 'fn main() {\n    print("a", \n}\n');
    const response = harness.request(22, 'textDocument/signatureHelp', {
        textDocument: { uri: URI },
        position: { line: 1, character: 16 },
    });
    assert.equal(response.result.activeParameter, 1);
    assert.equal(response.result.signatures[0].label, 'print(value, ...)');
});

test('formatting через сервер: правка, затем [] на уже отформатированном', () => {
    const { harness } = initialized();
    const messy = 'fn main() {\nlet x=1;\nreturn x;\n}\n';
    open(harness, messy);
    const response = harness.request(23, 'textDocument/formatting', {
        textDocument: { uri: URI },
        options: { tabSize: 4, insertSpaces: true },
    });
    assert.equal(response.result.length, 1);
    const edit = response.result[0];
    assert.deepEqual(edit.range.start, { line: 0, character: 0 });
    assert.equal(edit.newText, formatLatent(messy));
    assert.match(edit.newText, /    let x = 1;/);

    harness.notify('textDocument/didChange', {
        textDocument: { uri: URI, version: 2 },
        contentChanges: [{ text: edit.newText }],
    });
    const second = harness.request(24, 'textDocument/formatting', {
        textDocument: { uri: URI },
        options: { tabSize: 4, insertSpaces: true },
    });
    assert.deepEqual(second.result, []);
});

test('documentSymbol и definition через сервер', () => {
    const { harness } = initialized();
    const text = 'fn add(a: int) -> int {\n    return a;\n}\nfn main() -> int {\n    return add(1);\n}\n';
    open(harness, text);
    const symbols = harness.request(25, 'textDocument/documentSymbol', {
        textDocument: { uri: URI },
    });
    assert.deepEqual(symbols.result.map((s) => s.name), ['add', 'main']);
    assert.equal(symbols.result[0].kind, 12);

    const definition = harness.request(26, 'textDocument/definition', {
        textDocument: { uri: URI },
        position: { line: 4, character: 12 },
    });
    assert.equal(definition.result.uri, URI);
    assert.deepEqual(definition.result.range.start, { line: 0, character: 3 });
});

test('запросы к неоткрытому документу не роняют сервер', () => {
    const { harness } = initialized();
    const completion = harness.request(27, 'textDocument/completion', {
        textDocument: { uri: 'file:///nope.lat' },
        position: { line: 0, character: 0 },
    });
    assert.deepEqual(completion.result, { isIncomplete: false, items: [] });
    const hover = harness.request(28, 'textDocument/hover', {
        textDocument: { uri: 'file:///nope.lat' },
        position: { line: 0, character: 0 },
    });
    assert.equal(hover.result, null);
    const formatting = harness.request(29, 'textDocument/formatting', {
        textDocument: { uri: 'file:///nope.lat' },
        options: { tabSize: 4, insertSpaces: true },
    });
    assert.deepEqual(formatting.result, []);
});

test('данные о языке из languageData доступны серверу', () => {
    const data = languageData();
    assert.equal(data.keywordList.length, 37);
    assert.ok(data.hostOnly.has('tensor'));
});
