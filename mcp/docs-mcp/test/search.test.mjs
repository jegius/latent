// search.test.mjs — тесты токенизации, ранжирования и сниппетов.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDocsIndex } from '../src/docs-index.mjs';
import { buildSnippet, clampLimit, queryTerms, searchDocs, tokenize } from '../src/search.mjs';
import { FIXTURES_DOCS } from './helpers.mjs';

/** @returns {object} */
function fixtureIndex() {
    return buildDocsIndex({ docsRoot: FIXTURES_DOCS });
}

test('tokenize: нижний регистр, кириллица, отбрасывание стоп-слов', () => {
    assert.deepEqual(tokenize('Переменные И типы'), ['переменные', 'типы']);
    assert.deepEqual(tokenize('push(arr, 42)'), ['push', 'arr', '42']);
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(undefined), []);
});

test('queryTerms отбрасывает дубликаты и усекает основы', () => {
    const { terms } = queryTerms('переменная переменная');
    assert.equal(terms.length, 1);
    assert.equal(terms[0].raw, 'переменная');
    assert.equal(terms[0].stem.length < terms[0].raw.length, true);
});

test('поиск находит страницу по заголовку и ставит её первой', () => {
    const index = fixtureIndex();
    const results = searchDocs(index, 'Переменные и типы');

    assert.ok(results.length >= 1);
    assert.equal(results[0].path, 'guide/variables.md');
    assert.ok(results[0].score > 10);
    assert.match(results[0].snippet, /Переменн|переменн/);
});

test('поиск регистронезависим и находит встроенные функции', () => {
    const index = fixtureIndex();
    const results = searchDocs(index, 'PUSH');

    assert.ok(results.length >= 1);
    assert.equal(results[0].path, 'reference/builtins.md');
});

test('описание и теги участвуют в ранжировании', () => {
    const index = fixtureIndex();
    const results = searchDocs(index, 'рекурсия');
    assert.ok(results.length >= 1);
    assert.equal(results[0].path, 'guide/functions.md');
});

test('заголовок весит больше тела: «Типы» → reference/types.md', () => {
    const index = fixtureIndex();
    const results = searchDocs(index, 'Типы');
    assert.equal(results[0].path, 'reference/types.md');
});

test('нет совпадений — пустой результат', () => {
    const index = fixtureIndex();
    assert.deepEqual(searchDocs(index, 'квантовый_банан_zzz'), []);
    assert.deepEqual(searchDocs(index, ''), []);
    assert.deepEqual(searchDocs(index, '   '), []);
});

test('limit ограничивает количество результатов', () => {
    const index = fixtureIndex();
    const all = searchDocs(index, 'Latent');
    assert.ok(all.length >= 2);
    const limited = searchDocs(index, 'Latent', { limit: 1 });
    assert.equal(limited.length, 1);
    assert.equal(clampLimit(0), 1);
    assert.equal(clampLimit(500), 50);
    assert.equal(clampLimit('abc'), 10);
});

test('сниппет содержит контекст и подсветку', () => {
    const index = fixtureIndex();
    const result = searchDocs(index, 'push', { limit: 1 })[0];
    assert.equal(typeof result.snippet, 'string');
    assert.ok(result.snippet.length > 10);
    assert.match(result.snippet, /\*\*/);
});

test('buildSnippet добавляет многоточия при обрезке', () => {
    const doc = {
        content: `${'вступление '.repeat(40)}push(arr, value)${' хвост'.repeat(40)}`,
        text: '',
    };
    const snippet = buildSnippet(doc, [{ raw: 'push', stem: 'push' }], 120);
    assert.match(snippet, /^…/);
    assert.match(snippet, /…$/);
    assert.match(snippet, /\*\*push\*\*/);
});

test('структура результата соответствует контракту', () => {
    const index = fixtureIndex();
    const [result] = searchDocs(index, 'функции');
    assert.deepEqual(Object.keys(result).sort(), ['path', 'score', 'snippet', 'title']);
    assert.equal(typeof result.path, 'string');
    assert.equal(typeof result.title, 'string');
    assert.equal(typeof result.score, 'number');
    assert.equal(typeof result.snippet, 'string');
});

test('tokenize сохраняет цифры и короткие токены с цифрой, но не «_»', () => {
    assert.deepEqual(tokenize('7 42 _ a'), ['7', '42']);
    assert.deepEqual(tokenize('The AND for'), []);
    assert.deepEqual(tokenize(null), []);
});

test('queryTerms пустого запроса — пустой список терминов', () => {
    assert.deepEqual(queryTerms(''), { terms: [] });
    assert.deepEqual(queryTerms('и в на'), { terms: [] });
});

test('searchDocs: отсутствующий индекс и нестроковый запрос дают пустой результат', () => {
    const missing = buildDocsIndex({ docsRoot: path.join(os.tmpdir(), 'latent-search-missing-xyz') });
    assert.deepEqual(searchDocs(missing, 'что угодно'), []);
    assert.deepEqual(searchDocs(missing, undefined), []);

    const index = fixtureIndex();
    assert.deepEqual(searchDocs(index, null), []);
    assert.deepEqual(searchDocs(index, 42), []);
});

test('clampLimit: дробные, отрицательные и бесконечные значения', () => {
    assert.equal(clampLimit(2.9), 2);
    assert.equal(clampLimit(-5), 1);
    assert.equal(clampLimit(Number.NaN), 10);
    assert.equal(clampLimit('7'), 7);
    assert.equal(clampLimit(Infinity), 10);
    assert.equal(clampLimit(), 10);
});

test('ранжирование: совпадение только в теле и только в тегах', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-search-'));
    try {
        fs.writeFileSync(path.join(root, 'body.md'), '---\ntitle: Alpha\ntags: [обычный]\n---\n\nЗдесь живёт зебра.', 'utf8');
        fs.writeFileSync(path.join(root, 'tags.md'), '---\ntitle: Beta\ntags: [квокка]\n---\n\nОбычный текст.', 'utf8');
        fs.writeFileSync(path.join(root, 'heading.md'), '---\ntitle: Gamma\n---\n\n## Нарвал\n\nТекст.', 'utf8');
        const index = buildDocsIndex({ docsRoot: root });

        const bodyHit = searchDocs(index, 'зебра');
        assert.equal(bodyHit[0].path, 'body.md');
        assert.ok(bodyHit[0].score >= 1);

        const tagHit = searchDocs(index, 'квокка');
        assert.equal(tagHit[0].path, 'tags.md');
        assert.ok(tagHit[0].score >= 3);

        const headingHit = searchDocs(index, 'нарвал');
        assert.equal(headingHit[0].path, 'heading.md');
        assert.ok(headingHit[0].score >= 2);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('фраза целиком повышает вес в заголовке, описании, заголовках и теле', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-search-phrase-'));
    try {
        fs.writeFileSync(path.join(root, 'a.md'), '---\ntitle: Точная фраза\ndescription: A\n---\n\nТекст.', 'utf8');
        fs.writeFileSync(path.join(root, 'b.md'), '---\ntitle: B\ndescription: Точная фраза\n---\n\nТекст.', 'utf8');
        fs.writeFileSync(path.join(root, 'c.md'), '---\ntitle: C\ndescription: C\n---\n\n## Точная фраза\n\nТекст.', 'utf8');
        fs.writeFileSync(path.join(root, 'd.md'), '---\ntitle: D\ndescription: D\n---\n\nТочная фраза в теле.', 'utf8');
        const index = buildDocsIndex({ docsRoot: root });
        const results = searchDocs(index, 'точная фраза');
        assert.deepEqual(results.map((result) => result.path), ['a.md', 'b.md', 'c.md', 'd.md']);
        assert.ok(results[0].score > results[1].score);
        assert.ok(results[1].score >= results[2].score);
        assert.ok(results[2].score > results[3].score);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('равный счёт сортируется по пути для стабильности', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-search-tie-'));
    try {
        for (const name of ['z.md', 'a.md', 'm.md']) {
            fs.writeFileSync(path.join(root, name), '---\ntitle: Одинаковый\n---\n\nОдинаковый текст.', 'utf8');
        }
        const index = buildDocsIndex({ docsRoot: root });
        assert.deepEqual(searchDocs(index, 'одинаковый').map((result) => result.path), ['a.md', 'm.md', 'z.md']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('buildSnippet использует text, если content отсутствует', () => {
    const doc = { text: 'Плоский текст про массивы и push.', content: '' };
    const snippet = buildSnippet(doc, [{ raw: 'массивы', stem: 'массив' }], 120);
    assert.match(snippet, /\*\*масси\*\*вы/);
});

test('buildSnippet без совпадений не добавляет подсветку и лишние многоточия', () => {
    const short = buildSnippet({ content: 'Короткий текст.', text: '' }, [{ raw: 'зебра', stem: 'зебр' }], 100);
    assert.equal(short, 'Короткий текст.');

    const long = buildSnippet({ content: 'ж'.repeat(300), text: '' }, [{ raw: 'зебра', stem: 'зебр' }], 100);
    assert.match(long, /…$/);
});

test('buildSnippet: подсветка не срабатывает, если термин исчез после очистки разметки', () => {
    const doc = { content: 'См. [ссылка](https://push.example) и всё.', text: '' };
    const snippet = buildSnippet(doc, [{ raw: 'push', stem: 'push' }], 200);
    assert.doesNotMatch(snippet, /\*\*push\*\*/);
    assert.match(snippet, /ссылка/);
});

test('limit в searchDocs не влияет на порядок и не превышает 50', () => {
    const index = fixtureIndex();
    const all = searchDocs(index, 'latent', { limit: 100 });
    assert.ok(all.length <= 50);
    assert.equal(searchDocs(index, 'latent', { limit: 0 }).length, 1);
});
