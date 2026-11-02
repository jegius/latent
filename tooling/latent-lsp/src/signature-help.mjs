// tooling/latent-lsp/src/signature-help.mjs — подсказка сигнатуры при вызове.
//
// Активный параметр определяется по числу запятых верхнего уровня между
// открывающей скобкой вызова и курсором (context.scanCallContext). Сигнатуры
// берутся из language.json для builtins и из объявлений текущего файла для
// пользовательских функций.

import { scanCallContext } from './context.mjs';
import { findSymbol, scanSymbols } from './analyzer.mjs';

/**
 * @param {{
 *   text: string,
 *   offset: number,
 *   languageData: import('./language-data.mjs').LanguageData,
 *   symbols?: any[],
 * }} params
 * @returns {{signatures: any[], activeSignature: number, activeParameter: number}|null}
 */
export function provideSignatureHelp({ text, offset, languageData, symbols }) {
    const call = scanCallContext(text, offset);
    if (!call || !call.name) return null;

    const docSymbols = symbols || scanSymbols(text);
    const signatures = collectSignatures(call, languageData, docSymbols);
    if (signatures.length === 0) return null;

    const parameters = signatures[0].parameters || [];
    const activeParameter = clampParameter(call.activeParameter, parameters.length);
    return { signatures, activeSignature: 0, activeParameter };
}

/**
 * Подбирает сигнатуры: метод (если есть receiver), builtin, пользовательская функция.
 * @param {{name: string, receiver: string}} call
 * @param {import('./language-data.mjs').LanguageData} languageData
 * @param {any[]} symbols
 * @returns {any[]}
 */
function collectSignatures(call, languageData, symbols) {
    const signatures = [];

    if (call.receiver) {
        const method = languageData.findMethod(call.name);
        if (method) signatures.push(...fromLanguageData(method));
    }
    if (signatures.length === 0) {
        const builtin = languageData.findBuiltin(call.name);
        if (builtin) signatures.push(...fromLanguageData(builtin));
    }
    if (signatures.length === 0) {
        const symbol = findSymbol(symbols, call.name, ['fn', 'method']);
        if (symbol) signatures.push(...fromDocumentSymbol(symbol));
    }
    return signatures.filter((signature) => signature.parameters.length > 0);
}

/**
 * Сигнатуры из записи language.json (все варианты `signatures`).
 * @param {any} entry
 * @returns {any[]}
 */
function fromLanguageData(entry) {
    return (entry.signatures || []).map((signature) => {
        const params = parseParams(signature);
        return {
            label: signature,
            documentation: { kind: 'markdown', value: entry.summary },
            parameters: params.map((param) => ({ label: param })),
        };
    });
}

/**
 * Сигнатура из объявления функции в файле: `fn add(a: int, b: int) -> int {`.
 * @param {any} symbol
 * @returns {any[]}
 */
function fromDocumentSymbol(symbol) {
    const detail = symbol.detail || '';
    const open = detail.indexOf('(');
    const close = findClosingParen(detail, open);
    if (open < 0 || close < 0) return [];
    const params = splitTopLevel(detail.slice(open + 1, close));
    const tail = detail.slice(close + 1).replace(/\{.*$/, '').trim();
    const label = `${detail.slice(0, close + 1).trim()}${tail ? ' ' + tail : ''}`;
    return [{
        label,
        documentation: { kind: 'markdown', value: `Объявление в этом файле (строка ${symbol.line + 1}).` },
        parameters: params.map((param) => ({ label: param })),
    }];
}

/**
 * Делит параметры из текста сигнатуры по запятым верхнего уровня.
 * `len(arr|str) -> int` → ['arr|str']; `print(a, ...)` → ['a', '...'].
 * @param {string} signature
 * @returns {string[]}
 */
export function parseParams(signature) {
    const open = signature.indexOf('(');
    const close = findClosingParen(signature, open);
    if (open < 0 || close < 0) return [];
    return splitTopLevel(signature.slice(open + 1, close));
}

/**
 * @param {string} text
 * @param {number} open — индекс '('
 * @returns {number} индекс соответствующей ')'
 */
function findClosingParen(text, open) {
    if (open < 0) return -1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * Делит строку по запятым, не разрывая вложенные `()`, `[]`, `<>`.
 * @param {string} text
 * @returns {string[]}
 */
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if ('([{<'.includes(ch)) depth++;
        else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/**
 * Клампит активный параметр в диапазон сигнатуры; у вариативной формы
 * (`...` в конце) последний параметр «поглощает» все лишние аргументы.
 * @param {number} index
 * @param {number} count
 * @returns {number}
 */
function clampParameter(index, count) {
    if (count <= 0) return 0;
    return Math.max(0, Math.min(index, count - 1));
}
