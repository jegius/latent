// tooling/latent-lsp/src/context.mjs — лексический контекст курсора.
//
// Отвечает на четыре вопроса, нужных completion/hover/signature help:
//   * какое слово (или оператор) под курсором;
//   * какой префикс уже набран и где начинается его замена;
//   * если курсор после `.` — какой объект слева;
//   * если курсор внутри скобок вызова — какая функция и какой по счёту аргумент.
//
// Это не парсер: полноценный AST не нужен, а на недописанном коде он бы падал.
// Строки и комментарии при сканировании пропускаются, чтобы скобки в них не
// влияли на стек вызовов.

import { lineStarts } from './positions.mjs';

/** Двухсимвольные операторы языка (для hover на операторе). */
export const TWO_CHAR_OPERATORS = [
    '==', '!=', '<=', '>=', '&&', '||', '<-', '->', '=>', '<<', '>>', '::',
];

/** Односимвольные операторы/пунктуация (для hover). */
export const ONE_CHAR_OPERATORS = '=+-*/%<>!&|^~.:;,()[]{}@';

/** @param {string} ch */
export function isIdentChar(ch) {
    return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Смещение начала строки, содержащей offset.
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
export function lineStartOffset(text, offset) {
    const starts = lineStarts(text);
    let line = 0;
    for (let i = 1; i < starts.length; i++) {
        if (starts[i] <= offset) line = i;
        else break;
    }
    return starts[line];
}

/**
 * Слово (или оператор) под курсором.
 * @param {string} text
 * @param {number} offset
 * @returns {{word: string, start: number, end: number, kind: 'word'|'operator'}|null}
 */
export function wordAt(text, offset) {
    let start = Math.max(0, Math.min(offset, text.length));
    let end = start;
    while (start > 0 && isIdentChar(text[start - 1])) start--;
    while (end < text.length && isIdentChar(text[end])) end++;
    if (start !== end) {
        return { word: text.slice(start, end), start, end, kind: 'word' };
    }
    return operatorAt(text, offset);
}

/**
 * Оператор/пунктуация под курсором (учитывает, что курсор может стоять
 * внутри двухсимвольного оператора).
 * @param {string} text
 * @param {number} offset
 * @returns {{word: string, start: number, end: number, kind: 'operator'}|null}
 */
export function operatorAt(text, offset) {
    for (const op of TWO_CHAR_OPERATORS) {
        for (let start = offset - op.length + 1; start <= offset; start++) {
            if (start < 0) continue;
            if (text.slice(start, start + op.length) === op) {
                return { word: op, start, end: start + op.length, kind: 'operator' };
            }
        }
    }
    const ch = ONE_CHAR_OPERATORS.includes(text[offset]) ? text[offset] : text[offset - 1];
    if (ch && ONE_CHAR_OPERATORS.includes(ch)) {
        const start = text[offset] === ch ? offset : offset - 1;
        return { word: ch, start, end: start + 1, kind: 'operator' };
    }
    return null;
}

/**
 * Уже набранный префикс слова перед курсором.
 * @param {string} text
 * @param {number} offset
 * @returns {{prefix: string, start: number, end: number}}
 */
export function prefixAt(text, offset) {
    const end = Math.max(0, Math.min(offset, text.length));
    let start = end;
    while (start > 0 && isIdentChar(text[start - 1])) start--;
    return { prefix: text.slice(start, end), start, end };
}

/**
 * Контекст после точки: `obj.me|` → { object: 'obj', prefix: 'me' }.
 * @param {string} text
 * @param {number} offset
 * @returns {{object: string, prefix: string, start: number, isString: boolean, isThis: boolean}|null}
 */
export function memberContext(text, offset) {
    const { prefix, start } = prefixAt(text, offset);
    let j = start - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (j < 0 || text[j] !== '.') return null;

    let k = j - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    if (k >= 0 && text[k] === '"') {
        return { object: '', prefix, start, isString: true, isThis: false };
    }
    let objectStart = k;
    while (objectStart >= 0 && isIdentChar(text[objectStart])) objectStart--;
    const object = text.slice(objectStart + 1, k + 1);
    return { object, prefix, start, isString: false, isThis: object === 'this' };
}

/**
 * Находится ли курсор в контексте аннотации типа.
 * @param {string} text
 * @param {number} offset
 * @returns {boolean}
 */
export function isTypeContext(text, offset) {
    const line = text.slice(lineStartOffset(text, offset), offset);
    const stripped = line.replace(/[A-Za-z0-9_]*$/, '');
    if (/(:\s*|->\s*)$/.test(stripped)) return true;
    if (/(:\s*|->\s*)[^;{}]*\[\s*$/.test(stripped)) return true;
    if (/(:\s*|->\s*)[^;{}]*[A-Za-z_][A-Za-z0-9_]*<\s*$/.test(stripped)) return true;
    return false;
}

/**
 * Сканирует текст до offset и возвращает контекст вызова: имя функции, её
 * позицию и номер активного аргумента (по запятым верхнего уровня).
 * @param {string} text
 * @param {number} offset
 * @returns {{name: string, receiver: string, openOffset: number, calleeStart: number, activeParameter: number}|null}
 */
export function scanCallContext(text, offset) {
    const limit = Math.max(0, Math.min(offset, text.length));
    /** @type {Array<{name: string, receiver: string, openOffset: number, tokenStart: number, commas: number}>} */
    const stack = [];
    let state = 'code'; // code | line | block | string
    let ident = '';
    let identStart = -1;
    let pending = '';
    let pendingStart = -1;
    let receiver = '';

    for (let i = 0; i < limit; i++) {
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
        if (ch === '"') { state = 'string'; ident = ''; identStart = -1; pending = ''; pendingStart = -1; continue; }

        if (isIdentChar(ch)) {
            if (identStart < 0) identStart = i;
            ident += ch;
            continue;
        }
        if (/\s/.test(ch)) {
            // Пробел завершает идентификатор, но имя всё ещё может быть
            // именем вызываемой функции: `print (x)` — валидный вызов.
            if (ident) {
                pending = ident;
                pendingStart = identStart;
            }
            ident = '';
            identStart = -1;
            continue;
        }
        if (ch === '.') {
            const object = ident || pending;
            if (object) receiver = object;
            ident = '';
            identStart = -1;
            pending = '';
            pendingStart = -1;
            continue;
        }
        if (ch === '(') {
            const name = ident || pending;
            const tokenStart = ident ? identStart : pendingStart;
            stack.push({ name, receiver, openOffset: i, tokenStart, commas: 0 });
            ident = '';
            identStart = -1;
            pending = '';
            pendingStart = -1;
            receiver = '';
            continue;
        }
        if (ch === ')') {
            stack.pop();
            ident = '';
            identStart = -1;
            pending = '';
            pendingStart = -1;
            receiver = '';
            continue;
        }
        if (ch === ',') {
            if (stack.length > 0) stack[stack.length - 1].commas++;
            ident = '';
            identStart = -1;
            pending = '';
            pendingStart = -1;
            receiver = '';
            continue;
        }
        ident = '';
        identStart = -1;
        pending = '';
        pendingStart = -1;
        receiver = '';
    }

    const top = stack[stack.length - 1];
    if (!top) return null;
    return {
        name: top.name,
        receiver: top.receiver,
        openOffset: top.openOffset,
        calleeStart: top.tokenStart,
        activeParameter: top.commas,
    };
}

/**
 * Пересекает ли диапазон строки/комментария курсор (для подавления completion
 * внутри заведомо не-кодового контекста). Консервативно: только строки.
 * @param {string} text
 * @param {number} offset
 * @returns {boolean}
 */
export function isInsideString(text, offset) {
    let state = 'code';
    const limit = Math.max(0, Math.min(offset, text.length));
    for (let i = 0; i < limit; i++) {
        const ch = text[i];
        if (state === 'line') {
            if (ch === '\n') state = 'code';
            continue;
        }
        if (state === 'block') {
            if (ch === '*' && text[i + 1] === '/') { state = 'code'; i++; }
            continue;
        }
        if (state === 'string') {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') state = 'code';
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') { state = 'line'; i++; continue; }
        if (ch === '/' && text[i + 1] === '*') { state = 'block'; i++; continue; }
        if (ch === '"') state = 'string';
    }
    return state === 'string';
}
