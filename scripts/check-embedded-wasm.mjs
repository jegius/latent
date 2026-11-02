#!/usr/bin/env node
// check-embedded-wasm.mjs — сверяет артефакты, встроенные в плагин IntelliJ IDEA,
// с их каноническими источниками в репозитории.
//
// Зачем: плагин IDEA носит с собой снимок компилятора (`compiler.wasm`) и копию
// данных о языке (`language.json`). Это нужно для работы офлайн/без `latentc`,
// но копии со временем расходятся с `web-ide/compiler.wasm` и
// `tooling/language-data/language.json` — тогда плагин компилирует старым
// движком или подсказывает устаревшие builtins. Проверка ловит это в CI.
//
// Проверяется:
//   1. editors/idea/src/main/resources/runner/compiler.wasm
//        == web-ide/compiler.wasm (sha256 + размер);
//   2. editors/idea/src/main/resources/language/latent-language.json
//        == tooling/language-data/language.json (sha256).
//
// Использование:
//   node scripts/check-embedded-wasm.mjs            # проверка (exit 1 при расхождении)
//   node scripts/check-embedded-wasm.mjs --update   # обновить копии из источников
//   node scripts/check-embedded-wasm.mjs --quiet    # только итог/ошибки
//
// Зависимостей нет: только stdlib Node (fs/crypto/path).

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const argv = new Set(process.argv.slice(2));
const UPDATE = argv.has('--update');
const QUIET = argv.has('--quiet');
const log = (...args) => { if (!QUIET) console.log(...args); };
const rel = (path) => relative(ROOT, path).split(sep).join('/');

/** Пары «канонический файл → встроенная копия» с подсказкой, что это. */
const PAIRS = [
    {
        what: 'WASM-компилятор (fallback плагина)',
        source: join(ROOT, 'web-ide', 'compiler.wasm'),
        embedded: join(ROOT, 'editors', 'idea', 'src', 'main', 'resources', 'runner', 'compiler.wasm'),
    },
    {
        what: 'данные о языке (подсветка/completion)',
        source: join(ROOT, 'tooling', 'language-data', 'language.json'),
        embedded: join(ROOT, 'editors', 'idea', 'src', 'main', 'resources', 'language', 'latent-language.json'),
    },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Читает файл или возвращает null, если его нет. */
function readIfExists(path) {
    return existsSync(path) ? readFileSync(path) : null;
}

function main() {
    let failed = 0;
    for (const pair of PAIRS) {
        const source = readIfExists(pair.source);
        if (!source) {
            console.error(`FAIL ${rel(pair.source)}: канонический файл не найден (${pair.what})`);
            failed += 1;
            continue;
        }
        if (UPDATE) {
            copyFileSync(pair.source, pair.embedded);
            log(`обновлено ${rel(pair.embedded)} ← ${rel(pair.source)} (${source.length} байт)`);
            continue;
        }

        const embedded = readIfExists(pair.embedded);
        if (!embedded) {
            console.error(
                `FAIL ${rel(pair.embedded)}: встроенная копия отсутствует (${pair.what}); ` +
                'обновите: node scripts/check-embedded-wasm.mjs --update');
            failed += 1;
            continue;
        }
        const want = sha256(source);
        const got = sha256(embedded);
        if (want !== got) {
            console.error(
                `FAIL ${rel(pair.embedded)}: ${pair.what} расходится с ${rel(pair.source)}\n` +
                `  sha256 эталона: ${want} (${source.length} байт)\n` +
                `  sha256 копии:   ${got} (${embedded.length} байт)\n` +
                '  обновите копию: node scripts/check-embedded-wasm.mjs --update');
            failed += 1;
            continue;
        }
        log(`OK ${rel(pair.embedded)} = ${rel(pair.source)} (sha256 ${want.slice(0, 12)}…, ${embedded.length} байт)`);
    }

    if (UPDATE) {
        log(`Встроенные артефакты обновлены: ${PAIRS.length} файл(а).`);
        return 0;
    }
    if (failed > 0) {
        console.error(`\nВстроенные артефакты IDEA: расхождений ${failed}. ` +
            'Скопируйте файлы из web-ide/ и tooling/language-data/ или выполните --update.');
        return 1;
    }
    log('Встроенные артефакты IDEA совпадают с каноническими источниками.');
    return 0;
}

process.exit(main());
