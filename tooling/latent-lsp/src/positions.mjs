// tooling/latent-lsp/src/positions.mjs — мост между позициями LSP и смещениями в строке.
//
// LSP 3.17 требует позиции в UTF-16 code units внутри строки. В JS строки уже
// индексируются в UTF-16 code units, поэтому смещение = character напрямую.
// Компилятор Latent (Rust) считает столбцы в *символах* (code points) и с
// 1-based нумерацией, поэтому для диагностик нужен отдельный пересчёт:
// charColumnToUtf16 (1-based column из сообщения → 0-based UTF-16 character).

/**
 * Смещения начала каждой строки в тексте.
 * @param {string} text
 * @returns {number[]}
 */
export function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
}

/**
 * Границы строки без завершающего перевода строки.
 * @param {string} text
 * @param {number} line — 0-based
 * @param {number[]} [starts] — кеш lineStarts(text)
 * @returns {{start: number, end: number}}
 */
export function lineBounds(text, line, starts = lineStarts(text)) {
    const start = starts[line];
    if (start === undefined) return { start: text.length, end: text.length };
    let end = line < starts.length - 1 ? starts[line + 1] : text.length;
    if (end > start && text[end - 1] === '\n') end--;
    if (end > start && text[end - 1] === '\r') end--;
    return { start, end };
}

/**
 * Текст строки без перевода строки.
 * @param {string} text
 * @param {number} line
 * @returns {string}
 */
export function lineTextAt(text, line) {
    const { start, end } = lineBounds(text, line);
    return text.slice(start, end);
}

/**
 * Число строк в тексте (для клампа позиций).
 * @param {string} text
 * @returns {number}
 */
export function lineCount(text) {
    return lineStarts(text).length;
}

/**
 * LSP Position → смещение в тексте (UTF-16 code units).
 * Позиция клампится в границы документа, чтобы не падать на «конце файла».
 * @param {string} text
 * @param {{line: number, character: number}} position
 * @returns {number}
 */
export function positionToOffset(text, position) {
    const starts = lineStarts(text);
    const line = clampInt(position?.line ?? 0, 0, starts.length - 1);
    const { start, end } = lineBounds(text, line, starts);
    const character = clampInt(position?.character ?? 0, 0, end - start);
    return start + character;
}

/**
 * Смещение в тексте → LSP Position.
 * @param {string} text
 * @param {number} offset
 * @returns {{line: number, character: number}}
 */
export function offsetToPosition(text, offset) {
    const starts = lineStarts(text);
    const off = clampInt(offset, 0, text.length);
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= off) lo = mid;
        else hi = mid - 1;
    }
    const { start } = lineBounds(text, lo, starts);
    return { line: lo, character: Math.max(0, off - start) };
}

/**
 * Клампит позицию в границы документа.
 * @param {string} text
 * @param {{line: number, character: number}} position
 * @returns {{line: number, character: number}}
 */
export function clampPosition(text, position) {
    const starts = lineStarts(text);
    const line = clampInt(position?.line ?? 0, 0, Math.max(0, starts.length - 1));
    const { start, end } = lineBounds(text, line, starts);
    const character = clampInt(position?.character ?? 0, 0, Math.max(0, end - start));
    return { line, character };
}

/**
 * 1-based столбец компилятора (в code points) → 0-based UTF-16 character
 * внутри строки. Для BMP-символов (включая кириллицу) совпадает, для
 * суррогатных пар — учитывает их двухкодовость.
 * @param {string} text
 * @param {number} line — 0-based
 * @param {number} charColumn1 — столбец из сообщения компилятора (1-based)
 * @returns {number}
 */
export function charColumnToUtf16(text, line, charColumn1) {
    const source = lineTextAt(text, line);
    const target = Math.max(0, (charColumn1 | 0) - 1);
    let charIndex = 0;
    let utf16 = 0;
    for (const ch of source) {
        if (charIndex >= target) break;
        utf16 += ch.length;
        charIndex++;
    }
    return utf16;
}

/**
 * Строковый диапазон всей строки (без EOL).
 * @param {string} text
 * @param {number} line — 0-based
 * @returns {{start: {line: number, character: number}, end: {line: number, character: number}}}
 */
export function lineRange(text, line) {
    const { start, end } = lineBounds(text, line);
    return {
        start: { line, character: 0 },
        end: { line, character: end - start },
    };
}

/**
 * Диапазон всего документа.
 * @param {string} text
 * @returns {{start: {line: number, character: number}, end: {line: number, character: number}}}
 */
export function documentRange(text) {
    const start = { line: 0, character: 0 };
    const end = offsetToPosition(text, text.length);
    return { start, end };
}

/**
 * Создаёт диапазон по 0-based номерам строк/столбцов.
 * @param {number} line
 * @param {number} character
 * @param {number} [endCharacter]
 */
export function rangeAt(line, character, endCharacter = character) {
    return {
        start: { line, character },
        end: { line, character: endCharacter },
    };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampInt(value, min, max) {
    const n = Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.min(Math.max(n, min), max);
}
