// tooling/latent-lsp/src/declarations.mjs — навигация по символам документа:
// поиск объявлений, поля/методы классов, вывод типа переменной.
//
// Отделено от analyzer.mjs (сборка символов), чтобы модули оставались
// небольшими: analyzer отвечает «что объявлено», этот модуль — «как найти
// объявление и что оно значит».

/**
 * Рекурсивно ищет символ по имени (включая детей классов).
 * @param {any[]} symbols
 * @param {string} name
 * @param {string[]} [kinds]
 * @returns {any|undefined}
 */
export function findSymbol(symbols, name, kinds) {
    for (const symbol of symbols) {
        if (symbol.name === name && (!kinds || kinds.includes(symbol.kind))) return symbol;
        const nested = findSymbol(symbol.children || [], name, kinds);
        if (nested) return nested;
    }
    return undefined;
}

/**
 * Все символы плоским списком (с детьми).
 * @param {any[]} symbols
 * @returns {any[]}
 */
export function flattenSymbols(symbols) {
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

/**
 * Класс, в чьём диапазоне находится смещение (самый вложенный).
 * @param {any[]} symbols
 * @param {number} offset
 * @returns {any|undefined}
 */
export function enclosingClass(symbols, offset) {
    let best = undefined;
    let bestSpan = Number.POSITIVE_INFINITY;
    for (const symbol of symbols) {
        if (symbol.kind !== 'class') continue;
        const startOffset = offsetOf(symbol, symbol.range.start);
        const endOffset = offsetOf(symbol, symbol.range.end);
        if (offset >= startOffset && offset <= endOffset) {
            const span = endOffset - startOffset;
            if (span < bestSpan) {
                best = symbol;
                bestSpan = span;
            }
        }
    }
    return best;
}

/** @param {any} symbol @param {{line: number, character: number}} position */
function offsetOf(symbol, position) {
    const starts = symbol._starts || [0];
    const line = Math.min(position.line, starts.length - 1);
    return (starts[line] || 0) + position.character;
}

/**
 * Поля класса по имени.
 * @param {any[]} symbols
 * @param {string} className
 * @returns {any[]}
 */
export function fieldsOfClass(symbols, className) {
    const cls = findSymbol(symbols, className, ['class']);
    return cls ? cls.children.filter((c) => c.kind === 'field') : [];
}

/**
 * Методы класса по имени.
 * @param {any[]} symbols
 * @param {string} className
 * @returns {any[]}
 */
export function methodsOfClass(symbols, className) {
    const cls = findSymbol(symbols, className, ['class']);
    return cls ? cls.children.filter((c) => c.kind === 'method') : [];
}

/**
 * Пытается определить класс/тип переменной по её объявлению или параметру.
 * Поддерживает `let x = new Class(...)`, `let x: Class = ...`, `x: Class` в
 * параметрах, а также вывод `array`/`channel`/`tensor`/`ai` по инициализатору.
 * @param {string} text
 * @param {string} name
 * @param {any[]} symbols
 * @returns {string|undefined}
 */
export function classOfVariable(text, name, symbols) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Специальные «встроенные владельцы» методов — до проверки пользовательских типов.
    const specials = [
        [new RegExp(`\\blet\\s+${escaped}\\s*=\\s*\\[`), 'array'],
        [new RegExp(`\\blet\\s+${escaped}\\s*=\\s*channel\\s*[<(]`), 'channel'],
        [new RegExp(`\\blet\\s+${escaped}\\s*=\\s*tensor\\s*\\(`), 'tensor'],
        [new RegExp(`\\blet\\s+${escaped}\\s*=\\s*ai\\s*\\.`), 'ai'],
        [new RegExp(`\\blet\\s+${escaped}\\s*=\\s*ai_embed\\s*\\(`), 'array'],
    ];
    for (const [re, owner] of specials) {
        if (re.test(text)) return owner;
    }

    const patterns = [
        new RegExp(`\\blet\\s+${escaped}\\s*=\\s*new\\s+([A-Za-z_][A-Za-z0-9_]*)`),
        new RegExp(`\\blet\\s+${escaped}\\s*:\\s*\\[`),
        new RegExp(`\\blet\\s+${escaped}\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)`),
        new RegExp(`\\b${escaped}\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)`),
    ];
    for (const re of patterns) {
        const match = re.exec(text);
        if (!match) continue;
        if (match[1] === undefined) return 'array';
        const candidate = match[1];
        if (findSymbol(symbols, candidate, ['class'])) return candidate;
        if (['int', 'float', 'bool', 'string', 'channel', 'array', 'tensor', 'ai'].includes(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
