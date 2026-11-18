// reference-resources.test.mjs — справочник reference/* и MCP-ресурсы.
//
// Проверяем матчинг тем (точный префикс, синонимы, вхождение в метаданные),
// отчёт о недостающем разделе и чтение ресурсов latent-docs:// (включая
// защитные ветви: не-строка, чужой URI, пустой путь).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDocsIndex } from '../src/docs-index.mjs';
import {
    findReferenceDocs,
    missingReferenceReport,
    renderReference,
} from '../src/reference.mjs';
import {
    INDEX_URI,
    URI_PREFIX,
    buildResourceList,
    buildResourceTemplates,
    docUri,
    readResource,
} from '../src/resources.mjs';
import { FIXTURES_DOCS } from './helpers.mjs';

/**
 * Создаёт временный каталог документации.
 * @param {Record<string, string>} tree
 * @returns {string}
 */
function makeDocs(tree) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-ref-'));
    for (const [relative, content] of Object.entries(tree)) {
        const absolute = path.join(root, ...relative.split('/'));
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content, 'utf8');
    }
    return root;
}

test('findReferenceDocs(topic=all) возвращает все страницы reference/', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const docs = findReferenceDocs(index, 'all');
    assert.deepEqual(
        docs.map((doc) => doc.path),
        ['reference/builtins.md', 'reference/types.md', 'reference/errors.md', 'reference/wasm-abi.md'],
    );
});

test('findReferenceDocs находит тему по точному префиксу пути', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const docs = findReferenceDocs(index, 'builtins');
    assert.equal(docs.length, 1);
    assert.equal(docs[0].path, 'reference/builtins.md');
});

test('findReferenceDocs использует синонимы темы (abi → wasm-abi)', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const docs = findReferenceDocs(index, 'abi');
    assert.deepEqual(docs.map((doc) => doc.path), ['reference/wasm-abi.md']);
});

test('findReferenceDocs: третий проход ищет синоним в заголовке/описании/тегах', () => {
    const root = makeDocs({
        'reference/lexical.md': [
            '---',
            'title: Лексика и операторы',
            'description: Операторы языка',
            'tags: [операторы]',
            '---',
            '',
            '# Лексика',
        ].join('\n'),
    });
    try {
        const index = buildDocsIndex({ docsRoot: root });
        const docs = findReferenceDocs(index, 'operators');
        assert.deepEqual(docs.map((doc) => doc.path), ['reference/lexical.md']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('findReferenceDocs с неизвестной темой не падает и отдаёт пустой список', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    assert.deepEqual(findReferenceDocs(index, 'unknown-topic'), []);
    assert.deepEqual(findReferenceDocs(index, 'all'), index.docs.filter((doc) => doc.path.startsWith('reference/')));
});

test('missingReferenceReport перечисляет доступные страницы reference/', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const report = missingReferenceReport(index, 'grammar');
    assert.match(report, /Раздел «grammar» пока не найден/);
    assert.match(report, /Доступные страницы справочника/);
    assert.match(report, /reference\/builtins\.md/);
});

test('missingReferenceReport: пустой раздел reference и отсутствующий каталог', () => {
    const empty = makeDocs({ 'guide/one.md': '# Один' });
    const missing = path.join(os.tmpdir(), 'latent-ref-no-such-dir-xyz');
    try {
        const emptyIndex = buildDocsIndex({ docsRoot: empty });
        assert.match(missingReferenceReport(emptyIndex, 'types'), /Раздел reference\/ пока пуст/);

        const missingIndex = buildDocsIndex({ docsRoot: missing });
        const report = missingReferenceReport(missingIndex, 'types');
        assert.match(report, /Каталог документации недоступен/);
        assert.doesNotMatch(report, /Доступные страницы/);
    } finally {
        fs.rmSync(empty, { recursive: true, force: true });
    }
});

test('renderReference склеивает страницы с комментариями-путями и шапкой', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const docs = findReferenceDocs(index, 'all');
    const markdown = renderReference('all', docs, index);
    assert.match(markdown, /# Справочник по языку Latent/);
    assert.match(markdown, /Тема: `all`\. Страниц: 4/);
    for (const doc of docs) {
        assert.ok(markdown.includes(`<!-- ${doc.path} -->`), `нет комментария для ${doc.path}`);
    }
    assert.match(markdown, /\n---\n/);
});

test('buildResourceList: описание документа с пустым description запасное', () => {
    const root = makeDocs({
        'guide/silent.md': '---\ntitle: Тихая страница\n---\n',
    });
    try {
        const index = buildDocsIndex({ docsRoot: root });
        const { resources } = buildResourceList(index);
        assert.equal(resources.length, 2);
        assert.equal(resources[1].uri, 'latent-docs://guide/silent.md');
        assert.equal(resources[1].name, 'guide/silent.md');
        assert.equal(resources[1].description, 'Документация Latent: Тихая страница');
        assert.equal(resources[1].mimeType, 'text/markdown');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildResourceTemplates отдаёт два шаблона с MIME text/markdown', () => {
    const { resourceTemplates } = buildResourceTemplates();
    assert.equal(resourceTemplates.length, 2);
    assert.deepEqual(resourceTemplates.map((template) => template.uriTemplate), [
        'latent-docs://{path}',
        'latent-docs://reference/{topic}.md',
    ]);
    for (const template of resourceTemplates) {
        assert.equal(template.mimeType, 'text/markdown');
        assert.ok(template.description.length > 10);
    }
});

test('docUri и INDEX_URI используют единый префикс', () => {
    assert.equal(INDEX_URI, 'latent-docs://index');
    assert.equal(URI_PREFIX, 'latent-docs://');
    assert.equal(docUri('guide/functions.md'), 'latent-docs://guide/functions.md');
});

test('readResource: index и index.md отдают оглавление', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    for (const uri of ['latent-docs://index', 'latent-docs://index.md', '  latent-docs://index  ']) {
        const resource = readResource(index, uri);
        assert.ok(resource, `ресурс не прочитан: ${uri}`);
        assert.equal(resource.contents.length, 1);
        assert.equal(resource.contents[0].uri, INDEX_URI);
        assert.match(resource.contents[0].text, /# Индекс документации Latent/);
    }
});

test('readResource читает страницу без front matter и нормализует URI', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const resource = readResource(index, 'latent-docs://GUIDE/Variables.MD');
    assert.equal(resource.contents[0].uri, 'latent-docs://guide/variables.md');
    assert.match(resource.contents[0].text, /# Переменные/);
    assert.doesNotMatch(resource.contents[0].text, /^---/);
});

test('readResource возвращает null для чужих, пустых и нестроковых URI', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    assert.equal(readResource(index, null), null);
    assert.equal(readResource(index, 42), null);
    assert.equal(readResource(index, {}), null);
    assert.equal(readResource(index, 'https://example.com/doc.md'), null);
    assert.equal(readResource(index, 'latent-docs://'), null);
    assert.equal(readResource(index, 'latent-docs://   '), null);
    assert.equal(readResource(index, 'latent-docs://guide/nope.md'), null);
    assert.equal(readResource(index, 'latent-docs://../package.json'), null);
});

test('readResource: индекс отсутствующего каталога всё равно читается', () => {
    const index = buildDocsIndex({ docsRoot: path.join(os.tmpdir(), 'latent-ref-missing-xyz') });
    const resource = readResource(index, 'latent-docs://index');
    assert.match(resource.contents[0].text, /Документация недоступна/);
});
