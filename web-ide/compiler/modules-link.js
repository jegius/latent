// compiler/modules-link.js — линковка файловых модулей для движка №1.
// Единственная ответственность: двухфазная линковка (таблица символов, затем
// переписывание AST через modules-rewrite.js), проверка экспортов и слияние
// модулей в один Program для интерпретатора.
//
// Циклы импорта разрешены: резолвер обходит граф без повторного разбора, а
// линковка работает по таблице символов, а не по порядку исполнения.

import { ModuleError, resolveModuleGraph, sharedModuleCache, hashString, normalizeModulePath } from './modules.js';
import { renameTopDeclaration, rewriteBlock, rewriteStmt } from './modules-rewrite.js';

const DECLARATIONS = new Set(['Function', 'Class', 'Enum']);

/** Глубокое клонирование AST: кэш разбора не должен мутироваться линковкой. */
function cloneAst(ast) {
    if (typeof structuredClone === 'function') return structuredClone(ast);
    return JSON.parse(JSON.stringify(ast));
}

/** Снимает обёртки Decorator/Export и возвращает само объявление. */
function unwrapDeclaration(node) {
    let cur = node;
    while (cur && (cur.type === 'Decorator' || cur.type === 'Export')) {
        cur = cur.type === 'Decorator' ? cur.target : cur.declaration;
    }
    return cur;
}

/** Первая фаза: таблицы объявлений/вариантов/экспортов одного модуля. */
function collectModuleInfo(module, index, graph) {
    const prefix = `m${index}$`;
    const decls = new Map();
    const variants = new Map();
    const exports = new Map();
    for (const raw of module.ast.statements || []) {
        const exported = raw.type === 'Export';
        const decl = unwrapDeclaration(raw);
        if (!decl || !DECLARATIONS.has(decl.type)) continue;
        if (decls.has(decl.name)) {
            throw new ModuleError(
                `duplicate top-level declaration '${decl.name}'`,
                { path: module.path, code: 'DUPLICATE_DECLARATION' });
        }
        const mangled = prefix + decl.name;
        decls.set(decl.name, { mangled, kind: decl.type });
        if (exported) {
            exports.set(decl.name, {
                kind: decl.type === 'Function' ? 'fn' : decl.type.toLowerCase(),
                mangled,
            });
        }
        if (decl.type === 'Enum') {
            for (const variant of decl.variants || []) {
                if (variants.has(variant.name)) {
                    throw new ModuleError(
                        `duplicate enum variant '${variant.name}'`,
                        { path: module.path, code: 'DUPLICATE_DECLARATION' });
                }
                variants.set(variant.name, {
                    mangled: `${prefix}${variant.name}`,
                    enumName: decl.name,
                    arity: (variant.fields || []).length,
                });
            }
        }
    }
    return {
        path: module.path,
        prefix,
        ast: cloneAst(module.ast),
        imports: graph.get(module.path) || [],
        decls,
        variants,
        exports,
    };
}

/**
 * Вторая фаза, шаг 1: область видимости импортируемых имён.
 * Возвращает Map<локальное имя, мангленное имя>.
 */
function buildBindings(info, byPath) {
    const bindings = new Map();
    for (const [name, decl] of info.decls) bindings.set(name, decl.mangled);
    for (const [name, variant] of info.variants) bindings.set(name, variant.mangled);

    const imported = new Set();
    for (const edge of info.imports) {
        const target = byPath.get(edge.resolved);
        for (const spec of edge.specifiers || []) {
            const exported = target && target.exports.get(spec.imported);
            if (!exported) {
                throw new ModuleError(
                    `module '${edge.source}' does not export '${spec.imported}'`,
                    { path: info.path, line: edge.line, code: 'NOT_EXPORTED' });
            }
            if (imported.has(spec.local) || info.decls.has(spec.local)) {
                throw new ModuleError(
                    `duplicate imported name '${spec.local}'`,
                    { path: info.path, line: edge.line, code: 'DUPLICATE_IMPORT' });
            }
            imported.add(spec.local);
            bindings.set(spec.local, exported.mangled);
            // Импорт enum делает видимыми и его варианты-конструкторы (v1).
            if (exported.kind === 'enum') {
                for (const [variantName, variant] of target.variants) {
                    if (variant.enumName !== spec.imported) continue;
                    const existing = bindings.get(variantName);
                    if (existing !== undefined && existing !== variant.mangled) {
                        throw new ModuleError(
                            `ambiguous enum variant '${variantName}' imported from '${edge.source}'`,
                            { path: info.path, line: edge.line, code: 'AMBIGUOUS_VARIANT' });
                    }
                    bindings.set(variantName, variant.mangled);
                }
            }
        }
    }
    return bindings;
}

/** Переписывает один top-level узел после переименования его объявления. */
function rewriteTopLevel(stmt, bindings) {
    if (!stmt) return;
    if (stmt.type === 'Decorator') {
        rewriteStmt(stmt.target, bindings, new Set());
    } else if (stmt.type === 'Function' || stmt.type === 'Class') {
        rewriteStmt(stmt, bindings, new Set());
    } else if (stmt.type === 'Test') {
        stmt.body = rewriteBlock(stmt.body, bindings, new Set());
    } else if (stmt.type !== 'Enum') {
        rewriteStmt(stmt, bindings, new Set());
    }
}

/** Регистрирует линкованное объявление в общем Program интерпретатора. */
function registerLinked(stmt, program) {
    if (!stmt) return;
    if (stmt.type === 'Decorator') { registerLinked(stmt.target, program); return; }
    if (stmt.type === 'Function') program.functions[stmt.name] = stmt;
    else if (stmt.type === 'Class') program.classes[stmt.name] = stmt;
    else if (stmt.type === 'Enum') program.enums[stmt.name] = stmt;
    else if (stmt.type === 'Test') program.tests.push(stmt);
    else program.statements.push(stmt);
}

/** Ключ кэша линковки: набор файлов (порядок не важен) + entry. */
function projectCacheKey(files, entryPath) {
    const pairs = files.map((file) => [
        normalizeModulePath(file && (file.name ?? file.path)),
        String((file && (file.code ?? file.source ?? file.text)) ?? ''),
    ]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const body = pairs.map(([path, source]) => `${path}\u0000${source}`).join('\u0001');
    return hashString(`${body}\u0002${normalizeModulePath(entryPath)}`);
}

const linkedCache = new Map();
const LINKED_CACHE_LIMIT = 16;

/** Сбрасывает кэш линковки (тесты/смена workspace). */
export function clearLinkedModuleCache() {
    linkedCache.clear();
}

/**
 * Линкует проект: DFS-граф модулей → таблица символов → переписанный AST.
 * @param {Array<{name?:string, code?:string}>} files
 * @param {string} entryPath
 * @param {{cache?: import('./modules.js').ModuleCache, noCache?: boolean}} [opts]
 * @returns {{program:object, entry:string, modules:object[], cycles:string[][]}}
 */
export function linkModuleProject(files, entryPath, opts = {}) {
    const cache = opts.cache || sharedModuleCache;
    const key = projectCacheKey(files, entryPath);
    if (!opts.noCache) {
        const hit = linkedCache.get(key);
        if (hit) return hit;
    }

    const graph = resolveModuleGraph(files, entryPath, { cache });
    const infos = graph.modules.map((module, index) => collectModuleInfo(module, index, graph.graph));
    const byPath = new Map(infos.map((info) => [info.path, info]));
    for (const info of infos) info.bindings = buildBindings(info, byPath);

    const program = {
        type: 'Program',
        functions: {},
        classes: {},
        enums: {},
        tests: [],
        statements: [],
        mainName: null,
    };
    for (const info of infos) {
        const linked = [];
        for (const raw of info.ast.statements || []) {
            if (raw.type === 'Import') continue;
            const stmt = raw.type === 'Export' ? raw.declaration : raw;
            if (!stmt) continue;
            renameTopDeclaration(stmt, info);
            rewriteTopLevel(stmt, info.bindings);
            linked.push(stmt);
        }
        for (const stmt of linked) registerLinked(stmt, program);
    }

    const entryInfo = byPath.get(graph.entry);
    const main = entryInfo && entryInfo.decls.get('main');
    program.mainName = main ? main.mangled : null;

    const result = {
        program,
        entry: graph.entry,
        cycles: graph.cycles,
        modules: infos.map((info) => ({
            path: info.path,
            prefix: info.prefix,
            exports: [...info.exports.keys()],
        })),
    };
    if (!opts.noCache) {
        linkedCache.set(key, result);
        if (linkedCache.size > LINKED_CACHE_LIMIT) {
            linkedCache.delete(linkedCache.keys().next().value);
        }
    }
    return result;
}
