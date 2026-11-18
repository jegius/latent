// tooling/latent-lsp/src/completion.mjs — автодополнение Latent: определение
// контекста и сборка списка предложений.
//
// Источники элементов:
//   * ключевые слова и типы — tooling/language-data/language.json;
//   * встроенные функции/методы — оттуда же (с detail/signature и сниппетами);
//   * символы текущего файла — лёгкий анализ analyzer.mjs (функции, классы,
//     enum, переменные);
//   * после `.` — методы/свойства и поля класса (упрощённо, по контексту).
//
// Само построение CompletionItem живёт в completion-items.mjs.

import { offsetToPosition } from './positions.mjs';
import { memberContext, isInsideString, isTypeContext, prefixAt } from './context.mjs';
import { enclosingClass, classOfVariable } from './declarations.mjs';
import { scanSymbols } from './analyzer.mjs';
import {
    CompletionItemKind,
    InsertTextFormat,
    TRIGGER_CHARACTERS,
    builtinItem,
    dedupe,
    filterByPrefix,
    keywordItem,
    signatureToSnippet,
    snippetItem,
    symbolItem,
    typeItem,
} from './completion-items.mjs';

export { CompletionItemKind, InsertTextFormat, TRIGGER_CHARACTERS, signatureToSnippet };

/**
 * Основная точка входа: элементы completion для позиции.
 * @param {{
 *   text: string,
 *   offset: number,
 *   languageData: import('./language-data.mjs').LanguageData,
 *   symbols?: any[],
 * }} params
 * @returns {{isIncomplete: boolean, items: any[]}}
 */
export function provideCompletion({ text, offset, languageData, symbols }) {
    if (isInsideString(text, offset)) {
        return { isIncomplete: false, items: [] };
    }

    const docSymbols = symbols || scanSymbols(text);

    const member = memberContext(text, offset);
    if (member) {
        return {
            isIncomplete: false,
            items: memberItems(member, text, offset, languageData, docSymbols),
        };
    }

    const { prefix, start } = prefixAt(text, offset);
    const range = {
        start: offsetToPosition(text, start),
        end: offsetToPosition(text, offset),
    };

    if (isTypeContext(text, offset)) {
        const items = languageData.typeList.map((entry) => typeItem(entry, range));
        return { isIncomplete: false, items: dedupe(filterByPrefix(items, prefix)) };
    }

    // Общий контекст: символы файла, builtins, ключевые слова, типы, сниппеты.
    const items = [];
    for (const symbol of flattenCandidates(docSymbols)) items.push(symbolItem(symbol, range));
    for (const entry of languageData.builtinList) {
        if (entry.kind === 'method' || entry.kind === 'property') continue;
        items.push(builtinItem(entry, range, languageData));
    }
    for (const entry of languageData.keywordList) items.push(keywordItem(entry, range, languageData));
    for (const entry of languageData.typeList) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)) continue;
        items.push(typeItem(entry, range));
    }
    for (const snippet of languageData.snippets) {
        if (languageData.keywords.has(snippet.prefix)) continue; // уже в keywordItem
        items.push(snippetItem(snippet, range));
    }

    return { isIncomplete: false, items: dedupe(filterByPrefix(items, prefix)) };
}

/**
 * Completion после точки.
 * @param {{object: string, prefix: string, start: number, isString: boolean, isThis: boolean}} member
 * @param {string} text
 * @param {number} offset
 * @param {import('./language-data.mjs').LanguageData} languageData
 * @param {any[]} symbols
 * @returns {any[]}
 */
function memberItems(member, text, offset, languageData, symbols) {
    const range = {
        start: offsetToPosition(text, member.start),
        end: offsetToPosition(text, offset),
    };
    const items = [];
    const owner = resolveOwner(member, text, offset, symbols);

    if (owner && owner.startsWith('class:')) {
        const className = owner.slice('class:'.length);
        const classSymbol = symbols.find((symbol) => symbol.kind === 'class' && symbol.name === className);
        if (classSymbol) {
            for (const child of classSymbol.children || []) {
                if (child.kind === 'field') items.push(fieldItem(child, range));
                else if (child.kind === 'method') items.push(symbolItem(child, range));
            }
        }
    }

    const methods = owner && !owner.startsWith('class:')
        ? languageData.methodsFor(owner)
        : languageData.allMethods();
    for (const entry of methods) items.push(builtinItem(entry, range, languageData, true));

    // Если тип объекта неизвестен — добавим методы/поля всех классов файла.
    if (!owner) {
        for (const symbol of flattenCandidates(symbols)) {
            if (symbol.kind === 'field') items.push(fieldItem(symbol, range));
            else if (symbol.kind === 'method') items.push(symbolItem(symbol, range));
        }
    }

    return dedupe(filterByPrefix(items, member.prefix));
}

/**
 * CompletionItem для поля класса.
 * @param {any} field
 * @param {any} range
 */
function fieldItem(field, range) {
    return {
        label: field.name,
        kind: CompletionItemKind.Field,
        detail: field.detail,
        insertText: field.name,
        insertTextFormat: InsertTextFormat.PlainText,
        textEdit: { range, newText: field.name },
        sortText: '0' + field.name,
    };
}

/**
 * Определяет владельца методов для объекта слева от точки.
 * @returns {string|undefined} 'array' | 'string' | 'channel' | 'tensor' | 'ai' | 'class:Name'
 */
function resolveOwner(member, text, offset, symbols) {
    if (member.isString) return 'string';
    if (member.isThis) {
        const cls = enclosingClass(symbols, offset);
        return cls ? `class:${cls.name}` : undefined;
    }
    const object = member.object;
    if (!object) return undefined;
    if (object === 'ai') return 'ai';
    const inferred = classOfVariable(text, object, symbols);
    if (!inferred) return undefined;
    if (['array', 'string', 'channel', 'tensor', 'ai'].includes(inferred)) return inferred;
    return `class:${inferred}`;
}

/**
 * Плоский список кандидатов из символов файла.
 * @param {any[]} symbols
 * @returns {any[]}
 */
function flattenCandidates(symbols) {
    const result = [];
    const walk = (list) => {
        for (const symbol of list) {
            result.push(symbol);
            if (symbol.children?.length) walk(symbol.children);
        }
    };
    walk(symbols);
    return result;
}
