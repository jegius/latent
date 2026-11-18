import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const snippets = JSON.parse(fs.readFileSync(path.join(root, 'snippets', 'latent.json'), 'utf8'));
const entries = Object.entries(snippets);

function prefixOf(snippet) {
    return Array.isArray(snippet.prefix) ? snippet.prefix[0] : snippet.prefix;
}

function allText() {
    return entries
        .map(([name, snippet]) => `${name}\n${prefixOf(snippet)}\n${snippet.body.join('\n')}`)
        .join('\n');
}

test('сниппеты: JSON-объект и достаточное количество', () => {
    assert.equal(typeof snippets, 'object');
    assert.ok(!Array.isArray(snippets));
    assert.ok(entries.length >= 24, `сниппетов слишком мало: ${entries.length}`);
});

test('сниппеты: корректная структура каждого', () => {
    const prefixes = new Set();
    for (const [name, snippet] of entries) {
        assert.ok(name && name.trim().length > 0, 'пустое имя сниппета');
        const prefix = prefixOf(snippet);
        assert.equal(typeof prefix, 'string');
        assert.ok(prefix.length > 0, `${name}: пустой prefix`);
        assert.ok(!prefixes.has(prefix), `${name}: дублирующийся prefix ${prefix}`);
        prefixes.add(prefix);
        assert.ok(Array.isArray(snippet.body) && snippet.body.length > 0, `${name}: пустой body`);
        for (const line of snippet.body) {
            assert.equal(typeof line, 'string', `${name}: body должен быть массивом строк`);
        }
        assert.equal(typeof snippet.description, 'string', `${name}: нет description`);
        assert.match(snippet.description, /[А-Яа-яЁё]/, `${name}: описание должно быть на русском`);
    }
});

test('сниппеты: покрывают все конструкции языка', () => {
    const text = allText();
    const required = [
        ['fn', /fn \$\{1:name\}\(/],
        ['async fn', /async fn \$\{1:name\}/],
        ['let с типом', /let \$\{1:name\}: \$\{2:int\}/],
        ['if', /if \(\$\{1:condition\}\)/],
        ['if/else', /if \(\$\{1:condition\}\) \{\s*\n\s*\$\{2\}\s*\n\} else \{/],
        ['while', /while \(\$\{1:condition\}\)/],
        ['for-in', /for \(let \$\{1:item\} in \$\{2:items\}\)/],
        ['for C-стиль', /for \(let \$\{1:i\} = 0; \$\{1:i\} < \$\{2:n\}; \$\{1:i\} = \$\{1:i\} \+ 1\)/],
        ['class', /class \$\{1:Name\} \{[\s\S]*fn init\(/],
        ['enum', /enum \$\{1:Name\} \{/],
        ['match', /match \$\{1:value\} \{[\s\S]*case /],
        ['лямбда =>', /fn\(\$\{1:x\}\) => /],
        ['лямбда с блоком', /fn\(\$\{1:x\}\) \{\s*\n/],
        ['spawn', /spawn \{/],
        ['channel', /channel\(\)/],
        ['select', /select \{[\s\S]*case \$\{1:v\} <- /],
        ['test', /test "\$\{1:name\}" \{/],
        ['@test', /@test\("/],
        ['assert', /assert\(\$\{1:condition\}\)/],
        ['assert_eq', /assert_eq\(\$\{1:actual\}, \$\{2:expected\}\)/],
        ['ai_infer', /ai_infer\("/],
        ['ai_embed', /ai_embed\("/],
        ['tensor', /tensor\(\[/],
        ['matmul', /matmul\(/],
        ['alloc', /alloc\(\$\{2:size\}\)/],
        ['memcopy', /memcopy\(\$\{1:dst\}, \$\{2:src\}, \$\{3:len\}\)/],
        ['декоратор', /@\$\{1:forall\}/],
    ];
    for (const [name, regex] of required) {
        assert.match(text, regex, `нет сниппета для: ${name}`);
    }
});

test('сниппеты: ключевые prefix доступны', () => {
    const prefixes = new Set(entries.map(([, snippet]) => prefixOf(snippet)));
    const expected = ['fn', 'async fn', 'let', 'letinfer', 'if', 'ifelse', 'while',
        'forin', 'forc', 'class', 'enum', 'match', 'lambda', 'lambdablock', 'spawn',
        'channel', 'select', 'test', '@test', 'assert', 'assert_eq', 'ai_infer',
        'ai_embed', 'tensor', 'matmul', 'alloc', 'memcopy', 'print', 'decorator', 'program'];
    for (const prefix of expected) {
        assert.ok(prefixes.has(prefix), `нет prefix ${prefix}`);
    }
});

test('сниппеты: тексты синтаксически соответствуют языку', () => {
    const text = allText();
    // В Latent нет ++/--, +=, =>=, тернарника и raw-строк.
    assert.doesNotMatch(text, /\+\+|--|=>=/);
    // Условия if/while/for всегда в круглых скобках в сниппетах.
    for (const [name, snippet] of entries) {
        const body = snippet.body.join('\n');
        if (/\b(if|while|for)\b/.test(body)) {
            assert.match(body, /\b(?:if|while|for) \(/, `${name}: условие должно быть в скобках`);
        }
        // Каждый многострочный сниппет должен иметь закрывающую скобку.
        if (body.includes('{')) {
            assert.ok(body.includes('}'), `${name}: незакрытая фигурная скобка`);
        }
    }
});
