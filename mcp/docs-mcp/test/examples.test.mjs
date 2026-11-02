// examples.test.mjs — каталог примеров: метаданные manifest.js, docs/examples,
// дедупликация, порядок и поиск по id/файлу/заголовку.
//
// Каждый тест создаёт изолированное дерево каталогов во временном каталоге,
// чтобы проверить контракт провайдера без зависимости от содержимого репозитория.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createExamplesProvider } from '../src/examples.mjs';

/**
 * Создаёт временное дерево файлов.
 * @param {Record<string, string>} tree
 * @returns {string} корень дерева
 */
function makeTree(tree) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-examples-'));
    for (const [relative, content] of Object.entries(tree)) {
        const absolute = path.join(root, ...relative.split('/'));
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content, 'utf8');
    }
    return root;
}

/**
 * Создаёт провайдер на временном дереве.
 * @param {Record<string, string>} tree
 * @returns {{provider: object, repoRoot: string, docsRoot: string}}
 */
function makeProvider(tree) {
    const repoRoot = makeTree(tree);
    const docsRoot = path.join(repoRoot, 'docs', 'docs');
    return { provider: createExamplesProvider({ repoRoot, docsRoot }), repoRoot, docsRoot };
}

test('без каталогов web-ide/examples и docs/examples провайдер отдаёт пустой список', async () => {
    const { provider, repoRoot } = makeProvider({ 'docs/docs/index.md': '# Документация' });
    try {
        assert.deepEqual(await provider.load(), []);
        assert.deepEqual(await provider.list(), []);
        assert.equal(await provider.get('anything'), null);
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('без manifest.js id и заголовок выводятся из имени .lat-файла', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/parallel_sum.lat': 'fn main() -> int { return 1; }',
        'web-ide/examples/hello.lat': 'fn main() -> int { return 0; }',
        'web-ide/examples/README.md': 'не пример',
    });
    try {
        const examples = await provider.list();
        assert.equal(examples.length, 2);
        assert.deepEqual(examples.map((item) => item.id), ['hello', 'parallel-sum']);
        assert.deepEqual(examples.map((item) => item.title), ['Hello', 'Parallel sum']);
        for (const item of examples) {
            assert.equal(item.group, 'Examples');
            assert.equal(item.source, 'web-ide/examples');
            assert.equal(item.description, '');
            assert.equal(item.order, Number.MAX_SAFE_INTEGER);
        }
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('manifest.js задаёт метаданные, порядок и допускает записи без id', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/manifest.js': `export const EXAMPLE_META = [
            { id: 'second', file: 'b.lat', title: 'Второй', description: 'описание', group: 'Основы' },
            { file: 'a.lat', title: 'Первый' },
            null,
            { id: 'no-file', title: 'Без файла' },
            { id: 'ghost', file: 'ghost.lat' },
        ];`,
        'web-ide/examples/a.lat': 'fn main() -> int { return 1; }',
        'web-ide/examples/b.lat': 'fn main() -> int { return 2; }',
        'web-ide/examples/c.lat': 'fn main() -> int { return 3; }',
    });
    try {
        const examples = await provider.list();
        assert.deepEqual(examples.map((item) => item.id), ['second', 'a', 'c']);
        const second = examples.find((item) => item.id === 'second');
        assert.equal(second.title, 'Второй');
        assert.equal(second.group, 'Основы');
        const a = examples.find((item) => item.id === 'a');
        assert.equal(a.title, 'Первый');
        assert.equal(a.description, '');
        assert.equal(a.group, 'Examples');
        assert.equal(a.order, 1);
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('manifest.js без EXAMPLE_META и со сломанным синтаксисом не ломает каталог', async () => {
    for (const manifest of [
        'export const SOMETHING_ELSE = [];',
        'export const EXAMPLE_META = "не массив";',
        'export const EXAMPLE_META = [;',
    ]) {
        const { provider, repoRoot } = makeProvider({
            'web-ide/examples/manifest.js': manifest,
            'web-ide/examples/only.lat': 'fn main() -> int { return 0; }',
        });
        try {
            const examples = await provider.list();
            assert.equal(examples.length, 1);
            assert.equal(examples[0].id, 'only');
            assert.equal(examples[0].title, 'Only');
        } finally {
            fs.rmSync(repoRoot, { recursive: true, force: true });
        }
    }
});

test('нечитаемый .lat-файл пропускается, остальные примеры остаются', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/good.lat': 'fn main() -> int { return 0; }',
        'web-ide/examples/bad.lat': 'fn main() -> int { return 1; }',
    });
    const original = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
        if (String(file).endsWith('bad.lat')) throw new Error('EACCES');
        return original.call(this, file, ...rest);
    };
    try {
        const examples = await provider.list();
        assert.deepEqual(examples.map((item) => item.id), ['good']);
    } finally {
        fs.readFileSync = original;
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('docs/examples: первый блок ```latent становится кодом примера', async () => {
    const { provider, repoRoot } = makeProvider({
        'docs/docs/examples/sum-numbers.md': [
            '---',
            'title: Сумма чисел',
            '---',
            '',
            '# Сумма',
            '',
            '```latent',
            'fn main() -> int {',
            '    return 3;',
            '}',
            '```',
        ].join('\n'),
        'docs/docs/examples/lambda.md': '# Лямбда\n\n```lat\nfn main() {}\n```\n',
        'docs/docs/examples/no-code.md': '# Без кода\n\n```text\nничего\n```\n',
        'docs/docs/examples/notes.txt': 'не markdown',
    });
    try {
        const examples = await provider.list();
        assert.deepEqual(examples.map((item) => item.id), ['lambda', 'sum-numbers']);
        const sum = examples.find((item) => item.id === 'sum-numbers');
        assert.equal(sum.title, 'Сумма чисел');
        assert.equal(sum.group, 'docs/examples');
        assert.equal(sum.source, 'docs/examples/sum-numbers.md');
        assert.match(sum.code, /return 3;/);
        assert.equal(sum.description, '');
        const lambda = examples.find((item) => item.id === 'lambda');
        assert.equal(lambda.title, 'Лямбда');
        assert.equal(lambda.code, 'fn main() {}');
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('docs/examples: заголовок из H2 и запасной вариант из имени файла', async () => {
    const { provider, repoRoot } = makeProvider({
        'docs/docs/examples/with-h2.md': '## Заголовок H2\n\n```latent\nfn main() {}\n```\n',
        'docs/docs/examples/plain_name.md': '```latent\nfn main() {}\n```\n',
    });
    try {
        const examples = await provider.list();
        assert.equal(examples.find((item) => item.id === 'with-h2').title, 'Заголовок H2');
        assert.equal(examples.find((item) => item.id === 'plain-name').title, 'Plain name');
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('docs/examples: нечитаемый Markdown пропускается', async () => {
    const { provider, repoRoot } = makeProvider({
        'docs/docs/examples/ok.md': '# Ок\n\n```latent\nfn main() {}\n```\n',
        'docs/docs/examples/broken.md': '# Сломанный\n\n```latent\nfn main() {}\n```\n',
    });
    const original = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
        if (String(file).endsWith('broken.md')) throw new Error('EACCES');
        return original.call(this, file, ...rest);
    };
    try {
        assert.deepEqual((await provider.list()).map((item) => item.id), ['ok']);
    } finally {
        fs.readFileSync = original;
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('примеры из docs/examples дедуплицируются по id с web-ide', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/hello.lat': 'fn main() -> int { return 1; }',
        'docs/docs/examples/hello.md': '# Из docs\n\n```latent\nfn main() -> int { return 2; }\n```\n',
        'docs/docs/examples/extra.md': '# Extra\n\n```latent\nfn main() -> int { return 3; }\n```\n',
    });
    try {
        const examples = await provider.list();
        assert.deepEqual(examples.map((item) => item.id), ['hello', 'extra']);
        assert.equal(examples[0].source, 'web-ide/examples');
        assert.equal(examples[1].source, 'docs/examples/extra.md');
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('get ищет пример по id, имени файла и заголовку без учёта регистра', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/manifest.js': `export const EXAMPLE_META = [
            { id: 'parallel-sum', file: 'parallel_sum.lat', title: 'Параллельная сумма' },
        ];`,
        'web-ide/examples/parallel_sum.lat': 'fn main() -> int { return 42; }',
    });
    try {
        assert.equal((await provider.get('parallel-sum')).id, 'parallel-sum');
        assert.equal((await provider.get('PARALLEL-SUM.lat')).id, 'parallel-sum');
        assert.equal((await provider.get('parallel_sum.lat')).id, 'parallel-sum');
        assert.equal((await provider.get('Параллельная сумма')).id, 'parallel-sum');
        assert.equal((await provider.get('параллельная')).id, 'parallel-sum');
        assert.equal(await provider.get(''), null);
        assert.equal(await provider.get('   '), null);
        assert.equal(await provider.get(undefined), null);
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('кэш провайдера: повторный load не перечитывает каталог', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/one.lat': 'fn main() {}',
    });
    try {
        const first = await provider.list();
        fs.writeFileSync(path.join(repoRoot, 'web-ide', 'examples', 'two.lat'), 'fn main() {}', 'utf8');
        const second = await provider.list();
        assert.equal(first, second, 'list() должен возвращать тот же промис-результат');
        assert.equal(second.length, 1);
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('сбой проверки manifest.js не роняет провайдер: каталог становится пустым', async () => {
    const { provider, repoRoot } = makeProvider({
        'web-ide/examples/one.lat': 'fn main() {}',
    });
    const original = fs.existsSync;
    fs.existsSync = function patched(target) {
        if (String(target).endsWith('manifest.js')) throw new Error('EACCES');
        return original.call(this, target);
    };
    try {
        assert.deepEqual(await provider.list(), []);
    } finally {
        fs.existsSync = original;
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});
