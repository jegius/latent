// tooling/latent-lsp/src/analyzer.mjs — лёгкий анализ документа без полного
// парсера: объявления верхнего уровня и тела классов/enum.
//
// Весь язык живёт в одном файле (модулей нет), поэтому для documentSymbol и
// definition достаточно регулярно-структурного анализа: объявления Latent
// начинаются с ключевого слова в начале строки, а вложенность задаётся
// фигурными скобками. Полный AST-парсер здесь избыточен: LSP должен работать
// даже на недописанном коде.
//
// Навигация по найденным объявлениям (поиск символа, поля/методы класса,
// вывод типа переменной) вынесена в declarations.mjs и реэкспортируется ниже.

import { lineStarts, offsetToPosition } from './positions.mjs';

export {
    findSymbol,
    flattenSymbols,
    enclosingClass,
    fieldsOfClass,
    methodsOfClass,
    classOfVariable,
} from './declarations.mjs';

/** Регулярки объявлений верхнего уровня/в блоке (порядок важен). */
const DECLARATIONS = [
    { kind: 'fn', re: /^[ \t]*(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: 'class', re: /^[ \t]*class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: 'enum', re: /^[ \t]*enum\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: 'let', re: /^[ \t]*let\s+([A-Za-z_][A-Za-z0-9_]*)/ },
];

/** Поле класса: `x: int;` (без let, в отличие от локальной переменной). */
const CLASS_FIELD_RE = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_\[\]<>0-9, ]+);/;

/**
 * Символ документа (функция, класс, enum, переменная, поле, метод, тест).
 * @typedef {{
 *   name: string,
 *   kind: string,
 *   detail: string,
 *   line: number,
 *   range: {start: {line: number, character: number}, end: {line: number, character: number}},
 *   selectionRange: {start: {line: number, character: number}, end: {line: number, character: number}},
 *   nameOffset: number,
 *   children: any[],
 * }} DocSymbol
 */

/**
 * Собирает объявления документа.
 * @param {string} text
 * @returns {DocSymbol[]}
 */
export function scanSymbols(text) {
    const starts = lineStarts(text);
    const lines = text.split('\n');
    /** @type {DocSymbol[]} */
    const roots = [];
    /** @type {Array<{symbol: DocSymbol, depth: number}>} */
    const classStack = [];
    /** @type {Array<{symbol: DocSymbol, depth: number}>} */
    const fnStack = [];
    const commentState = { inBlock: false };
    let depth = 0;

    for (let li = 0; li < lines.length; li++) {
        const rawLine = lines[li];
        const lineStart = starts[li];

        // Класс/функция закончились, когда глубина скобок вернулась к их уровню.
        while (classStack.length > 0 && depth <= classStack[classStack.length - 1].depth) {
            classStack.pop();
        }
        while (fnStack.length > 0 && depth <= fnStack[fnStack.length - 1].depth) {
            fnStack.pop();
        }

        const currentClass = classStack.length > 0
            ? classStack[classStack.length - 1]
            : null;
        const currentFn = fnStack.length > 0 ? fnStack[fnStack.length - 1] : null;
        const inClassDirectScope = currentClass !== null && depth === currentClass.depth + 1;

        const symbol = detectDeclaration(rawLine, li, lineStart, text, starts);
        if (symbol) {
            if (symbol.kind === 'fn' && currentClass) {
                symbol.kind = 'method';
                currentClass.symbol.children.push(symbol);
            } else if (symbol.kind === 'let') {
                // Локальная переменная принадлежит ближайшей функции.
                if (currentFn && depth === currentFn.depth + 1) {
                    symbol.kind = 'variable';
                    currentFn.symbol.children.push(symbol);
                    continue;
                }
                if (depth !== 0) continue;
                roots.push(symbol);
            } else {
                roots.push(symbol);
            }
            if (symbol.kind === 'class') {
                classStack.push({ symbol, depth });
            }
            if (symbol.kind === 'fn' || symbol.kind === 'method') {
                fnStack.push({ symbol, depth });
            }
        } else if (inClassDirectScope) {
            // Поля класса: `name: type;` — единственное объявление без ключевого слова.
            const field = CLASS_FIELD_RE.exec(rawLine);
            if (field) {
                currentClass.symbol.children.push(buildSymbol({
                    name: field[1],
                    kind: 'field',
                    detail: `field ${field[1]}: ${field[2].trim()}`,
                    line: li,
                    nameOffset: lineStart + rawLine.indexOf(field[1]),
                    text,
                    rangeEnd: lineStart + rawLine.length,
                    starts,
                }));
            }
        }

        depth = Math.max(0, depth + braceDelta(rawLine, commentState));
    }

    // Упорядочим детей классов: поля, затем методы.
    for (const root of roots) {
        if (root.kind === 'class' && root.children.length > 1) {
            const fields = root.children.filter((c) => c.kind === 'field');
            const methods = root.children.filter((c) => c.kind !== 'field');
            root.children = [...fields, ...methods];
        }
    }
    return roots;
}

/**
 * Распознаёт объявление в строке.
 * @returns {DocSymbol|null}
 */
function detectDeclaration(rawLine, lineIndex, lineStart, text, starts) {
    // `test "name" { ... }` и `test("name") { ... }` — отдельная форма.
    const testMatch = /^[ \t]*test\s*\(?\s*"([^"]*)"/.exec(rawLine);
    if (testMatch) {
        const name = testMatch[1];
        const nameOffset = lineStart + rawLine.indexOf('"' + name + '"') + 1;
        return buildSymbol({
            name,
            kind: 'test',
            detail: `test "${name}"`,
            line: lineIndex,
            nameOffset,
            text,
            rangeEnd: findBlockEnd(text, lineStart),
            starts,
        });
    }

    for (const { kind, re } of DECLARATIONS) {
        const match = re.exec(rawLine);
        if (!match) continue;
        const name = match[1];
        const nameOffset = lineStart + rawLine.indexOf(name, match[0].indexOf(name));
        const isBlock = kind === 'fn' || kind === 'class' || kind === 'enum';
        return buildSymbol({
            name,
            kind,
            detail: describeDeclaration(rawLine, kind, name),
            line: lineIndex,
            nameOffset,
            text,
            rangeEnd: isBlock ? findBlockEnd(text, lineStart) : lineStart + rawLine.length,
            starts,
        });
    }
    return null;
}

/**
 * Человекочитаемое описание объявления (используется в hover/detail).
 * @param {string} rawLine
 * @param {string} kind
 * @param {string} name
 */
export function describeDeclaration(rawLine, kind, name) {
    const trimmed = rawLine.trim();
    if (kind === 'let') return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
    return trimmed;
}

/**
 * Создаёт символ с диапазонами.
 * @returns {DocSymbol}
 */
function buildSymbol({ name, kind, detail, line, nameOffset, text, rangeEnd, starts }) {
    const start = offsetToPosition(text, Math.max(0, nameOffset));
    const end = offsetToPosition(text, Math.max(0, nameOffset + name.length));
    const rangeStart = { line, character: 0 };
    const rangeEndPos = offsetToPosition(text, Math.max(rangeEnd, nameOffset + name.length));
    return {
        name,
        kind,
        detail,
        line,
        nameOffset,
        range: { start: rangeStart, end: rangeEndPos },
        selectionRange: { start, end },
        children: [],
        _starts: starts,
    };
}

/**
 * Находит конец блока `{ ... }`, начинающегося в строке с `fromOffset`.
 * Учитывает строки и комментарии, чтобы скобки в них не считались.
 * @param {string} text
 * @param {number} fromOffset
 * @returns {number} смещение за закрывающей скобкой (или конец строки)
 */
export function findBlockEnd(text, fromOffset) {
    let found = false;
    let depth = 0;
    let state = 'code';
    for (let i = fromOffset; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (state === 'line') {
            if (ch === '\n') state = 'code';
            continue;
        }
        if (state === 'block') {
            if (ch === '*' && next === '/') { state = 'code'; i++; }
            continue;
        }
        if (state === 'string') {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') state = 'code';
            continue;
        }
        if (ch === '/' && next === '/') { state = 'line'; i++; continue; }
        if (ch === '/' && next === '*') { state = 'block'; i++; continue; }
        if (ch === '"') { state = 'string'; continue; }
        if (ch === '{') { depth++; found = true; continue; }
        if (ch === '}') {
            depth--;
            if (found && depth <= 0) return i + 1;
        }
        if (ch === '\n' && !found) {
            // Скобка не встретилась в объявлении (например, `let`) — граница строки.
            return i;
        }
    }
    return text.length;
}

/**
 * Прирост глубины фигурных скобок в строке (вне строк/комментариев).
 * @param {string} line
 * @param {{inBlock: boolean}} state — состояние блочного комментария между строками
 * @returns {number}
 */
export function braceDelta(line, state) {
    let delta = 0;
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];
        if (state.inBlock) {
            if (ch === '*' && next === '/') { state.inBlock = false; i++; }
            continue;
        }
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '/' && next === '/') break;
        if (ch === '/' && next === '*') { state.inBlock = true; i++; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') delta++;
        else if (ch === '}') delta--;
    }
    return delta;
}
