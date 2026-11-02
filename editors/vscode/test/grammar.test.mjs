import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

const grammar = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes', 'latent.tmLanguage.json'), 'utf8'));
const languageConfiguration = JSON.parse(fs.readFileSync(path.join(root, 'language-configuration.json'), 'utf8'));

const REGEX_KEYS = ['match', 'begin', 'end', 'while'];

function walk(node, visit, trail = '$') {
    if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, visit, `${trail}[${index}]`));
        return;
    }
    if (node && typeof node === 'object') {
        visit(node, trail);
        for (const [key, value] of Object.entries(node)) {
            walk(value, visit, `${trail}.${key}`);
        }
    }
}

function collectPatterns(groupName) {
    const group = grammar.repository[groupName];
    const patterns = [];
    walk(group, (node) => {
        if (typeof node.match === 'string') patterns.push(node.match);
        if (typeof node.begin === 'string') patterns.push(node.begin);
        if (typeof node.end === 'string') patterns.push(node.end);
        if (typeof node.while === 'string') patterns.push(node.while);
    });
    return patterns.map((pattern) => new RegExp(pattern));
}

function collectScopes() {
    const scopes = new Set();
    walk(grammar, (node) => {
        if (typeof node.name === 'string') scopes.add(node.name);
    });
    return scopes;
}

test('tmLanguage: базовая структура', () => {
    assert.equal(grammar.scopeName, 'source.latent');
    assert.equal(grammar.name, 'Latent');
    assert.deepEqual(grammar.fileTypes, ['lat']);
    assert.ok(Array.isArray(grammar.patterns) && grammar.patterns.length >= 10);
    assert.ok(grammar.repository && typeof grammar.repository === 'object');
    const includes = grammar.patterns.map((pattern) => pattern.include);
    for (const group of ['comments', 'strings', 'numbers', 'constants', 'declarations',
        'decorators', 'builtins', 'keywords', 'types', 'calls', 'properties',
        'identifiers', 'operators', 'punctuation']) {
        assert.ok(includes.includes(`#${group}`), `нет include #${group}`);
        assert.ok(grammar.repository[group], `нет repository.${group}`);
    }
});

test('tmLanguage: все regex-паттерны валидны для JS RegExp', () => {
    let checked = 0;
    walk(grammar, (node, trail) => {
        for (const key of REGEX_KEYS) {
            if (typeof node[key] !== 'string') continue;
            checked += 1;
            try {
                new RegExp(node[key]);
            } catch (e) {
                assert.fail(`${trail}.${key}: невалидный regex ${JSON.stringify(node[key])}: ${e.message}`);
            }
        }
    });
    assert.ok(checked > 30, `проверено слишком мало regex: ${checked}`);
});

test('tmLanguage: ключевые scope-имена присутствуют', () => {
    const scopes = collectScopes();
    const required = [
        'comment.line.double-slash.latent',
        'comment.block.latent',
        'string.quoted.double.latent',
        'constant.character.escape.latent',
        'constant.numeric.integer.latent',
        'constant.numeric.float.latent',
        'constant.language.boolean.latent',
        'constant.language.null.latent',
        'keyword.control.latent',
        'keyword.declaration.latent',
        'keyword.other.soft.latent',
        'keyword.operator.latent',
        'entity.name.function.latent',
        'entity.name.type.class.latent',
        'entity.name.type.enum.latent',
        'entity.name.function.decorator.latent',
        'support.function.builtin.latent',
        'support.type.primitive.latent',
        'variable.other.property.latent',
        'punctuation.section.block.latent',
        'invalid.illegal.unterminated-string.latent',
    ];
    for (const scope of required) {
        assert.ok(scopes.has(scope), `нет scope ${scope}`);
    }
});

test('tmLanguage: 37 ключевых слов (21 жёсткое + 13 мягких + 3 литерала)', () => {
    const keywords = [
        'let', 'fn', 'if', 'else', 'while', 'for', 'in', 'return', 'class', 'new', 'this',
        'async', 'await', 'spawn', 'channel', 'select', 'default', 'yield', 'match', 'enum',
        'ai',
        'case', 'test', 'assert', 'assert_eq', 'forall', 'snapshot', 'ai_contract',
        'enforce_contract', 'model', 'agent', 'embedding', 'tensor', 'semantic',
    ];
    assert.equal(keywords.length, 34);
    const keywordRegexes = collectPatterns('keywords');
    for (const keyword of keywords) {
        const matched = keywordRegexes.some((regex) => regex.test(keyword));
        assert.ok(matched, `ключевое слово ${keyword} не покрыто грамматикой`);
    }
    const constants = collectPatterns('constants');
    for (const literal of ['true', 'false', 'null']) {
        assert.ok(constants.some((regex) => regex.test(literal)), `литерал ${literal} не покрыт`);
    }
    const softRegexes = grammar.repository.keywords.patterns
        .filter((pattern) => pattern.name === 'keyword.other.soft.latent')
        .map((pattern) => new RegExp(pattern.match));
    for (const soft of ['case', 'test', 'assert', 'assert_eq', 'forall', 'snapshot',
        'ai_contract', 'enforce_contract', 'model', 'agent', 'embedding', 'tensor', 'semantic']) {
        assert.ok(softRegexes.some((regex) => regex.test(soft)), `мягкое слово ${soft} не покрыто`);
    }
});

test('tmLanguage: все builtins из language-data упомянуты', () => {
    const grammarText = fs.readFileSync(path.join(root, 'syntaxes', 'latent.tmLanguage.json'), 'utf8');
    const builtinPatterns = collectPatterns('builtins');
    const required = [
        'print', 'len', 'push', 'str', 'int', 'float', 'sqrt', 'assert', 'assert_eq',
        'alloc', 'load8', 'store8', 'load32', 'store32', 'memcopy',
        'channel', 'tensor', 'semantic', 'matmul', 'cosine_similarity', 'dot',
        'magnitude', 'zeros', 'ones', 'snapshot', 'ai_contract', 'enforce_contract',
        'ai_infer', 'ai_embed', 'ai_stream', 'stream_next',
        'Ok', 'Err', 'Some', 'None',
    ];
    for (const name of required) {
        const matched = builtinPatterns.some((regex) => regex.test(`${name}(`));
        assert.ok(matched, `builtin ${name} не подсвечивается`);
    }
    assert.match(grammarText, /ai_generate/);
    assert.ok(builtinPatterns.some((regex) => regex.test('ai_generate!')));
});

test('tmLanguage: AI-примитивы и декораторы', () => {
    const grammarText = fs.readFileSync(path.join(root, 'syntaxes', 'latent.tmLanguage.json'), 'utf8');
    for (const word of ['ai_infer', 'ai_embed', 'ai_generate', 'tensor', 'matmul']) {
        assert.ok(grammarText.includes(word), `нет ${word}`);
    }
    const decoratorPatterns = collectPatterns('decorators');
    assert.ok(decoratorPatterns.some((regex) => regex.test('@test')));
    assert.ok(decoratorPatterns.some((regex) => regex.test('@ai_contract')));
});

test('tmLanguage: операторы покрыты', () => {
    const operators = ['=>', '->', '<-', '&&', '||', '==', '!=', '<=', '>=', '<<', '>>',
        '&', '|', '^', '!', '+', '-', '*', '/', '%'];
    const operatorRegexes = collectPatterns('operators');
    for (const operator of operators) {
        assert.ok(operatorRegexes.some((regex) => regex.test(operator)), `оператор ${operator} не покрыт`);
    }
    assert.ok(operatorRegexes.some((regex) => regex.test('&&')));
    assert.ok(operatorRegexes.some((regex) => regex.test('||')));
});

test('tmLanguage: комментарии и строки с escape', () => {
    const commentPatterns = collectPatterns('comments');
    assert.ok(commentPatterns.some((regex) => regex.test('// комментарий')));
    assert.ok(commentPatterns.some((regex) => regex.test('/* блок */')));
    const stringPatterns = collectPatterns('strings');
    assert.ok(stringPatterns.some((regex) => regex.test('"строка"')));
    assert.ok(stringPatterns.some((regex) => regex.test('"\\n"')));
    const invalidEscape = grammar.repository.strings.patterns
        .flatMap((pattern) => pattern.patterns || [])
        .find((pattern) => pattern.name === 'invalid.illegal.character.escape.latent');
    assert.ok(invalidEscape);
    assert.ok(new RegExp(invalidEscape.match).test('\\q'));
});

test('language-configuration: комментарии, скобки, авто-пары, фолдинг', () => {
    assert.deepEqual(languageConfiguration.comments, {
        lineComment: '//',
        blockComment: ['/*', '*/'],
    });
    const brackets = languageConfiguration.brackets.map(([open, close]) => `${open}${close}`);
    assert.deepEqual(brackets, ['{}', '[]', '()']);

    const autoPairs = languageConfiguration.autoClosingPairs;
    const pair = (open, close) => autoPairs.some((item) => item.open === open && item.close === close);
    assert.ok(pair('{', '}'));
    assert.ok(pair('[', ']'));
    assert.ok(pair('(', ')'));
    assert.ok(pair('"', '"'));
    assert.ok(pair('/*', '*/'), 'нет auto-пары /* */');

    assert.ok(Array.isArray(languageConfiguration.surroundingPairs));
    assert.ok(languageConfiguration.surroundingPairs.length >= 4);

    assert.equal(languageConfiguration.wordPattern, '[A-Za-z_][A-Za-z0-9_]*');
    assert.doesNotThrow(() => new RegExp(languageConfiguration.wordPattern));
    assert.match('myVar_1', new RegExp(`^(?:${languageConfiguration.wordPattern})$`));
    assert.doesNotMatch('1abc', new RegExp(`^(?:${languageConfiguration.wordPattern})$`));

    const { start, end } = languageConfiguration.folding.markers;
    assert.doesNotThrow(() => new RegExp(start));
    assert.doesNotThrow(() => new RegExp(end));
    assert.ok(new RegExp(start).test('// region test'));
    assert.ok(new RegExp(end).test('// endregion'));

    const rules = languageConfiguration.indentationRules;
    assert.doesNotThrow(() => new RegExp(rules.increaseIndentPattern));
    assert.doesNotThrow(() => new RegExp(rules.decreaseIndentPattern));
    assert.ok(new RegExp(rules.increaseIndentPattern).test('fn main() {'));
    assert.ok(new RegExp(rules.decreaseIndentPattern).test('    }'));
});
