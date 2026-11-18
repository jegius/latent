// tooling/latent-lsp/src/hover.mjs — подсказки при наведении (hover).
//
// Источники: language.json (ключевые слова, builtins, типы, операторы) и
// объявления текущего файла (функции/классы/enum/переменные/поля). Для
// недописанного кода, где символа нет в данных, hover возвращает null —
// это штатное поведение, а не ошибка.

import { offsetToPosition } from './positions.mjs';
import { wordAt } from './context.mjs';
import { findSymbol, scanSymbols } from './analyzer.mjs';
import {
    formatBuiltinMarkdown,
    formatKeywordMarkdown,
    formatOperatorMarkdown,
    formatSymbolMarkdown,
    formatTypeMarkdown,
} from './docs.mjs';

/**
 * @param {{
 *   text: string,
 *   offset: number,
 *   languageData: import('./language-data.mjs').LanguageData,
 *   symbols?: any[],
 * }} params
 * @returns {{contents: {kind: string, value: string}, range: any}|null}
 */
export function provideHover({ text, offset, languageData, symbols }) {
    const target = wordAt(text, offset);
    if (!target) return null;
    const range = {
        start: offsetToPosition(text, target.start),
        end: offsetToPosition(text, target.end),
    };
    const markdown = hoverMarkdown(target, text, languageData, symbols || scanSymbols(text));
    if (!markdown) return null;
    return { contents: { kind: 'markdown', value: markdown }, range };
}

/**
 * Собирает markdown для слова/оператора под курсором.
 * @param {{word: string, start: number, kind: string}} target
 * @param {string} text
 * @param {import('./language-data.mjs').LanguageData} languageData
 * @param {any[]} symbols
 * @returns {string|null}
 */
function hoverMarkdown(target, text, languageData, symbols) {
    const { word, start, kind } = target;

    if (kind === 'operator') {
        const operator = languageData.operatorList.find((op) => op.op === word);
        return operator ? formatOperatorMarkdown(operator) : null;
    }

    // В позиции аннотации типа имя вроде `int` — это тип, а не одноимённая
    // встроенная функция (`int(x)`).
    const type = languageData.findType(word);
    if (type && isTypePosition(text, start)) return formatTypeMarkdown(type);

    // Метод после точки имеет приоритет над одноимённой функцией.
    const before = previousNonSpace(text, start);
    const isMember = before === '.';
    const method = isMember ? languageData.findMethod(word) : undefined;
    if (method) return formatBuiltinMarkdown(method, languageData);

    const builtin = languageData.findBuiltin(word);
    const keyword = languageData.findKeyword(word);
    // `assert`/`assert_eq` — и keyword, и builtin: показываем сигнатуру builtin.
    if (builtin) return formatBuiltinMarkdown(builtin, languageData);
    if (keyword) return formatKeywordMarkdown(keyword);

    if (type) return formatTypeMarkdown(type);

    const symbol = findSymbol(symbols, word);
    if (symbol) return formatSymbolMarkdown(symbol, '');

    return null;
}

/**
 * Стоит ли слово в позиции аннотации типа (`: int`, `-> int`, `[int]`, `<int>`).
 * @param {string} text
 * @param {number} start
 * @returns {boolean}
 */
function isTypePosition(text, start) {
    let i = start - 1;
    while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
    if (i < 0) return false;
    const ch = text[i];
    if (ch === ':' || ch === '[' || ch === ',' || ch === '<' || ch === '|') return true;
    if (ch === '>' && text[i - 1] === '-') return true;
    return false;
}

/**
 * Символ перед позицией, пропуская пробелы (для проверки `obj.method`).
 * @param {string} text
 * @param {number} start
 * @returns {string}
 */
function previousNonSpace(text, start) {
    let i = start - 1;
    while (i >= 0 && /\s/.test(text[i])) i--;
    return i >= 0 ? text[i] : '';
}
