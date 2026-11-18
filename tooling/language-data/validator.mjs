// tooling/language-data/validator.mjs — структурная и семантическая проверка
// language.json (без внешнего JSON Schema-движка).
//
// Проверяет то, что важно потребителям (LSP, IDE-плагины, MCP-сервер, доки):
//   * обязательные поля и их типы;
//   * уникальность ключей (ключевые слова, builtins, коды диагностик);
//   * каждый regex диагностики реально разбирает её sample;
//   * у бинарных/унарных операторов есть приоритет;
//   * hostOnly ссылается на существующие builtins с engine=host;
//   * пути docs лежат в известных разделах сайта документации.
//
// Разбит на модули: validator-helpers (константы/общие проверки),
// validator-items (метаданные, ключевые слова, операторы, типы, builtins),
// validator-diagnostics (диагностики, сниппеты, ABI).

import fs from 'node:fs';

import { validateMeta, validateKeywords, validateOperators, validateTypes, validateBuiltins, validateHostOnly } from './validator-items.mjs';
import { validateDiagnostics, validateSnippets, validateAbi } from './validator-diagnostics.mjs';

export { ENGINES, DOC_SECTIONS } from './validator-helpers.mjs';

/**
 * Проверяет данные о языке.
 * @param {any} data — разобранный JSON language.json
 * @returns {{ok: boolean, errors: string[], warnings: string[], stats: object}}
 */
export function validateLanguageData(data) {
    const errors = [];
    const warnings = [];
    const stats = {};

    /** @param {string} message */
    const err = (message) => errors.push(message);
    /** @param {string} message */
    const warn = (message) => warnings.push(message);

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, errors: ['language.json должен быть JSON-объектом'], warnings, stats };
    }

    validateMeta(data, err);
    Object.assign(stats, validateKeywords(data, err));
    Object.assign(stats, validateOperators(data, err));
    Object.assign(stats, validateTypes(data, err));
    Object.assign(stats, validateBuiltins(data, err));
    validateHostOnly(data, err);
    validateDiagnostics(data, err, warn);
    validateSnippets(data, err);
    validateAbi(data, err, warn);
    if (Array.isArray(data.diagnostics)) stats.diagnostics = data.diagnostics.length;
    if (Array.isArray(data.snippets)) stats.snippets = data.snippets.length;
    if (data.abi && typeof data.abi === 'object') {
        stats.abiSections = Object.keys(data.abi).length;
    }

    return { ok: errors.length === 0, errors, warnings, stats };
}

/**
 * Читает и валидирует файл данных.
 * @param {string} filePath
 * @returns {{ok: boolean, errors: string[], warnings: string[], stats: object}}
 */
export function validateLanguageFile(filePath) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return { ok: false, errors: [`не удалось прочитать ${filePath}: ${e.message}`], warnings: [], stats: {} };
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return { ok: false, errors: [`${filePath}: невалидный JSON: ${e.message}`], warnings: [], stats: {} };
    }
    return validateLanguageData(data);
}
