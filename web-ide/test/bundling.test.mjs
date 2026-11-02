// test/bundling.test.mjs — статическая проверка production-сборки и ленивости.
//
// Тест намеренно НЕ запускает Vite (нет зависимости от node_modules): он
// проверяет конфигурацию, package.json и граф статических import'ов исходников.
// Запуск: node --test "test/*.test.mjs" (или pnpm test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Читает файл относительно web-ide/. */
function read(rel) {
    return readFileSync(join(ROOT, rel), 'utf8');
}

/** true, если файл существует. */
function has(rel) {
    return existsSync(join(ROOT, rel));
}

/**
 * Статические import/export ... from (dynamic import() сюда не попадает:
 * после `import` обязателен пробел, а не `(`).
 */
const STATIC_IMPORT_RE =
    /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

/** Резолвит относительный specifier в абсолютный путь (с .js по умолчанию). */
function resolveSpecifier(fromAbs, spec) {
    const base = resolve(dirname(fromAbs), spec);
    if (existsSync(base) && !base.endsWith('/')) {
        try {
            // Каталог тоже существует — для наших импортов это неважно.
            return base;
        } catch (e) {
            /* ignore */
        }
    }
    return base;
}

/** Собирает граф статических зависимостей от entry (relative path). */
function staticGraph(entryRel) {
    const seen = new Set();
    const queue = [resolve(ROOT, entryRel)];
    while (queue.length > 0) {
        const abs = queue.pop();
        const rel = relative(ROOT, abs).replace(/\\/g, '/');
        if (seen.has(rel)) continue;
        seen.add(rel);
        if (!existsSync(abs) || !abs.endsWith('.js')) continue;
        const code = readFileSync(abs, 'utf8');
        for (const match of code.matchAll(STATIC_IMPORT_RE)) {
            const spec = match[1];
            if (!spec.startsWith('.')) continue; // node: и пакеты не раскрываем
            queue.push(resolveSpecifier(abs, spec));
        }
    }
    return seen;
}

// ---------------------------------------------------------------- vite config

test('bundling: vite.config.js существует и экспортирует конфиг', () => {
    assert.ok(has('vite.config.js'), 'vite.config.js отсутствует');
    const code = read('vite.config.js');
    assert.match(code, /export\s+default\s+defineConfig\s*\(/, 'нет export default defineConfig(...)');
    assert.match(code, /base:\s*['"]\.\/['"]/, "base должен быть './' для работы из подкаталога");
    assert.match(code, /outDir:\s*['"]dist['"]/, "outDir должен быть 'dist'");
    assert.match(code, /manualChunks/, 'нет manualChunks');
});

test('bundling: manualChunks выделяет engine2/ai/editor/examples/core', () => {
    const code = read('vite.config.js');
    for (const chunk of ['engine2', 'ai', 'editor', 'examples', 'core']) {
        assert.match(code, new RegExp(`return\\s+['"]${chunk}['"]`),
            `manualChunks не выделяет чанк ${chunk}`);
    }
    // Ядро не должно попадать в engine2/ai.
    assert.match(code, /\/compiler\/wasm-loader\.js/, 'engine2 не привязан к wasm-loader');
    assert.match(code, /\/compiler\/ai-/, 'ai не привязан к compiler/ai-*.js');
    assert.match(code, /\/views\/editor\//, 'editor не привязан к views/editor/**');
});

test('bundling: package.json содержит build:chunks и vite в devDependencies', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['build:chunks'], 'vite build');
    assert.equal(typeof pkg.scripts.preview, 'string');
    assert.ok(pkg.scripts.preview.includes('vite'), 'preview должен запускать vite');
    assert.ok(pkg.devDependencies && pkg.devDependencies.vite,
        'vite должен быть в devDependencies');
    assert.match(pkg.devDependencies.vite, /^\^?[56]\./,
        'ожидается Vite 5 или 6');
    assert.ok(pkg.scripts.test.includes('.mjs'),
        'node --test должен подхватывать test/*.test.mjs');
});

// ------------------------------------------------------------- dynamic imports

test('bundling: движок №2 подключается dynamic import()', () => {
    const loader = read('compiler/loader.js');
    assert.match(loader, /import\(\s*['"]\.\/wasm-loader\.js['"]\s*\)/,
        'compiler/loader.js должен динамически импортировать wasm-loader');
    assert.doesNotMatch(loader, /from\s+['"]\.\/wasm-loader\.js['"]/,
        'wasm-loader не должен импортироваться статически');
});

test('bundling: AI-провайдеры и repair подключаются dynamic import()', () => {
    const lazy = read('compiler/lazy-ai.js');
    assert.match(lazy, /import\(\s*['"]\.\/ai-gateway\.js['"]\s*\)/);
    assert.match(lazy, /import\(\s*['"]\.\/repair\.js['"]\s*\)/);
    // run.js не должен статически тянуть сетевой слой.
    const run = read('compiler/run.js');
    assert.doesNotMatch(run, /from\s+['"]\.\/ai-gateway\.js['"]/);
    assert.doesNotMatch(run, /from\s+['"]\.\/repair\.js['"]/);
    assert.match(run, /loadAIGateway/, 'run.js должен использовать ленивый мост');
});

test('bundling: манифест примеров и .lat подключаются лениво', () => {
    const loader = read('examples/loader.js');
    assert.match(loader, /import\(\s*['"]\.\/manifest\.js['"]\s*\)/,
        'examples/loader.js должен динамически импортировать манифест');
    assert.doesNotMatch(loader, /from\s+['"]\.\/manifest\.js['"]/,
        'манифест не должен импортироваться статически в загрузчике');
    assert.match(loader, /import\.meta\.glob/, 'для сборки нужен import.meta.glob(?raw)');
    // main.js стартует с каталога + одного примера, а не со всех .lat.
    const main = read('main.js');
    assert.match(main, /loadExampleCatalog/);
    assert.match(main, /loadExampleById/);
    assert.doesNotMatch(main, /loadExamples\s*\(/,
        'main.js не должен грузить все примеры на старте');
});

// ----------------------------------------------------- статический граф модулей

test('bundling: compiler/loader.js не тянет wasm-loader по статическому графу', () => {
    const graph = staticGraph('compiler/loader.js');
    assert.ok(graph.has('compiler/parser.js'), 'граф должен включать парсер');
    assert.ok(!graph.has('compiler/wasm-loader.js'),
        'wasm-loader попал в статический граф compiler/loader.js');
});

test('bundling: стартовый граф не содержит AI Gateway и repair', () => {
    const graph = staticGraph('compiler-loader.js');
    assert.ok(graph.has('compiler/lazy-ai.js'), 'ленивый мост должен быть в графе');
    assert.ok(!graph.has('compiler/ai-gateway.js'),
        'ai-gateway попал в стартовый граф');
    assert.ok(!graph.has('compiler/repair.js'),
        'repair попал в стартовый граф');
});

test('bundling: wasm подключён как ассет через new URL(..., import.meta.url)', () => {
    const loader = read('compiler/wasm-loader.js');
    assert.match(loader, /new\s+URL\(\s*['"][^'"]*compiler\.wasm['"]\s*,\s*import\.meta\.url\s*\)/,
        'wasm должен резолвиться как ассет относительно модуля');
});
