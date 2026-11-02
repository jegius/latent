// paths.test.mjs — тесты вычисления путей: корень репозитория, --docs, env, wasm.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    PACKAGE_DIR,
    REPO_ROOT,
    defaultDocsRoot,
    resolveDocsRoot,
    resolveExamplesDir,
    resolveRepoRoot,
    resolveWasmPath,
} from '../src/paths.mjs';
import { buildDocsIndex } from '../src/docs-index.mjs';
import { createCore } from '../src/core.mjs';

test('корень репозитория вычисляется от файла сервера, а не от cwd', () => {
    assert.equal(PACKAGE_DIR, path.join(REPO_ROOT, 'mcp', 'docs-mcp'));
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'Cargo.toml')), true);

    const originalCwd = process.cwd();
    try {
        process.chdir(os.tmpdir());
        assert.equal(resolveRepoRoot(), REPO_ROOT);
        assert.equal(resolveDocsRoot(), defaultDocsRoot(REPO_ROOT));
    } finally {
        process.chdir(originalCwd);
    }
});

test('по умолчанию документация берётся из <repo>/docs/docs', () => {
    assert.equal(defaultDocsRoot(REPO_ROOT), path.join(REPO_ROOT, 'docs', 'docs'));
    assert.equal(resolveDocsRoot({ repoRoot: REPO_ROOT }), path.join(REPO_ROOT, 'docs', 'docs'));
});

test('флаг --docs переопределяет каталог документации', () => {
    const override = path.join(os.tmpdir(), 'my-docs');
    assert.equal(resolveDocsRoot({ docs: override, repoRoot: REPO_ROOT }), path.resolve(override));
});

test('переменная LATENT_DOCS_PATH переопределяет каталог документации', () => {
    const override = path.join(os.tmpdir(), 'env-docs');
    const previous = process.env.LATENT_DOCS_PATH;
    process.env.LATENT_DOCS_PATH = override;
    try {
        assert.equal(resolveDocsRoot({ repoRoot: REPO_ROOT }), path.resolve(override));
        // Явный флаг важнее переменной окружения.
        const explicit = path.join(os.tmpdir(), 'explicit-docs');
        assert.equal(resolveDocsRoot({ docs: explicit, repoRoot: REPO_ROOT }), path.resolve(explicit));
    } finally {
        if (previous === undefined) delete process.env.LATENT_DOCS_PATH;
        else process.env.LATENT_DOCS_PATH = previous;
    }
});

test('путь к compiler.wasm: по умолчанию, --wasm и LATENT_COMPILER_WASM', () => {
    const defaultWasm = path.join(REPO_ROOT, 'web-ide', 'compiler.wasm');
    assert.equal(resolveWasmPath({ repoRoot: REPO_ROOT }), defaultWasm);
    assert.equal(resolveWasmPath({ wasm: 'C:/custom/compiler.wasm', repoRoot: REPO_ROOT }), path.resolve('C:/custom/compiler.wasm'));

    const previous = process.env.LATENT_COMPILER_WASM;
    process.env.LATENT_COMPILER_WASM = 'C:/env/compiler.wasm';
    try {
        assert.equal(resolveWasmPath({ repoRoot: REPO_ROOT }), path.resolve('C:/env/compiler.wasm'));
    } finally {
        if (previous === undefined) delete process.env.LATENT_COMPILER_WASM;
        else process.env.LATENT_COMPILER_WASM = previous;
    }
});

test('каталог примеров указывает на web-ide/examples', () => {
    const examples = resolveExamplesDir(REPO_ROOT);
    assert.equal(examples, path.join(REPO_ROOT, 'web-ide', 'examples'));
    assert.equal(fs.existsSync(examples), true);
});

test('реальная документация репозитория индексируется (если уже написана)', () => {
    const index = buildDocsIndex({ docsRoot: defaultDocsRoot(REPO_ROOT) });
    if (index.docs.length === 0) {
        // Документация ещё не написана — контракт «пустой индекс не падает» покрыт frontier-тестом.
        assert.equal(index.exists, true);
        return;
    }
    assert.equal(index.exists, true);
    for (const doc of index.docs) {
        assert.match(doc.path, /\.mdx?$/);
        assert.ok(doc.title.length > 0);
    }
    // Все страницы должны быть доступны как ресурсы.
    const core = createCore({
        docsRoot: defaultDocsRoot(REPO_ROOT),
        repoRoot: REPO_ROOT,
        wasmPath: resolveWasmPath({ repoRoot: REPO_ROOT }),
        hooks: {},
    });
    return core.handlePayload({ jsonrpc: '2.0', id: 1, method: 'resources/list' }).then((response) => {
        assert.equal(response.result.resources.length, index.docs.length + 1);
    });
});
