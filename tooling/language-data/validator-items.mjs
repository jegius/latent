// tooling/language-data/validator-items.mjs — проверки разделов language.json:
// метаданные, ключевые слова, операторы, типы, builtins и hostOnly.

import { SEMVER_RE, checkDocs, checkEngine, isNonEmptyString } from './validator-helpers.mjs';

/**
 * Метаданные файла.
 * @param {any} data
 * @param {(message: string) => void} err
 */
export function validateMeta(data, err) {
    if (typeof data.version !== 'string' || !SEMVER_RE.test(data.version)) {
        err('version: ожидается semver-строка, например "1.0.0"');
    }
    if (data.language !== 'latent') err('language: ожидается "latent"');
    if (data.compilerVersion !== undefined && typeof data.compilerVersion !== 'string') {
        err('compilerVersion: ожидается строка');
    }
}

/**
 * @param {any} data
 * @param {(message: string) => void} err
 * @returns {object} статистика
 */
export function validateKeywords(data, err) {
    const stats = {};
    if (!Array.isArray(data.keywords) || data.keywords.length === 0) {
        err('keywords: ожидается непустой массив');
        return stats;
    }
    stats.keywords = data.keywords.length;
    const seen = new Set();
    data.keywords.forEach((kw, i) => {
        const where = `keywords[${i}]`;
        if (!kw || typeof kw.name !== 'string' || !kw.name) {
            err(`${where}.name: непустая строка обязательна`);
            return;
        }
        if (kw.kind !== 'keyword') err(`${where} (${kw.name}).kind: ожидается "keyword"`);
        if (typeof kw.soft !== 'boolean') err(`${where} (${kw.name}).soft: ожидается boolean`);
        if (!isNonEmptyString(kw.summary, 10)) err(`${where} (${kw.name}).summary: слишком короткое описание`);
        if (!isNonEmptyString(kw.syntax)) err(`${where} (${kw.name}).syntax: непустая строка обязательна`);
        checkEngine(where, kw, err);
        checkDocs(where, kw, err);
        if (seen.has(kw.name)) err(`${where}: дубликат ключевого слова "${kw.name}"`);
        seen.add(kw.name);
    });
    return stats;
}

/**
 * @param {any} data
 * @param {(message: string) => void} err
 * @returns {object}
 */
export function validateOperators(data, err) {
    const stats = {};
    if (!Array.isArray(data.operators) || data.operators.length === 0) {
        err('operators: ожидается непустой массив');
        return stats;
    }
    stats.operators = data.operators.length;
    const kinds = new Set(['binary', 'unary', 'assignment', 'postfix', 'punctuation', 'arrow']);
    const seen = new Set();
    data.operators.forEach((op, i) => {
        const where = `operators[${i}]`;
        if (!op || typeof op.op !== 'string' || !op.op) {
            err(`${where}.op: непустая строка обязательна`);
            return;
        }
        if (!kinds.has(op.kind)) err(`${where} (${op.op}).kind: неизвестный kind "${op.kind}"`);
        if (!isNonEmptyString(op.summary, 10)) err(`${where} (${op.op}).summary: слишком короткое описание`);
        if (op.kind !== 'punctuation') {
            if (!Number.isInteger(op.precedence) || op.precedence < 1 || op.precedence > 100) {
                err(`${where} (${op.op}): для kind="${op.kind}" нужен precedence 1..100`);
            }
        }
        if (op.assoc !== undefined && !['left', 'right', 'none'].includes(op.assoc)) {
            err(`${where} (${op.op}).assoc: ожидается left|right|none`);
        }
        checkEngine(where, op, err);
        checkDocs(where, op, err);
        const key = `${op.kind}:${op.op}`;
        if (seen.has(key)) err(`${where}: дубликат оператора "${key}"`);
        seen.add(key);
    });
    return stats;
}

/**
 * @param {any} data
 * @param {(message: string) => void} err
 * @returns {object}
 */
export function validateTypes(data, err) {
    const stats = {};
    if (!Array.isArray(data.types) || data.types.length === 0) {
        err('types: ожидается непустой массив');
        return stats;
    }
    stats.types = data.types.length;
    const categories = new Set(['primitive', 'composite', 'user', 'concurrency', 'ai']);
    const seen = new Set();
    data.types.forEach((ty, i) => {
        const where = `types[${i}]`;
        if (!ty || typeof ty.name !== 'string' || !ty.name) {
            err(`${where}.name: непустая строка обязательна`);
            return;
        }
        if (!categories.has(ty.category)) {
            err(`${where} (${ty.name}).category: неизвестная категория "${ty.category}"`);
        }
        if (typeof ty.wasm !== 'string') err(`${where} (${ty.name}).wasm: ожидается строка`);
        if (!isNonEmptyString(ty.summary, 10)) err(`${where} (${ty.name}).summary: слишком короткое описание`);
        checkEngine(where, ty, err);
        checkDocs(where, ty, err);
        if (seen.has(ty.name)) err(`${where}: дубликат типа "${ty.name}"`);
        seen.add(ty.name);
    });
    return stats;
}

/**
 * @param {any} data
 * @param {(message: string) => void} err
 * @returns {object}
 */
export function validateBuiltins(data, err) {
    const stats = {};
    if (!Array.isArray(data.builtins) || data.builtins.length === 0) {
        err('builtins: ожидается непустой массив');
        return stats;
    }
    stats.builtins = data.builtins.length;
    const kinds = new Set(['function', 'method', 'property', 'constructor', 'host-function', 'macro']);
    const owners = ['array', 'string', 'any', 'channel', 'tensor', 'ai'];
    const seen = new Set();
    data.builtins.forEach((b, i) => {
        const where = `builtins[${i}]`;
        if (!b || typeof b.name !== 'string' || !b.name) {
            err(`${where}.name: непустая строка обязательна`);
            return;
        }
        if (!kinds.has(b.kind)) err(`${where} (${b.name}).kind: неизвестный kind "${b.kind}"`);
        if (!Array.isArray(b.signatures) || b.signatures.length === 0) {
            err(`${where} (${b.name}).signatures: нужен непустой массив сигнатур`);
        } else if (b.signatures.some((s) => typeof s !== 'string' || s.length < 3)) {
            err(`${where} (${b.name}).signatures: все сигнатуры — непустые строки`);
        }
        if (b.owner !== undefined && !owners.includes(b.owner)) {
            err(`${where} (${b.name}).owner: неизвестный владелец "${b.owner}"`);
        }
        if ((b.kind === 'method' || b.kind === 'property') && !b.owner) {
            err(`${where} (${b.name}): для метода/свойства обязателен owner`);
        }
        if (!isNonEmptyString(b.summary, 10)) err(`${where} (${b.name}).summary: слишком короткое описание`);
        checkEngine(where, b, err);
        checkDocs(where, b, err);
        const key = `${b.kind}:${b.name}${b.owner ? ':' + b.owner : ''}`;
        if (seen.has(key)) err(`${where}: дубликат builtin "${key}"`);
        seen.add(key);
    });
    return stats;
}

/**
 * hostOnly ссылается на существующие builtins с engine=host (или js).
 * @param {any} data
 * @param {(message: string) => void} err
 */
export function validateHostOnly(data, err) {
    if (!Array.isArray(data.hostOnly)) {
        err('hostOnly: ожидается массив имён');
        return;
    }
    if (new Set(data.hostOnly).size !== data.hostOnly.length) {
        err('hostOnly: имена не должны повторяться');
    }
    const builtinNames = new Set((data.builtins || []).map((b) => b && b.name));
    for (const name of data.hostOnly) {
        if (typeof name !== 'string' || !name) {
            err('hostOnly: все элементы — непустые строки');
            continue;
        }
        if (!builtinNames.has(name)) err(`hostOnly: "${name}" отсутствует в builtins`);
        const entries = (data.builtins || []).filter((b) => b && b.name === name);
        if (!entries.some((b) => b.engine === 'host' || b.engine === 'js')) {
            err(`hostOnly: "${name}" должен иметь engine "host" (или "js")`);
        }
    }
}
