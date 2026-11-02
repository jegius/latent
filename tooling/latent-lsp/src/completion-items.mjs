// tooling/latent-lsp/src/completion-items.mjs — построение LSP CompletionItem
// из записей language.json и символов документа.
//
// Отделено от completion.mjs (оркестрации контекста), чтобы каждый модуль
// оставался небольшим и отвечал за одну задачу: здесь — только «как выглядит
// элемент автодополнения», там — «что предложить в данной позиции».

import { formatBuiltinMarkdown, formatKeywordMarkdown, formatTypeMarkdown, symbolDetail } from './docs.mjs';

/** Значения LSP CompletionItemKind. */
export const CompletionItemKind = {
    Text: 1,
    Method: 2,
    Function: 3,
    Constructor: 4,
    Field: 5,
    Variable: 6,
    Class: 7,
    Interface: 8,
    Module: 9,
    Property: 10,
    Unit: 11,
    Value: 12,
    Enum: 13,
    Keyword: 14,
    Snippet: 15,
    Struct: 22,
    TypeParameter: 25,
};

/** InsertTextFormat */
export const InsertTextFormat = { PlainText: 1, Snippet: 2 };

/** Символы-триггеры completion (совпадают с capabilities сервера). */
export const TRIGGER_CHARACTERS = ['.', ':'];

/**
 * CompletionItem для символа документа.
 * @param {any} symbol
 * @param {any} range
 */
export function symbolItem(symbol, range) {
    const kind = {
        fn: CompletionItemKind.Function,
        method: CompletionItemKind.Method,
        class: CompletionItemKind.Class,
        enum: CompletionItemKind.Enum,
        let: CompletionItemKind.Variable,
        variable: CompletionItemKind.Variable,
        field: CompletionItemKind.Field,
        test: CompletionItemKind.Function,
    }[symbol.kind] || CompletionItemKind.Text;
    return {
        label: symbol.name,
        kind,
        detail: symbolDetail(symbol),
        insertText: symbol.name,
        insertTextFormat: InsertTextFormat.PlainText,
        textEdit: { range, newText: symbol.name },
        sortText: '1' + symbol.name,
    };
}

/**
 * CompletionItem для ключевого слова (со сниппетом, если он есть в данных).
 * @param {any} entry
 * @param {any} range
 * @param {import('./language-data.mjs').LanguageData} languageData
 */
export function keywordItem(entry, range, languageData) {
    const snippet = languageData.findSnippet(entry.name);
    const insertText = snippet ? snippet.body : entry.name;
    const item = {
        label: entry.name,
        kind: CompletionItemKind.Keyword,
        detail: snippet
            ? `${snippet.description} · ключевое слово`
            : `ключевое слово${entry.soft ? ' (мягкое)' : ''} · ${entry.engine}`,
        documentation: { kind: 'markdown', value: formatKeywordMarkdown(entry) },
        insertText,
        insertTextFormat: snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
        textEdit: { range, newText: insertText },
        sortText: '2' + entry.name,
    };
    return item;
}

/**
 * CompletionItem для builtin/метода/конструктора.
 * @param {any} entry
 * @param {any} range
 * @param {import('./language-data.mjs').LanguageData} languageData
 * @param {boolean} [isMember]
 */
export function builtinItem(entry, range, languageData, isMember = false) {
    const kind = {
        function: CompletionItemKind.Function,
        'host-function': CompletionItemKind.Function,
        method: CompletionItemKind.Method,
        property: CompletionItemKind.Property,
        constructor: CompletionItemKind.Constructor,
        macro: CompletionItemKind.Snippet,
    }[entry.kind] || CompletionItemKind.Function;

    const hostOnly = entry.engine === 'host' || languageData.hostOnly.has(entry.name);
    const signature = entry.signatures?.[0] || entry.name;
    const insert = signatureToSnippet(entry.name, signature);
    const detailParts = [signature];
    if (hostOnly) detailParts.push('host-only');
    if (isMember) detailParts.push(`метод ${entry.owner || 'any'}`);

    return {
        label: entry.name,
        kind,
        detail: detailParts.join(' · '),
        documentation: { kind: 'markdown', value: formatBuiltinMarkdown(entry, languageData) },
        insertText: insert ? insert.text : entry.name,
        insertTextFormat: insert ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
        textEdit: { range, newText: insert ? insert.text : entry.name },
        sortText: '3' + entry.name,
    };
}

/**
 * CompletionItem для типа.
 * @param {any} entry
 * @param {any} range
 */
export function typeItem(entry, range) {
    const simple = /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name);
    return {
        label: entry.name,
        kind: CompletionItemKind.Struct,
        detail: `тип · ${entry.wasm}`,
        documentation: { kind: 'markdown', value: formatTypeMarkdown(entry) },
        insertText: entry.name,
        insertTextFormat: InsertTextFormat.PlainText,
        textEdit: { range, newText: entry.name },
        sortText: '4' + entry.name,
        filterText: simple ? entry.name : undefined,
    };
}

/**
 * Дополнительный сниппет (for-in, if-else, lambda) из language.json.snippets.
 * @param {any} snippet
 * @param {any} range
 */
export function snippetItem(snippet, range) {
    return {
        label: snippet.prefix,
        kind: CompletionItemKind.Snippet,
        detail: snippet.description,
        documentation: { kind: 'markdown', value: `\`\`\`latent\n${snippet.body}\n\`\`\`` },
        insertText: snippet.body,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { range, newText: snippet.body },
        sortText: '5' + snippet.prefix,
    };
}

/**
 * Превращает сигнатуру вида `len(arr|str) -> int` или `arr.push(value) -> [T]`
 * в сниппет `len(${1:arr|str})`.
 * @param {string} name
 * @param {string} signature
 * @returns {{text: string}|null}
 */
export function signatureToSnippet(name, signature) {
    const open = signature.indexOf('(');
    const close = signature.lastIndexOf(')');
    if (open < 0 || close <= open) return null;
    const paramsText = signature.slice(open + 1, close).trim();
    if (!paramsText) return null;
    const params = splitParams(paramsText);
    if (params.length === 0) return null;
    const placeholders = params.map((param, index) => `\${${index + 1}:${cleanParamLabel(param, index)}}`);
    return { text: `${name}(${placeholders.join(', ')})` };
}

/**
 * Делит список параметров по запятым верхнего уровня (скобки/угловые скобки).
 * @param {string} text
 * @returns {string[]}
 */
export function splitParams(text) {
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
 * Очищает параметр от типа: `x: int` → `x`, `arr|str` → `arr`, `...` → `...`.
 * @param {string} param
 * @param {number} index
 */
function cleanParamLabel(param, index) {
    if (param === '...' || param.endsWith('...')) return '...';
    const name = param.split(/[:=|\s]/)[0].trim();
    return name || `arg${index + 1}`;
}

/**
 * Фильтр по набранному префиксу (регистронезависимо).
 * @param {any[]} items
 * @param {string} prefix
 */
export function filterByPrefix(items, prefix) {
    if (!prefix) return items;
    const lower = prefix.toLowerCase();
    return items.filter((item) => {
        const text = (item.filterText || item.label || '').toLowerCase();
        return text.startsWith(lower) || (item.label || '').toLowerCase().includes(lower);
    });
}

/**
 * Убирает элементы с повторяющимся label (первый имеет приоритет по sortText).
 * @param {any[]} items
 */
export function dedupe(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        if (seen.has(item.label)) continue;
        seen.add(item.label);
        result.push(item);
    }
    return result;
}
