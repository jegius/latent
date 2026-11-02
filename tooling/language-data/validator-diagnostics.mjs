// tooling/language-data/validator-diagnostics.mjs — проверки каталога
// диагностик, сниппетов и ABI.

import { CODE_RE, checkDocs, checkEngine, isNonEmptyString } from './validator-helpers.mjs';

/**
 * Каталог диагностик: коды уникальны, regex разбирает sample, positioned
 * соответствует наличию «на строке L:C» в тексте.
 * @param {any} data
 * @param {(message: string) => void} err
 * @param {(message: string) => void} warn
 */
export function validateDiagnostics(data, err, warn) {
    if (!Array.isArray(data.diagnostics) || data.diagnostics.length === 0) {
        err('diagnostics: ожидается непустой массив');
        return;
    }
    const seen = new Set();
    data.diagnostics.forEach((d, i) => {
        const where = `diagnostics[${i}]`;
        if (!d || typeof d.code !== 'string' || !CODE_RE.test(d.code)) {
            err(`${where}.code: ожидается строка вида LEX_*/PARSE_*/TYPE_*/GEN_*`);
            return;
        }
        if (seen.has(d.code)) err(`${where}: дубликат кода диагностики "${d.code}"`);
        seen.add(d.code);
        checkEngine(where, d, err);
        if (!['error', 'warning', 'info', 'hint'].includes(d.severity)) {
            err(`${where} (${d.code}).severity: ожидается error|warning|info|hint`);
        }
        if (typeof d.positioned !== 'boolean') {
            err(`${where} (${d.code}).positioned: ожидается boolean`);
        }
        if (!isNonEmptyString(d.pattern, 5)) {
            err(`${where} (${d.code}).pattern: ожидается текст сообщения`);
        }
        if (!isNonEmptyString(d.summary, 10)) {
            err(`${where} (${d.code}).summary: слишком короткое описание`);
        }
        checkDocs(where, d, err);

        if (d.regex === undefined) {
            if (d.positioned === true) warn(`${where} (${d.code}): positioned=true без regex`);
            return;
        }
        let regex = null;
        try {
            regex = new RegExp(d.regex);
        } catch (e) {
            err(`${where} (${d.code}).regex: не компилируется (${e.message})`);
        }
        if (!regex) return;
        if (typeof d.sample !== 'string') {
            warn(`${where} (${d.code}): есть regex, но нет sample для проверки`);
            return;
        }
        if (!regex.test(d.sample)) err(`${where} (${d.code}): sample не соответствует regex`);
        if (d.positioned === true && /на строке \d+:\d+/.test(d.sample) && !regex.test(d.sample)) {
            err(`${where} (${d.code}): positioned-сообщение не разбирается regex`);
        }
    });
}

/**
 * @param {any} data
 * @param {(message: string) => void} err
 */
export function validateSnippets(data, err) {
    if (data.snippets === undefined) return;
    if (!Array.isArray(data.snippets)) {
        err('snippets: ожидается массив');
        return;
    }
    const seen = new Set();
    data.snippets.forEach((s, i) => {
        const where = `snippets[${i}]`;
        if (!s || typeof s.prefix !== 'string' || !s.prefix) {
            err(`${where}.prefix: непустая строка обязательна`);
            return;
        }
        if (!isNonEmptyString(s.body)) err(`${where} (${s.prefix}).body: непустая строка обязательна`);
        if (!isNonEmptyString(s.description, 3)) {
            err(`${where} (${s.prefix}).description: слишком короткое описание`);
        }
        if (seen.has(s.prefix)) err(`${where}: дубликат префикса сниппета "${s.prefix}"`);
        seen.add(s.prefix);
    });
}

/**
 * @param {any} data
 * @param {(message: string) => void} err
 * @param {(message: string) => void} warn
 */
export function validateAbi(data, err, warn) {
    if (data.abi === undefined) {
        warn('abi: раздел отсутствует (документация ABI будет неполной)');
        return;
    }
    if (typeof data.abi !== 'object' || data.abi === null) {
        err('abi: ожидается объект');
    }
}
