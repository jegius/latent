// tooling/latent-lsp/test/language-data.test.mjs — валидация language.json и
// инвариантов, на которые опираются completion/hover/signature help.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadLanguageData, LanguageData } from '../src/language-data.mjs';
import { validateLanguageData } from '../../language-data/validate.mjs';
import { languageData, REPO_ROOT } from './helpers.mjs';

const SCHEMA_PATH = path.join(REPO_ROOT, 'tooling/language-data/latent-language.schema.json');
const LANGUAGE_JSON = path.join(REPO_ROOT, 'tooling/language-data/language.json');

test('language.json проходит собственный валидатор', () => {
    const raw = JSON.parse(fs.readFileSync(LANGUAGE_JSON, 'utf8'));
    const result = validateLanguageData(raw);
    assert.deepEqual(result.errors, [], 'ошибки валидации: ' + result.errors.join('; '));
    assert.equal(result.ok, true);
});

test('схема — JSON Schema draft-07 с обязательными полями', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    assert.match(schema.$schema, /draft-07/);
    for (const field of ['version', 'language', 'keywords', 'operators', 'types',
        'builtins', 'hostOnly', 'diagnostics']) {
        assert.ok(schema.required.includes(field), `в схеме нет required "${field}"`);
        assert.ok(schema.properties[field], `в схеме нет свойства "${field}"`);
    }
    assert.ok(schema.definitions.keyword);
    assert.ok(schema.definitions.builtin);
    assert.ok(schema.definitions.diagnostic);
});

test('37 ключевых слов и 13 мягких', () => {
    const data = languageData();
    assert.equal(data.keywordList.length, 37);
    const soft = data.keywordList.filter((k) => k.soft).map((k) => k.name).sort();
    assert.deepEqual(soft, [
        'agent', 'ai_contract', 'assert', 'assert_eq', 'case', 'embedding',
        'enforce_contract', 'forall', 'model', 'semantic', 'snapshot', 'tensor', 'test',
    ]);
    // Жёсткие ключевые слова, которые обязаны быть в лексере.
    for (const name of ['let', 'fn', 'if', 'else', 'while', 'for', 'in', 'return',
        'class', 'new', 'this', 'async', 'await', 'spawn', 'channel', 'select',
        'default', 'yield', 'match', 'enum', 'true', 'false', 'null', 'ai']) {
        assert.ok(data.keywords.has(name), `нет ключевого слова ${name}`);
        assert.equal(data.keywords.get(name).soft, false, `${name} должно быть жёстким`);
    }
});

test('операторы: приоритеты и ассоциативность совпадают с parser', () => {
    const data = languageData();
    const find = (op, kind) => data.operatorList.find((o) => o.op === op && o.kind === kind);
    const expected = [
        ['||', 10, 'left'], ['&&', 20, 'left'], ['==', 30, 'left'], ['!=', 30, 'left'],
        ['<', 40, 'left'], ['>', 40, 'left'], ['<=', 40, 'left'], ['>=', 40, 'left'],
        ['|', 50, 'left'], ['^', 50, 'left'], ['&', 60, 'left'], ['<<', 70, 'left'],
        ['>>', 70, 'left'], ['+', 80, 'left'], ['-', 80, 'left'], ['*', 90, 'left'],
        ['/', 90, 'left'], ['%', 90, 'left'],
    ];
    for (const [op, precedence, assoc] of expected) {
        const entry = find(op, 'binary');
        assert.ok(entry, `нет бинарного оператора ${op}`);
        assert.equal(entry.precedence, precedence, `приоритет ${op}`);
        assert.equal(entry.assoc, assoc, `ассоциативность ${op}`);
    }
    assert.equal(find('!', 'unary').precedence, 95);
    assert.equal(find('-', 'unary').precedence, 95);
    assert.equal(find('=', 'assignment').assoc, 'right');
    assert.equal(find('<-', 'binary').assoc, 'right');
    assert.ok(find('->', 'arrow'));
    assert.ok(find('=>', 'arrow'));
    assert.ok(find('.', 'postfix'));
});

test('типы: примитивы, коллекции, AI и конкурентность', () => {
    const data = languageData();
    for (const name of ['int', 'float', 'bool', 'string', 'null', 'unit', 'void',
        '[T]', 'fn(T, ...) -> R', 'channel', 'Channel<T>', 'Promise<T>',
        'Model<T>', 'Embedding<N>', 'Tensor<[dims]>', 'Agent', 'Semantic']) {
        assert.ok(data.types.has(name), `нет типа ${name}`);
    }
    assert.equal(data.types.get('int').wasm, 'i32');
    assert.equal(data.types.get('float').wasm, 'f64');
});

test('builtins: функциональная форма, методы и host-only', () => {
    const data = languageData();
    for (const name of ['print', 'len', 'push', 'str', 'int', 'float', 'sqrt',
        'assert', 'assert_eq', 'alloc', 'load8', 'store8', 'load32', 'store32', 'memcopy']) {
        const entry = data.findBuiltin(name);
        assert.ok(entry, `нет builtin ${name}`);
        assert.ok(entry.signatures.length > 0, `нет сигнатур у ${name}`);
        assert.equal(entry.engine, 'both', `${name} должен работать в обоих движках`);
    }
    for (const method of ['push', 'pop', 'length', 'to_str', 'to_int']) {
        assert.ok(data.findMethod(method), `нет метода ${method}`);
    }
    assert.equal(data.findMethod('pop').owner, 'array');
    assert.equal(data.findMethod('length', 'array').kind, 'property');
    for (const name of data.hostOnly) {
        const entry = data.findBuiltin(name);
        assert.ok(entry, `hostOnly ${name} отсутствует в builtins`);
        assert.equal(entry.engine, 'host', `hostOnly ${name} должен иметь engine=host`);
    }
    // Движок №2 не поддерживает host-only примитивы — это часть контракта.
    assert.ok(data.hostOnly.has('tensor'));
    assert.ok(data.hostOnly.has('channel'));
    assert.ok(data.hostOnly.has('ai_infer'));
});

test('каталог диагностик: коды уникальны, regex разбирает sample', () => {
    const data = languageData();
    assert.ok(data.diagnostics.length >= 25, 'ожидается полный каталог диагностик');
    const codes = new Set();
    for (const diagnostic of data.diagnostics) {
        assert.ok(diagnostic.code, 'у диагностики нет code');
        assert.ok(!codes.has(diagnostic.code), `дубликат code ${diagnostic.code}`);
        codes.add(diagnostic.code);
        assert.ok(diagnostic.pattern.includes('{') || diagnostic.pattern.length > 5);
        if (diagnostic.regex) {
            const regex = new RegExp(diagnostic.regex);
            assert.ok(regex.test(diagnostic.sample), `${diagnostic.code}: sample не матчится`);
            if (diagnostic.positioned) {
                assert.match(diagnostic.sample, /на строке \d+:\d+/);
            }
        }
    }
    // Ключевые реальные тексты из src/ обязаны присутствовать.
    for (const code of ['LEX_UNEXPECTED_CHAR', 'PARSE_UNEXPECTED_TOKEN', 'TYPE_MISMATCH',
        'TYPE_UNDEFINED_VARIABLE', 'GEN_HOST_BUILTIN', 'GEN_UNKNOWN_FUNCTION']) {
        assert.ok(codes.has(code), `нет диагностики ${code}`);
    }
});

test('диагностика по тексту ошибки определяется кодом из каталога', () => {
    const data = languageData();
    assert.equal(
        data.diagnosticCode("Неожиданный символ '#' на строке 1:13"),
        'LEX_UNEXPECTED_CHAR');
    assert.equal(
        data.diagnosticCode("Builtin 'tensor' не поддерживается движком №2 (требует host-рантайма)"),
        'GEN_HOST_BUILTIN');
    assert.equal(
        data.diagnosticCode('Ошибка парсинга на строке 1:21: ожидалось \'expression\', найдено Semicolon'),
        'PARSE_UNEXPECTED_TOKEN');
    assert.equal(data.diagnosticCode('совершенно неизвестный текст'), undefined);
});

test('LanguageData индексирует методы по владельцам', () => {
    const data = new LanguageData({
        version: '1.0.0',
        language: 'latent',
        keywords: [],
        operators: [],
        types: [],
        builtins: [
            { name: 'push', kind: 'function', signatures: ['push(a, b)'], engine: 'both' },
            { name: 'push', kind: 'method', owner: 'array', signatures: ['a.push(b)'], engine: 'both' },
            { name: 'send', kind: 'method', owner: 'channel', signatures: ['ch.send(v)'], engine: 'host' },
        ],
        hostOnly: ['send'],
        diagnostics: [],
    });
    assert.equal(data.findBuiltin('push').kind, 'function');
    assert.equal(data.findMethod('push').kind, 'method');
    assert.equal(data.findMethod('send').owner, 'channel');
    assert.deepEqual(data.methodsFor('array').map((m) => m.name), ['push']);
    assert.ok(data.allMethods().some((m) => m.name === 'send'));
});

test('loadLanguageData падает с понятной ошибкой на отсутствующий файл', () => {
    assert.throws(() => loadLanguageData(path.join(REPO_ROOT, 'tooling/language-data/nope.json')),
        /не удалось прочитать language data/);
});

test('language.json — валидный UTF-8 JSON без комментариев', () => {
    const text = fs.readFileSync(LANGUAGE_JSON, 'utf8');
    assert.ok(!text.includes('\uFEFF'), 'BOM запрещён');
    assert.doesNotThrow(() => JSON.parse(text));
});
