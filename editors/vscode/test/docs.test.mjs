import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const docs = require('../src/docs.js');

function fakeVscode() {
    const opened = [];
    return {
        opened,
        api: {
            Uri: {
                parse: (value) => ({ scheme: 'https', toString: () => value, value }),
            },
            env: {
                openExternal: async (uri) => {
                    opened.push(uri.value);
                    return true;
                },
            },
        },
    };
}

test('docs: URL документации и playground', () => {
    assert.equal(docs.DOCS_URL, 'https://jegius.github.io/latent/');
    assert.equal(docs.PLAYGROUND_URL, 'https://jegius.github.io/latent/playground/');
});

test('docs: openDocs открывает документацию через env.openExternal', async () => {
    const { api, opened } = fakeVscode();
    assert.equal(await docs.openDocs(api), true);
    assert.deepEqual(opened, [docs.DOCS_URL]);
});

test('docs: openPlayground открывает playground', async () => {
    const { api, opened } = fakeVscode();
    assert.equal(await docs.openPlayground(api), true);
    assert.deepEqual(opened, [docs.PLAYGROUND_URL]);
});

test('docs: openUrl проверяет наличие API', async () => {
    await assert.rejects(docs.openUrl(undefined, docs.DOCS_URL), /Недоступен API/u);
    await assert.rejects(docs.openUrl({}, docs.DOCS_URL), /Недоступен API/u);
    await assert.rejects(docs.openUrl({ env: {}, Uri: {} }, docs.DOCS_URL), /Недоступен API/u);
    const { api, opened } = fakeVscode();
    assert.equal(await docs.openUrl(api, 'https://example.com/'), true);
    assert.deepEqual(opened, ['https://example.com/']);
});
