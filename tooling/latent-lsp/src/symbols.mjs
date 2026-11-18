// tooling/latent-lsp/src/symbols.mjs — documentSymbol и definition.
//
// Язык Latent не имеет модулей: всё живёт в одном файле, поэтому definition
// ищет объявление только в текущем документе (это зафиксировано в PLAN.md).
// documentSymbol отдаёт иерархию: класс → поля/методы, функция → локальные
// переменные.

import { wordAt } from './context.mjs';
import { findSymbol, enclosingClass, scanSymbols } from './analyzer.mjs';

/** Значения LSP SymbolKind. */
export const SymbolKind = {
    File: 1,
    Module: 2,
    Namespace: 3,
    Package: 4,
    Class: 5,
    Method: 6,
    Property: 7,
    Field: 8,
    Constructor: 9,
    Enum: 10,
    Interface: 11,
    Function: 12,
    Variable: 13,
    Constant: 14,
    String: 15,
    Number: 16,
    Boolean: 17,
    Array: 18,
    Object: 19,
    Key: 20,
    Null: 21,
    EnumMember: 22,
    Struct: 23,
    Event: 24,
    Operator: 25,
    TypeParameter: 26,
};

/** Соответствие kind'ов анализатора и LSP. */
const KIND_MAP = {
    fn: SymbolKind.Function,
    method: SymbolKind.Method,
    class: SymbolKind.Class,
    enum: SymbolKind.Enum,
    let: SymbolKind.Variable,
    variable: SymbolKind.Variable,
    field: SymbolKind.Field,
    test: SymbolKind.Function,
};

/**
 * DocumentSymbol[] для всего документа.
 * @param {string} text
 * @returns {any[]}
 */
export function provideDocumentSymbols(text) {
    const symbols = scanSymbols(text);
    return symbols.map((symbol) => toDocumentSymbol(symbol));
}

/**
 * Преобразует внутренний символ в LSP DocumentSymbol (без служебных полей).
 * @param {any} symbol
 * @returns {any}
 */
function toDocumentSymbol(symbol) {
    return {
        name: symbol.name,
        detail: symbol.detail || '',
        kind: KIND_MAP[symbol.kind] || SymbolKind.Variable,
        range: symbol.range,
        selectionRange: symbol.selectionRange,
        children: (symbol.children || []).map((child) => toDocumentSymbol(child)),
    };
}

/**
 * Definition: объявление функции/класса/enum/переменной/поля в текущем файле.
 * @param {{text: string, offset: number, uri: string}} params
 * @returns {{uri: string, range: any}|null}
 */
export function provideDefinition({ text, offset, uri }) {
    const target = wordAt(text, offset);
    if (!target || target.kind !== 'word') return null;

    const symbols = scanSymbols(text);
    let symbol = findSymbol(symbols, target.word);
    if (!symbol) {
        // `this.field` / `obj.field`: ищем поле в ближайшем классе.
        const before = previousNonSpace(text, target.start);
        if (before === '.') {
            const cls = enclosingClass(symbols, target.start);
            if (cls) {
                const field = cls.children.find((child) => child.name === target.word);
                if (field) symbol = field;
            }
        }
    }
    if (!symbol) return null;
    return { uri, range: symbol.selectionRange };
}

/**
 * @param {string} text
 * @param {number} start
 * @returns {string}
 */
function previousNonSpace(text, start) {
    let i = start - 1;
    while (i >= 0 && /\s/.test(text[i])) i--;
    return i >= 0 ? text[i] : '';
}
