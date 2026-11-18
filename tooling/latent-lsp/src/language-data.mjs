// tooling/latent-lsp/src/language-data.mjs — загрузка и индексирование
// tooling/language-data/language.json.
//
// Единственная ответственность модуля — превратить JSON-файл в удобные
// индексы для completion/hover/signature help. Никакой логики LSP здесь нет.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень репозитория Latent (…/latent), вычисляется от расположения файла. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Путь к language.json по умолчанию. */
export const DEFAULT_LANGUAGE_DATA = path.resolve(REPO_ROOT, 'tooling/language-data/language.json');

/** Известные «владельцы» методов (по ним фильтруется completion после точки). */
export const METHOD_OWNERS = ['array', 'string', 'any', 'channel', 'tensor', 'ai'];

/**
 * Решает, откуда брать language.json.
 * Приоритет: явный аргумент → env LATENT_LANGUAGE_DATA → путь в репозитории.
 * @param {string} [explicit]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveLanguageDataPath(explicit, env = process.env) {
    if (explicit) return path.resolve(explicit);
    if (env && env.LATENT_LANGUAGE_DATA) return path.resolve(env.LATENT_LANGUAGE_DATA);
    return DEFAULT_LANGUAGE_DATA;
}

/**
 * Индексированные данные о языке.
 */
export class LanguageData {
    /**
     * @param {any} raw — разобранный language.json
     * @param {string} [sourcePath]
     */
    constructor(raw, sourcePath = '') {
        this.raw = raw || {};
        this.sourcePath = sourcePath;
        this.version = this.raw.version || '0.0.0';
        this.compilerVersion = this.raw.compilerVersion || '';
        this.description = this.raw.description || '';

        /** @type {Array<any>} */
        this.keywordList = Array.isArray(this.raw.keywords) ? this.raw.keywords : [];
        /** @type {Map<string, any>} */
        this.keywords = new Map(this.keywordList.map((k) => [k.name, k]));
        /** @type {Set<string>} */
        this.softKeywords = new Set(this.keywordList.filter((k) => k.soft).map((k) => k.name));

        /** @type {Array<any>} */
        this.operatorList = Array.isArray(this.raw.operators) ? this.raw.operators : [];
        /** @type {Array<any>} */
        this.typeList = Array.isArray(this.raw.types) ? this.raw.types : [];
        /** @type {Map<string, any>} */
        this.types = new Map(this.typeList.map((t) => [t.name, t]));

        /** @type {Array<any>} */
        this.builtinList = Array.isArray(this.raw.builtins) ? this.raw.builtins : [];
        /** @type {Map<string, any[]>} — имя → все записи (функция + методы с тем же именем) */
        this.builtinsByName = new Map();
        /** @type {Map<string, any[]>} — owner → методы/свойства */
        this.methodsByOwner = new Map();
        for (const item of this.builtinList) {
            if (!this.builtinsByName.has(item.name)) this.builtinsByName.set(item.name, []);
            this.builtinsByName.get(item.name).push(item);
            if (item.kind === 'method' || item.kind === 'property') {
                const owner = item.owner || 'any';
                if (!this.methodsByOwner.has(owner)) this.methodsByOwner.set(owner, []);
                this.methodsByOwner.get(owner).push(item);
            }
        }
        /** @type {Set<string>} */
        this.hostOnly = new Set(Array.isArray(this.raw.hostOnly) ? this.raw.hostOnly : []);
        /** @type {Array<any>} */
        this.diagnostics = Array.isArray(this.raw.diagnostics) ? this.raw.diagnostics : [];
        /** @type {Array<any>} */
        this.snippets = Array.isArray(this.raw.snippets) ? this.raw.snippets : [];
        this.abi = this.raw.abi || null;

        // Скомпилированные регулярки диагностик — для определения кода по тексту.
        /** @type {Array<{entry: any, regex: RegExp}>} */
        this.diagnosticPatterns = [];
        for (const entry of this.diagnostics) {
            if (!entry.regex) continue;
            try {
                this.diagnosticPatterns.push({ entry, regex: new RegExp(entry.regex) });
            } catch (e) {
                // Битый regex в данных не должен ронять сервер: просто пропускаем.
            }
        }
    }

    /** Все докки-ссылки известных разделов (для hover). */
    docsLink(docsPath) {
        return docsPath ? `docs/${docsPath}` : '';
    }

    /**
     * Ищет запись builtin по имени. Для совпадающих имён (например `push` —
     * функция и метод) предпочитает «вызываемую» форму.
     * @param {string} name
     * @returns {any|undefined}
     */
    findBuiltin(name) {
        const entries = this.builtinsByName.get(name);
        if (!entries || entries.length === 0) return undefined;
        const preferred = entries.find((e) =>
            ['function', 'host-function', 'constructor', 'macro'].includes(e.kind));
        return preferred || entries[0];
    }

    /**
     * Ищет метод/свойство по имени и (необязательно) владельцу.
     * @param {string} name
     * @param {string} [owner]
     * @returns {any|undefined}
     */
    findMethod(name, owner) {
        const entries = this.builtinsByName.get(name) || [];
        const methods = entries.filter((e) => e.kind === 'method' || e.kind === 'property');
        if (methods.length === 0) return undefined;
        if (owner) {
            const exact = methods.find((e) => e.owner === owner);
            if (exact) return exact;
        }
        return methods.find((e) => e.owner === 'any') || methods[0];
    }

    /**
     * Методы/свойства для объекта заданного владельца (включая `any`).
     * @param {string} owner
     * @returns {any[]}
     */
    methodsFor(owner) {
        const own = this.methodsByOwner.get(owner) || [];
        const any = this.methodsByOwner.get('any') || [];
        const result = [...own];
        for (const item of any) {
            if (!result.some((r) => r.name === item.name)) result.push(item);
        }
        return result;
    }

    /** Все методы/свойства (для completion после точки у объекта неизвестного типа). */
    allMethods() {
        const result = [];
        const seen = new Set();
        for (const owner of METHOD_OWNERS) {
            for (const item of this.methodsFor(owner)) {
                if (seen.has(item.name)) continue;
                seen.add(item.name);
                result.push(item);
            }
        }
        return result;
    }

    /** Ключевое слово по имени. */
    findKeyword(name) {
        return this.keywords.get(name);
    }

    /** Тип по имени. */
    findType(name) {
        return this.types.get(name);
    }

    /**
     * Определяет код диагностики по реальному тексту ошибки компилятора.
     * @param {string} message
     * @returns {string|undefined}
     */
    diagnosticCode(message) {
        for (const { entry, regex } of this.diagnosticPatterns) {
            if (regex.test(message)) return entry.code;
        }
        return undefined;
    }

    /**
     * Сниппет по префиксу.
     * @param {string} prefix
     * @returns {any|undefined}
     */
    findSnippet(prefix) {
        return this.snippets.find((s) => s.prefix === prefix);
    }
}

/**
 * Загружает language.json синхронно (файл небольшой, 60-80 КБ).
 * @param {string} [explicitPath]
 * @param {{logger?: {warn: Function, info?: Function}, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {LanguageData}
 * @throws {Error} если файл отсутствует или невалиден — без данных сервер бесполезен
 */
export function loadLanguageData(explicitPath, opts = {}) {
    const filePath = resolveLanguageDataPath(explicitPath, opts.env);
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        throw new Error(`не удалось прочитать language data (${filePath}): ${e.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`невалидный JSON в language data (${filePath}): ${e.message}`);
    }
    const data = new LanguageData(parsed, filePath);
    if (data.keywordList.length === 0 || data.builtinList.length === 0) {
        throw new Error(`language data (${filePath}) пуст: нет keywords/builtins`);
    }
    opts.logger?.info?.(`language data: ${filePath} (v${data.version})`);
    return data;
}
