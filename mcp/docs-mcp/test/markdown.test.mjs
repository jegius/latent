// markdown.test.mjs — граничные случаи разбора Markdown и front matter.
//
// Тесты проверяют контракт парсера: YAML-подобные скаляры и списки, блочные
// значения `|`/`>`, BOM/CRLF, заголовки внутри fenced-блоков, «плоский» текст
// и первый абзац для description. Каждый тест фиксирует поведение, на которое
// опираются docs-index, поиск и prompts.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractHeadings,
    firstParagraph,
    normalizeText,
    parseFrontMatter,
    stripInline,
    stripMarkdown,
} from '../src/markdown.mjs';

test('normalizeText убирает BOM, приводит CRLF и терпит не-строки', () => {
    assert.equal(normalizeText('\uFEFF---\r\ntitle: x\r\n---'), '---\ntitle: x\n---');
    assert.equal(normalizeText('a\rb'), 'a\nb');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(42), '');
});

test('parseFrontMatter без разделителя возвращает исходник целиком', () => {
    const { data, content } = parseFrontMatter('# Заголовок\n\nТекст');
    assert.deepEqual(data, {});
    assert.equal(content, '# Заголовок\n\nТекст');
});

test('parseFrontMatter: первая строка не ровно "---" — front matter не распознан', () => {
    const raw = '---x\ntitle: не front matter\n---\nтело';
    const { data, content } = parseFrontMatter(raw);
    assert.deepEqual(data, {});
    assert.equal(content, raw);
});

test('parseFrontMatter: незакрытый front matter не съедает документ', () => {
    const raw = '---\ntitle: Начало\n\n# Заголовок\n\nТекст без закрывающего разделителя';
    const { data, content } = parseFrontMatter(raw);
    assert.deepEqual(data, {});
    assert.equal(content, raw);
});

test('parseFrontMatter: закрытие "..." и отбрасывание пустых строк перед телом', () => {
    const raw = '---\ntitle: X\ntags: [a, b]\n...\n\n\n# Тело';
    const { data, content } = parseFrontMatter(raw);
    assert.equal(data.title, 'X');
    assert.deepEqual(data.tags, ['a', 'b']);
    assert.equal(content, '# Тело');
});

test('parseFrontMatter: BOM и CRLF в реальном файле не мешают разбору', () => {
    const raw = '\uFEFF---\r\ntitle: "BOM"\r\nsidebar_position: 2\r\n---\r\n\r\n# Текст\r\n';
    const { data, content } = parseFrontMatter(raw);
    assert.equal(data.title, 'BOM');
    assert.equal(data.sidebar_position, 2);
    assert.equal(content, '# Текст\n');
});

test('parseYamlLike: комментарии и пустые строки пропускаются', () => {
    const raw = '---\n# комментарий\n\ntitle: "T"\n\n# ещё\n---\nтело';
    assert.deepEqual(parseFrontMatter(raw).data, { title: 'T' });
});

test('parseYamlLike: элемент списка без ключа игнорируется', () => {
    const raw = '---\n- безымянный\n- ещё\n---\nтело';
    assert.deepEqual(parseFrontMatter(raw).data, {});
});

test('parseYamlLike: список после пустого ключа и табы в отступах', () => {
    const raw = '---\ntags:\n\t- alpha\n\t- beta\n---\nтело';
    const { data } = parseFrontMatter(raw);
    assert.deepEqual(data.tags, ['alpha', 'beta']);
});

test('parseYamlLike: скалярное значение перед списком превращается в массив', () => {
    const raw = '---\ntags: одиночный\n- второй\n---\nтело';
    const { data } = parseFrontMatter(raw);
    assert.deepEqual(data.tags, ['одиночный', 'второй']);
});

test('parseYamlLike: блочное значение "|" сохраняет переводы строк', () => {
    const raw = '---\ndescription: |\n  Первая строка\n  Вторая строка\ntitle: T\n---\nтело';
    const { data } = parseFrontMatter(raw);
    assert.equal(data.description, 'Первая строка\nВторая строка');
    assert.equal(data.title, 'T');
});

test('parseYamlLike: блочное значение ">" и продолжение многострочного текста', () => {
    const raw = [
        '---',
        'title: T',
        'description:',
        '  Строка один',
        '  Строка два',
        '---',
        'тело',
    ].join('\n');
    const { data } = parseFrontMatter(raw);
    assert.equal(data.description, 'Строка один\nСтрока два');
});

test('parseYamlLike: инлайн-комментарий не ломает простое значение', () => {
    const { data } = parseFrontMatter('---\ntitle: Привет # не комментарий YAML\n---\nтело');
    assert.equal(data.title, 'Привет # не комментарий YAML');
});

test('parseScalar: null, "~", boolean, числа и пустая строка', () => {
    const raw = [
        '---',
        'a: null',
        'b: ~',
        'c: true',
        'd: false',
        'e: 42',
        'f: -3.5',
        'g:',
        '---',
        'тело',
    ].join('\n');
    const { data } = parseFrontMatter(raw);
    assert.equal(data.a, null);
    assert.equal(data.b, null);
    assert.equal(data.c, true);
    assert.equal(data.d, false);
    assert.equal(data.e, 42);
    assert.equal(data.f, -3.5);
    assert.deepEqual(data.g, []);
});

test('parseScalar: двойные кавычки с JSON-экранированием', () => {
    const { data } = parseFrontMatter('---\ntitle: "Он сказал \\"да\\""\n---\nтело');
    assert.equal(data.title, 'Он сказал "да"');
});

test('parseScalar: невалидный JSON в кавычках — мягкая деградация', () => {
    const { data } = parseFrontMatter('---\ntitle: "C:\\new\\path"\n---\nтело');
    assert.equal(data.title, 'C:\\new\\path');
});

test('parseScalar: одинарные кавычки и экранирование ""', () => {
    const { data } = parseFrontMatter("---\ntitle: 'это ''кавычки'''\n---\nтело");
    assert.equal(data.title, "это 'кавычки'");
});

test('parseScalar: пустой и непустой flow-список', () => {
    const { data } = parseFrontMatter('---\nempty: []\nmixed: [a, 2, true]\n---\nтело');
    assert.deepEqual(data.empty, []);
    assert.deepEqual(data.mixed, ['a', 2, true]);
});

test('parseScalar: незакрытые кавычки остаются строкой как есть', () => {
    const { data } = parseFrontMatter('---\ntitle: "незакрытая\n---\nтело');
    assert.equal(data.title, '"незакрытая');
});

test('extractHeadings: заголовки в блоках ``` и ~~~ игнорируются', () => {
    const markdown = [
        '# H1',
        '',
        '```latent',
        '## не заголовок',
        '```',
        '',
        '~~~',
        '# тоже не заголовок',
        '~~~',
        '',
        '### H3 ###',
    ].join('\n');
    const headings = extractHeadings(markdown);
    assert.deepEqual(headings.map((heading) => [heading.level, heading.text]), [[1, 'H1'], [3, 'H3']]);
    assert.deepEqual(headings.map((heading) => heading.line), [1, 11]);
});

test('extractHeadings: незакрытый fence скрывает остаток документа', () => {
    const headings = extractHeadings('# H1\n```\n# внутри\n');
    assert.deepEqual(headings.map((heading) => heading.text), ['H1']);
});

test('extractHeadings: заголовок из одной разметки отбрасывается', () => {
    const headings = extractHeadings('# <span></span>\n## <br>\n## Живой');
    assert.deepEqual(headings.map((heading) => heading.text), ['Живой']);
});

test('stripInline убирает ссылки, код, выделение и HTML', () => {
    assert.equal(
        stripInline('**Жирный** и _курсив_ `код` [ссылка](https://x) ![alt](img.png) <b>html</b>'),
        'Жирный и курсив код ссылка alt html',
    );
    assert.equal(stripInline('__подчёркнутый__ *звёздочный*'), 'подчёркнутый звёздочный');
});

test('stripMarkdown убирает маркеры блоков, таблиц и цитат', () => {
    const markdown = [
        '# Заголовок',
        '',
        '> цитата',
        '',
        '- пункт',
        '1. нумерованный',
        '',
        '---',
        '',
        '| a | b |',
        '|---|---|',
        '',
        '```latent',
        'let x = 1;',
        '```',
        '',
        '**жирный** [ссылка](https://x) `код`',
    ].join('\n');
    const text = stripMarkdown(markdown);
    assert.doesNotMatch(text, /^#/m);
    assert.doesNotMatch(text, /\|/);
    assert.doesNotMatch(text, /\*\*/);
    assert.doesNotMatch(text, /```/);
    assert.match(text, /Заголовок/);
    assert.match(text, /let x = 1;/);
    assert.match(text, /ссылка/);
});

test('firstParagraph пропускает заголовки, таблицы, HTML и import/export', () => {
    const markdown = [
        '# Заголовок',
        '',
        '| таблица |',
        '|---|',
        '',
        '<div>html</div>',
        '',
        'import x from "y";',
        '',
        'export const z = 1;',
        '',
        'Первый **настоящий** абзац.',
        'Вторая строка абзаца.',
        '',
        'Второй абзац не нужен.',
    ].join('\n');
    assert.equal(firstParagraph(markdown), 'Первый настоящий абзац. Вторая строка абзаца.');
});

test('firstParagraph пропускает строку-маркер admonition', () => {
    assert.equal(firstParagraph(':::note\n\nОписание после маркера.'), 'Описание после маркера.');
});

test('firstParagraph: код перед абзацем не становится описанием', () => {
    const markdown = '```latent\nfn main() {}\n```\n\nОписание после кода.';
    assert.equal(firstParagraph(markdown), 'Описание после кода.');
});

test('firstParagraph: абзац перед кодом обрывается на fence', () => {
    const markdown = 'Описание до кода.\n\n```latent\nfn main() {}\n```\n\nПосле кода.';
    assert.equal(firstParagraph(markdown), 'Описание до кода.');
});

test('firstParagraph обрезает длинный текст и ставит многоточие', () => {
    const text = firstParagraph('а'.repeat(300), 50);
    assert.equal(text.length, 50);
    assert.match(text, /…$/);
});

test('firstParagraph пустого и чисто разметочного текста — пустая строка', () => {
    assert.equal(firstParagraph(''), '');
    assert.equal(firstParagraph('# только заголовок\n\n```\nкод\n```\n'), '');
});
