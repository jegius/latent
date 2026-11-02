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

/**
 * Создаёт временный каталог документации из дерева «путь: содержимое».
 * @param {Record<string, string>} tree
 * @returns {string}
 */
function makeDocs(tree) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-docs-index-'));
    for (const [relative, content] of Object.entries(tree)) {
        const absolute = path.join(root, ...relative.split('/'));
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content, 'utf8');
    }
    return root;
}

test('walkMarkdown пропускает скрытые каталоги, node_modules и не-Markdown файлы', () => {
    const root = makeDocs({
        'index.md': '# Корень',
        'guide/one.md': '# Один',
        'guide/two.mdx': '# Два',
        '.hidden/secret.md': '# Секрет',
        'node_modules/pkg/readme.md': '# Пакет',
        'guide/notes.txt': 'не markdown',
        'guide/image.png': 'binary',
    });
    try {
        assert.deepEqual(walkMarkdown(root), ['guide/one.md', 'guide/two.mdx', 'index.md']);
        const index = buildDocsIndex({ docsRoot: root });
        assert.equal(index.docs.length, 3);
        assert.equal(index.find('index.md').title, 'Корень');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('walkMarkdown на файле (не каталоге) возвращает пустой список', () => {
    const root = makeDocs({ 'guide/one.md': '# Один' });
    try {
        assert.deepEqual(walkMarkdown(path.join(root, 'guide', 'one.md')), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('walkMarkdown пропускает нерегулярные файлы (симлинки/устройства)', () => {
    const root = makeDocs({ 'real.md': '# Настоящий' });
    const original = fs.readdirSync;
    fs.readdirSync = function patched(dir, options) {
        if (dir === root) {
            return [
                { name: 'link.md', isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
                { name: 'real.md', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
            ];
        }
        return original.call(this, dir, options);
    };
    try {
        assert.deepEqual(walkMarkdown(root), ['real.md']);
    } finally {
        fs.readdirSync = original;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildDocsIndex: каталог-файл и путь с недопустимым символом дают exists=false', () => {
    const root = makeDocs({ 'guide/one.md': '# Один' });
    try {
        const asFile = buildDocsIndex({ docsRoot: path.join(root, 'guide', 'one.md') });
        assert.equal(asFile.exists, false);
        assert.match(asFile.error, /не найден/);

        const invalid = buildDocsIndex({ docsRoot: path.join(root, 'bad\u0000name') });
        assert.equal(invalid.exists, false);
        assert.equal(invalid.docs.length, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildDocsIndex: исчезнувший между обходом и чтением файл не роняет индекс', () => {
    const root = makeDocs({ 'guide/ghost.md': '# Призрак', 'guide/real.md': '# Реальный' });
    const original = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
        if (String(file).endsWith('ghost.md')) throw new Error('ENOENT');
        return original.call(this, file, ...rest);
    };
    try {
        const index = buildDocsIndex({ docsRoot: root });
        const ghost = index.find('guide/ghost.md');
        assert.ok(ghost, 'файл должен остаться в индексе');
        assert.equal(ghost.content, '');
        assert.equal(ghost.title, 'Ghost');
        assert.equal(ghost.description, '');
        assert.equal(index.find('guide/real.md').title, 'Реальный');
    } finally {
        fs.readFileSync = original;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildDocsIndex: заголовок из H2, sidebar_label и строковые теги/ключевые слова', () => {
    const root = makeDocs({
        'guide/h2-only.md': '## Только второй уровень\n\nТекст.',
        'guide/fallback-label.md': [
            '---',
            'title: 42',
            'sidebar_label: "Метка сбоку"',
            'tags: alpha, beta; gamma',
            'keywords: [delta]',
            'sidebar_position: "3"',
            '---',
            '',
            'Тело.',
        ].join('\n'),
        'guide/bad-position.md': '---\ntitle: Без позиции\nsidebar_position: abc\n---\n\nТело.',
    });
    try {
        const index = buildDocsIndex({ docsRoot: root });
        assert.equal(index.find('guide/h2-only.md').title, 'Только второй уровень');

        const fallback = index.find('guide/fallback-label.md');
        assert.equal(fallback.title, 'Метка сбоку');
        assert.deepEqual(fallback.tags, ['alpha', 'beta', 'gamma', 'delta']);
        assert.equal(fallback.sidebarPosition, 3);
        assert.equal(fallback.sidebarLabel, 'Метка сбоку');

        assert.equal(index.find('guide/bad-position.md').sidebarPosition, Number.MAX_SAFE_INTEGER);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildDocsIndex: незнакомые разделы сортируются после известных и по алфавиту', () => {
    const root = makeDocs({
        'guide/one.md': '# Гид',
        'zeta/a.md': '# Зета',
        'alpha/a.md': '# Альфа',
        'alpha/b.md': '# Альфа Б',
        'custom/c.md': '# Кастом',
    });
    try {
        const index = buildDocsIndex({ docsRoot: root });
        const unknownSections = index.sections.map((section) => section.name).filter((name) => !['root', 'guide'].includes(name));
        assert.deepEqual(unknownSections, ['alpha', 'custom', 'zeta']);
        const alphaPaths = index.docs.filter((doc) => doc.section === 'alpha').map((doc) => doc.path);
        assert.deepEqual(alphaPaths, ['alpha/a.md', 'alpha/b.md']);
        assert.equal(index.sections.find((section) => section.name === 'custom').title, 'Custom');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildDocsIndex: сортировка по sidebar_position внутри раздела', () => {
    const root = makeDocs({
        'guide/late.md': '---\ntitle: Поздняя\nsidebar_position: 10\n---\n',
        'guide/early.md': '---\ntitle: Ранняя\nsidebar_position: 2\n---\n',
        'guide/no-pos.md': '---\ntitle: Без позиции\n---\n',
    });
    try {
        const paths = buildDocsIndex({ docsRoot: root }).docs.map((doc) => doc.path);
        assert.deepEqual(paths, ['guide/early.md', 'guide/late.md', 'guide/no-pos.md']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('findDoc: некорректный процент-энкодинг и путь без расширения не падают', () => {
    const index = buildDocsIndex({ docsRoot: FIXTURES_DOCS });
    assert.equal(findDoc(index, '%zz/unknown.md'), undefined);
    assert.equal(findDoc(index, 'guide/unknown'), undefined);
    assert.equal(findDoc(index, 'guide/variables.md/'), undefined);
    assert.equal(findDoc(index, 'latent-docs://'), undefined);
    assert.equal(findDoc(index, 'guide//variables.md').path, 'guide/variables.md');
    assert.equal(findDoc(index, 42), undefined);
});

test('findDoc: декодирование %20 и защита от выхода из каталога', () => {
    const root = makeDocs({
        'guide/with space.md': '# Пробел',
        'secret.md': '# Секрет',
    });
    try {
        const index = buildDocsIndex({ docsRoot: root });
        assert.equal(findDoc(index, 'guide/with%20space.md').path, 'guide/with space.md');
        assert.equal(findDoc(index, '%2e%2e/secret.md'), undefined);
        assert.equal(findDoc(index, './guide/with space.md').path, 'guide/with space.md');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('renderIndex не добавляет описание, если его нет', () => {
    const root = makeDocs({
        'guide/empty.md': '---\ntitle: Пустая страница\n---\n',
        'custom/one.md': '# Свой раздел',
    });
    try {
        const markdown = buildDocsIndex({ docsRoot: root }).renderIndex();
        assert.match(markdown, /- \[Пустая страница\]\(latent-docs:\/\/guide\/empty\.md\)$/m);
        assert.match(markdown, /## Custom \(custom\)/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('заголовок index.md без front matter: корень — «Документация», вложенный — имя папки', () => {
    const root = makeDocs({
        'index.md': 'Просто текст без заголовка.',
        'guide/index.md': 'Тоже без заголовка.',
    });
    try {
        const index = buildDocsIndex({ docsRoot: root });
        assert.equal(index.find('index.md').title, 'Документация');
        assert.equal(index.find('guide/index.md').title, 'Guide');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
