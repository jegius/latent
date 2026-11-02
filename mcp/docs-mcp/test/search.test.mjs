// search.test.mjs — тесты токенизации, ранжирования и сниппетов.

import test from 'node:test';
import assert from 'node:assert/strict';

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
