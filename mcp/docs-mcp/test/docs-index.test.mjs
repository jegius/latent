// docs-index.test.mjs — тесты индексации Markdown-документации.
//
// Проверяем: разбор front matter, сбор заголовков, группировку по разделам,
// сортировку, поиск по пути, оглавление ресурса и устойчивость к отсутствию
// каталога документации.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { buildDocsIndex, findDoc, walkMarkdown } from '../src/docs-index.mjs';
import { parseFrontMatter, extractHeadings, firstParagraph } from '../src/markdown.mjs';
import { FIXTURES_DOCS } from './helpers.mjs';

test('parseFrontMatter разбирает YAML-подобный блок и отделяет тело', () => {
    const raw = [
        '---',
        'title: "Переменные и типы"',
        'sidebar_position: 3',
        'tags: [переменные, let]',
        '---',
        '',
        '# Переменные',
        '',
        'Текст страницы.',
    ].join('\n');

    const { data, content } = parseFrontMatter(raw);
    assert.equal(data.title, 'Переменные и типы');
    assert.equal(data.sidebar_position, 3);
    assert.deepEqual(data.tags, ['переменные', 'let']);
    assert.equal(content.trim().startsWith('# Переменные'), true);
    assert.equal(content.includes('title:'), false);
});

test('parseFrontMatter без front matter возвращает весь текст', () => {
    const { data, content } = parseFrontMatter('# Заголовок\n\nТекст');
    assert.deepEqual(data, {});
    assert.equal(content, '# Заголовок\n\nТекст');
});

test('extractHeadings пропускает заголовки внутри блоков кода', () => {
    const markdown = [
        '# Верхний',
        '',
        '```latent',
        '# это комментарий, не заголовок',
        '```',
        '',
        '## Вложенный ##',
    ].join('\n');

    const headings = extractHeadings(markdown);
    assert.deepEqual(headings.map((heading) => heading.text), ['Верхний', 'Вложенный']);
    assert.deepEqual(headings.map((heading) => heading.level), [1, 2]);
});

test('firstParagraph убирает разметку и ограничивает длину', () => {
    const paragraph = firstParagraph('# Заголовок\n\nЭто **жирный** текст с `кодом` и [ссылкой](https://example.com).', 200);
    assert.equal(paragraph, 'Это жирный текст с кодом и ссылкой.');
});

test('buildDocsIndex собирает все фикстурные страницы', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    assert.equal(index.exists, true);
    assert.equal(index.error, '');
    assert.equal(index.docs.length, walkMarkdown(FIXTURES_DOCS).length);
    assert.equal(index.docs.length, 9);
});

test('buildDocsIndex разбирает front matter и группы разделов', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const variables = index.find('guide/variables.md');

    assert.ok(variables);
    assert.equal(variables.title, 'Переменные и типы');
    assert.match(variables.description, /аннотации типов/);
    assert.deepEqual(variables.tags, ['переменные', 'типы', 'let']);
    assert.equal(variables.section, 'guide');
    assert.equal(variables.sidebarPosition, 1);

    const sections = index.sections.map((section) => section.name);
    assert.ok(sections.includes('root'));
    assert.ok(sections.includes('guide'));
    assert.ok(sections.includes('reference'));
    assert.ok(sections.includes('getting-started'));
    assert.ok(sections.includes('examples'));
    // 'root' всегда первым, известные разделы — в порядке сайта.
    assert.equal(sections[0], 'root');
    assert.ok(sections.indexOf('guide') < sections.indexOf('reference'));
});

test('без front matter заголовок и описание берутся из текста', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const install = index.find('getting-started/install.md');

    assert.ok(install);
    assert.equal(install.title, 'Установка');
    assert.match(install.description, /front matter/);
    assert.equal(install.section, 'getting-started');
});

test('сортировка внутри раздела учитывает sidebar_position', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const guide = index.docs.filter((doc) => doc.section === 'guide').map((doc) => doc.path);
    assert.deepEqual(guide, ['guide/variables.md', 'guide/functions.md']);
});

test('findDoc нормализует путь, слэши и регистр', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    assert.equal(findDoc(index, 'guide/variables.md').path, 'guide/variables.md');
    assert.equal(findDoc(index, './guide/variables.md').path, 'guide/variables.md');
    assert.equal(findDoc(index, 'guide\\variables.md').path, 'guide/variables.md');
    assert.equal(findDoc(index, 'GUIDE/VARIABLES.MD').path, 'guide/variables.md');
    assert.equal(findDoc(index, 'guide/variables').path, 'guide/variables.md');
    assert.equal(findDoc(index, 'latent-docs://guide/variables.md').path, 'guide/variables.md');
    assert.equal(findDoc(index, 'guide/unknown.md'), undefined);
});

test('findDoc не выпускает за пределы каталога документации', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    assert.equal(findDoc(index, '../package.json'), undefined);
    assert.equal(findDoc(index, 'guide/../../package.json'), undefined);
    assert.equal(findDoc(index, ''), undefined);
});

test('renderIndex содержит ссылки на все страницы и разделы', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    const markdown = index.renderIndex();

    assert.match(markdown, /# Индекс документации Latent/);
    assert.match(markdown, /Всего документов: 9/);
    for (const doc of index.docs) {
        assert.ok(markdown.includes(`latent-docs://${doc.path}`), `нет ссылки на ${doc.path}`);
    }
    assert.match(markdown, /## Guide/);
});

test('отсутствующий каталог документации не роняет индекс', () => {
    const missing = path.join(os.tmpdir(), 'latent-docs-mcp-no-such-dir-xyz');
    const index = buildDocsIndex({ docsRoot: missing });

    assert.equal(index.exists, false);
    assert.equal(index.docs.length, 0);
    assert.match(index.error, /не найден/);
    assert.match(index.renderIndex(), /Документация недоступна/);
});

test('пустой каталог даёт пустой, но рабочий индекс', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-docs-empty-'));
    try {
        const index = buildDocsIndex({ docsRoot: emptyDir });
        assert.equal(index.exists, true);
        assert.equal(index.docs.length, 0);
        assert.match(index.renderIndex(), /пока пуста/);
    } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
    }
});
