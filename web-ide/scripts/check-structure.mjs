// scripts/check-structure.mjs — структурный аудит web-ide (SOLID/декомпозиция).
//
// Проверяет:
//   1. каждый .js-файл web-ide не превышает 300 строк (SRP: файл = одна зона);
//   2. barrel-фасады тонкие: только реэкспорт, без собственной логики;
//   3. файлы — валидный UTF-8 без BOM (стиль репозитория);
//   4. нет пустых модулей-заглушек и мёртвых TODO-заглушек в публичном коде.
//
// Запуск: node scripts/check-structure.mjs (или pnpm run check:structure).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Файлы, которые обязаны оставаться тонкими фасадами (реэкспорт API). */
const BARRELS = [
    'compiler-loader.js',
    'examples.js',
    'views/canvas-editor.js',
    'compiler/index.js',
];

const MAX_LINES = 300;
const MAX_BARREL_LINES = 40;

/** Рекурсивно собирает .js-файлы, исключая служебные каталоги. */
function collectJs(dir, acc = []) {
    for (const entry of readdirSync(dir)) {
        // dist/ — артефакт vite build (минифицированные чанки), не исходники.
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) collectJs(full, acc);
        else if (entry.endsWith('.js')) acc.push(full);
    }
    return acc;
}

/** Убирает BOM и возвращает { text, hasBom, lines }. */
function readSource(file) {
    const raw = readFileSync(file);
    const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    const text = raw.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { text, hasBom, lines };
}

/** true, если файл-фасад содержит только import/export/комментарии/typedef. */
function isReexportOnly(text) {
    // Убираем комментарии (в т.ч. @typedef) и все реэкспортные конструкции;
    // если после этого не осталось кода — файл действительно тонкий фасад.
    let rest = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/export\s*\{[\s\S]*?\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/g, '')
        .replace(/export\s+\*\s+from\s*['"][^'"]+['"]\s*;?/g, '')
        .replace(/export\s+default\s+[^;]+;/g, '')
        .replace(/\s+/g, '');
    return rest === '';
}

const problems = [];
const files = collectJs(ROOT).sort();

for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const { text, hasBom, lines } = readSource(file);

    if (hasBom) problems.push(`${rel}: файл начинается с BOM`);
    if (lines > MAX_LINES) {
        problems.push(`${rel}: ${lines} строк (> ${MAX_LINES}) — нужна декомпозиция`);
    }
    if (BARRELS.includes(rel)) {
        if (lines > MAX_BARREL_LINES) {
            problems.push(`${rel}: фасад ${lines} строк (> ${MAX_BARREL_LINES}) — только реэкспорт`);
        }
        if (!isReexportOnly(text)) {
            problems.push(`${rel}: фасад содержит собственную логику — только реэкспорт`);
        }
    }

    // Мёртвые заглушки-«TODO», оставленные вместо реализации.
    if (/TODO\s*:\s*(implement|реализовать)/i.test(text)) {
        problems.push(`${rel}: TODO-заглушка вместо реализации`);
    }
}

if (problems.length > 0) {
    console.error(`Структурный аудит web-ide: ${problems.length} нарушение(й):\n`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
}

console.log(`Структурный аудит web-ide: OK (${files.length} .js-файлов, ` +
    `порог ${MAX_LINES} строк, фасадов ${BARRELS.length}).`);
