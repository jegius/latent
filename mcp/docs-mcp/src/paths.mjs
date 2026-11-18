// paths.mjs — расположение файлов репозитория и пути по умолчанию.
//
// Единственная ответственность модуля: вычислить корень репозитория от
// расположения самого файла сервера (а не от текущего каталога процесса) и
// разрешить пути к документации, компилятору и примерам с учётом флагов CLI
// и переменных окружения.
//
// Правило: `--docs`/`LATENT_DOCS_PATH` переопределяют каталог документации,
// `--wasm`/`LATENT_COMPILER_WASM` — путь к compiler.wasm. Всё остальное
// (примеры, исходники) всегда берётся из корня репозитория.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Каталог `mcp/docs-mcp/src`. */
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Каталог пакета `mcp/docs-mcp`. */
export const PACKAGE_DIR = path.resolve(SRC_DIR, '..');

/** Корень репозитория Latent (на два уровня выше пакета). */
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');

/**
 * Возвращает корень репозитория: явный аргумент, иначе значение по умолчанию,
 * вычисленное от файла сервера.
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveRepoRoot(explicit) {
    return explicit ? path.resolve(explicit) : REPO_ROOT;
}

/**
 * Каталог с Markdown-документацией по умолчанию: `<repo>/docs/docs`.
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function defaultDocsRoot(repoRoot = REPO_ROOT) {
    return path.join(repoRoot, 'docs', 'docs');
}

/**
 * Разрешает каталог документации с приоритетом: флаг CLI → переменная
 * окружения → значение по умолчанию. Относительный путь считается от cwd.
 * @param {{docs?: string, repoRoot?: string}} [options]
 * @returns {string} абсолютный путь
 */
export function resolveDocsRoot(options = {}) {
    const { docs, repoRoot } = options;
    const envPath = process.env.LATENT_DOCS_PATH;
    return path.resolve(docs || envPath || defaultDocsRoot(repoRoot || REPO_ROOT));
}

/**
 * Разрешает путь к compiler.wasm.
 * @param {{wasm?: string, repoRoot?: string}} [options]
 * @returns {string} абсолютный путь
 */
export function resolveWasmPath(options = {}) {
    const { wasm, repoRoot } = options;
    const envPath = process.env.LATENT_COMPILER_WASM;
    return path.resolve(
        wasm || envPath || path.join(repoRoot || REPO_ROOT, 'web-ide', 'compiler.wasm'),
    );
}

/**
 * Каталог с примерами языка в web IDE — источник для инструмента `get_example`.
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function resolveExamplesDir(repoRoot = REPO_ROOT) {
    return path.join(repoRoot, 'web-ide', 'examples');
}

/**
 * Существует ли файл (или каталог) по указанному пути.
 * @param {string} target
 * @returns {boolean}
 */
export function exists(target) {
    try {
        return fs.statSync(target) !== undefined;
    } catch {
        return false;
    }
}

/**
 * Существует ли именно файл.
 * @param {string} target
 * @returns {boolean}
 */
export function isFile(target) {
    try {
        return fs.statSync(target).isFile();
    } catch {
        return false;
    }
}
