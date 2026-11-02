// compiler/modules.js — резолвер файловых модулей Latent (движок №1).
// Единственная ответственность: канонизация путей, разбор import-объявлений,
// обход графа от entry (DFS), понятные ошибки и кэш разобранных модулей.
//
// Модуль не знает о DOM и не зависит от других частей IDE. Циклы импорта
// разрешены (линковка двухфазная) — резолвер лишь фиксирует их для диагностики.

import { tokenize } from './lexer.js';
import { Parser } from './parser.js';

/** Обязательное расширение файла-модуля (v1). */
export const MODULE_EXTENSION = '.lat';

/** Ошибка модульной системы: путь/строка + машиночитаемый код. */
export class ModuleError extends Error {
    /**
     * @param {string} message
     * @param {{path?: string|null, line?: number|null, code?: string}} [info]
     */
    constructor(message, info = {}) {
        const path = info.path || null;
        const line = info.line || null;
        const where = path ? (line ? `${path}:${line}` : path) : null;
        super(where ? `${where}: ${message}` : message);
        this.name = 'ModuleError';
        this.code = info.code || 'MODULE_ERROR';
        this.path = path;
        this.line = line;
    }
}

/**
 * Канонизирует путь модуля: `./a/../b.lat` → `b.lat` (forward slashes,
 * без `.`/`..`, без абсолютных путей и без выхода за корень проекта).
 * @param {string} input
 * @returns {string}
 */
export function normalizeModulePath(input) {
    let path = String(input ?? '').trim().replace(/\\/g, '/');
    if (!path) {
        throw new ModuleError('empty module path', { code: 'MODULE_PATH_EMPTY' });
    }
    if (/^[a-zA-Z]:/.test(path) || path.startsWith('/') || path.startsWith('~')
        || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) {
        throw new ModuleError(
            `module path must be relative, got '${path}'`, { code: 'MODULE_PATH_ABSOLUTE' });
    }
    if (!path.endsWith(MODULE_EXTENSION)) {
        throw new ModuleError(
            `module path must end with '${MODULE_EXTENSION}': '${path}'`,
            { code: 'MODULE_PATH_EXTENSION' });
    }
    const parts = [];
    for (const segment of path.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            if (parts.length === 0) {
                throw new ModuleError(
                    `module path '${path}' escapes the project root`,
                    { code: 'MODULE_PATH_OUTSIDE' });
            }
            parts.pop();
            continue;
        }
        if (segment.includes(':')) {
            throw new ModuleError(
                `invalid module path segment '${segment}'`, { code: 'MODULE_PATH_INVALID' });
        }
        parts.push(segment);
    }
    if (parts.length === 0) {
        throw new ModuleError(`invalid module path '${path}'`, { code: 'MODULE_PATH_INVALID' });
    }
    return parts.join('/');
}

/** Разрешает import-путь относительно файла-импортёра. */
export function resolveImportPath(importerPath, importSource) {
    const source = String(importSource ?? '').trim().replace(/\\/g, '/');
    if (!source.startsWith('./') && !source.startsWith('../')) {
        throw new ModuleError(
            `import path must be relative ('./' or '../'), got '${source}'`,
            { code: 'MODULE_PATH_NOT_RELATIVE' });
    }
    const dir = importerPath.includes('/')
        ? importerPath.slice(0, importerPath.lastIndexOf('/'))
        : '';
    return normalizeModulePath(dir ? `${dir}/${source}` : source);
}

/** FNV-1a: короткий детерминированный хэш содержимого (кэш/манифест). */
export function hashString(text) {
    const value = String(text ?? '');
    let h = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** true, если в файле есть import/export (по токенам, без ложных строк/комментариев). */
export function sourceHasModuleSyntax(source) {
    try {
        return tokenize(String(source ?? '')).some(
            (tok) => tok.type === 'Keyword' && (tok.value === 'import' || tok.value === 'export'));
    } catch {
        return /\b(?:import|export)\b/.test(String(source ?? ''));
    }
}

/** Извлекает import-объявления из разобранной программы (только top-level). */
export function collectModuleImports(ast) {
    return (ast && ast.statements ? ast.statements : []).filter((s) => s.type === 'Import');
}

/** Таблица экспортов модуля: имя → { kind, node }. */
export function collectModuleExports(ast) {
    const exports = new Map();
    for (const stmt of ast && ast.statements ? ast.statements : []) {
        if (stmt.type !== 'Export') continue;
        const decl = stmt.declaration;
        if (!decl) continue;
        const kind = decl.type === 'Function' ? 'fn' : decl.type.toLowerCase();
        if (['fn', 'class', 'enum'].includes(kind)) {
            exports.set(decl.name, { kind, node: decl });
        }
    }
    return exports;
}

/**
 * Кэш разобранных модулей (кэш движка №1). Ключ — путь + хэш содержимого:
 * правка файла автоматически даёт новую запись, а повторные запуски и
 * резолв/линковка не парсят один и тот же файл дважды.
 */
export class ModuleCache {
    constructor(limit = 64) {
        this.limit = limit;
        this.entries = new Map();
    }

    /**
     * @param {string} path — канонический путь
     * @param {string} source
     * @returns {{path:string, source:string, ast:object, imports:object[],
     *     exports:Map<string,{kind:string,node:object}>}}
     */
    get(path, source) {
        const key = `${path}\u0000${hashString(source)}`;
        const cached = this.entries.get(key);
        if (cached) return cached;

        let ast;
        try {
            ast = new Parser(tokenize(source)).parseProgram();
        } catch (e) {
            const lineMatch = /line (\d+)/.exec(String(e && e.message));
            throw new ModuleError(String(e && e.message || e), {
                path,
                line: lineMatch ? Number(lineMatch[1]) : null,
                code: 'MODULE_PARSE_ERROR',
            });
        }
        const entry = {
            path,
            source,
            ast,
            imports: collectModuleImports(ast),
            exports: collectModuleExports(ast),
        };
        this.entries.set(key, entry);
        if (this.entries.size > this.limit) {
            this.entries.delete(this.entries.keys().next().value);
        }
        return entry;
    }

    clear() { this.entries.clear(); }
}

/** Общий кэш модулей (используется движком №1 и сервисом компиляции). */
export const sharedModuleCache = new ModuleCache();

/** Приводит входные файлы проекта к Map<канонический путь, исходник>. */
function canonicalSources(files) {
    if (!Array.isArray(files)) {
        throw new ModuleError('files must be an array of {name, code}', { code: 'PROJECT_INVALID' });
    }
    const sources = new Map();
    for (const file of files) {
        const rawPath = file && (file.name ?? file.path);
        const source = String((file && (file.code ?? file.source ?? file.text)) ?? '');
        const path = normalizeModulePath(rawPath);
        if (sources.has(path)) {
            throw new ModuleError(
                `duplicate module file '${path}' in workspace`, { code: 'DUPLICATE_MODULE' });
        }
        sources.set(path, source);
    }
    return sources;
}

/**
 * Строит граф модулей от entry: DFS, канонические пути, циклы, отсутствующие
 * файлы и дубликаты. Циклы разрешены и возвращаются в `cycles`.
 *
 * @param {Array<{name?:string, code?:string, path?:string, source?:string}>} files
 * @param {string} entryPath
 * @param {{cache?: ModuleCache}} [opts]
 * @returns {{entry:string, modules:object[], graph:Map<string,object[]>,
 *     cycles:string[][], sources:Map<string,string>}}
 */
export function resolveModuleGraph(files, entryPath, opts = {}) {
    const cache = opts.cache || sharedModuleCache;
    const sources = canonicalSources(files);
    const entry = normalizeModulePath(entryPath);
    if (!sources.has(entry)) {
        throw new ModuleError(
            `entry file '${entry}' not found in workspace`, { path: entry, code: 'ENTRY_NOT_FOUND' });
    }

    const getModule = (path) => cache.get(path, sources.get(path));
    const color = new Map(); // 1 — в стеке, 2 — обработан
    const stack = [];
    const order = [];
    const cycles = [];
    const graph = new Map();

    const visit = (path) => {
        const state = color.get(path);
        if (state === 2) return;
        if (state === 1) {
            const start = stack.indexOf(path);
            cycles.push([...stack.slice(start), path]);
            return;
        }
        color.set(path, 1);
        stack.push(path);
        const mod = getModule(path);
        const edges = [];
        graph.set(path, edges);
        for (const imp of mod.imports) {
            let resolved;
            try {
                resolved = resolveImportPath(path, imp.source);
            } catch (e) {
                throw new ModuleError(e.message, {
                    path, line: imp.line, code: e.code || 'MODULE_IMPORT_INVALID',
                });
            }
            if (!sources.has(resolved)) {
                throw new ModuleError(
                    `module '${imp.source}' not found (resolved to '${resolved}'). ` +
                    'Create the file in the workspace (＋) or fix the import path.',
                    { path, line: imp.line, code: 'MODULE_NOT_FOUND' });
            }
            edges.push({
                source: imp.source,
                resolved,
                line: imp.line,
                specifiers: imp.specifiers || [],
            });
            visit(resolved);
        }
        stack.pop();
        color.set(path, 2);
        order.push(path);
    };

    visit(entry);

    // Детерминированный порядок модулей — по каноническому пути.
    const paths = [...order].sort();
    const modules = paths.map((path) => {
        const mod = getModule(path);
        return {
            path,
            source: mod.source,
            ast: mod.ast,
            imports: graph.get(path) || [],
            exports: mod.exports,
        };
    });
    return { entry, modules, graph, cycles, sources };
}
