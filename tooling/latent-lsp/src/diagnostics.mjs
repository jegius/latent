// tooling/latent-lsp/src/diagnostics.mjs — диагностика через компилятор-as-WASM.
//
// Компилятор возвращает текст ошибки на русском (иногда несколько сообщений,
// склеенных через "; "). Позиция встроена в текст: `... на строке L:C`
// (1-based, столбец в символах). Ошибки кодогенератора позиции не содержат —
// для них диагностика ставится на первую строку документа (это документировано
// в README как известное ограничение).
//
// Модуль не знает о JSON-RPC: возвращает массив LSP Diagnostic.

import { charColumnToUtf16, lineBounds, lineTextAt, lineCount } from './positions.mjs';

/** Источник диагностики в поле `source`. */
export const DIAGNOSTIC_SOURCE = 'latent';

/** Код для ошибок, которых нет в каталоге language.json. */
export const FALLBACK_CODE = 'LATENT_COMPILE_ERROR';

/** Регулярка позиции из сообщений компилятора. */
export const POSITION_RE = /на строке (\d+):(\d+)/;

/** LSP DiagnosticSeverity.Error */
export const SEVERITY_ERROR = 1;

/**
 * Компилирует исходник и превращает ошибку в LSP-диагностики.
 * @param {import('./wasm-compiler.mjs').WasmCompiler} compiler
 * @param {string} text
 * @param {import('./language-data.mjs').LanguageData} [languageData]
 * @returns {any[]}
 */
export function buildDiagnostics(compiler, text, languageData) {
    if (!compiler) return [];
    const result = compiler.compile(text);
    if (result.ok) return [];
    return parseCompilerError(result.error, text, languageData);
}

/**
 * Разбирает текст ошибки компилятора в массив диагностик.
 * @param {string} message
 * @param {string} text — исходник (нужен для пересчёта позиций и клампа)
 * @param {import('./language-data.mjs').LanguageData} [languageData]
 * @returns {any[]}
 */
export function parseCompilerError(message, text, languageData) {
    if (!message || typeof message !== 'string') return [];
    const source = typeof text === 'string' ? text : '';
    return splitMessages(message).map((part) => toDiagnostic(part, source, languageData));
}

/**
 * Компилятор склеивает несколько ошибок тайпчекера через "; ".
 * @param {string} message
 * @returns {string[]}
 */
export function splitMessages(message) {
    const trimmed = message.trim();
    if (!trimmed) return [];
    if (trimmed.includes('; ')) {
        const parts = trimmed.split('; ').map((part) => part.trim()).filter(Boolean);
        if (parts.length > 1) return parts;
    }
    return [trimmed];
}

/**
 * Одно сообщение → одна LSP-диагностика.
 * @param {string} message
 * @param {string} text
 * @param {import('./language-data.mjs').LanguageData} [languageData]
 * @returns {any}
 */
function toDiagnostic(message, text, languageData) {
    const range = messageRange(message, text);
    const code = languageData?.diagnosticCode(message) || FALLBACK_CODE;
    return {
        range,
        severity: SEVERITY_ERROR,
        source: DIAGNOSTIC_SOURCE,
        code,
        message,
    };
}

/**
 * Диапазон диагностики: по позиции `на строке L:C`, иначе — первая строка.
 * @param {string} message
 * @param {string} text
 * @returns {{start: {line: number, character: number}, end: {line: number, character: number}}}
 */
export function messageRange(message, text) {
    const totalLines = Math.max(1, lineCount(text));
    const match = POSITION_RE.exec(message);
    if (!match) {
        // Без позиции (ошибки кодогенератора): подсвечиваем начало файла.
        return rangeOfLine(text, 0);
    }
    const line = clampInt(Number.parseInt(match[1], 10) - 1, 0, totalLines - 1);
    const charColumn = Number.parseInt(match[2], 10);
    const character = charColumnToUtf16(text, line, charColumn);
    const { start, end } = lineBounds(text, line);
    const lineLength = Math.max(0, end - start);
    const clamped = clampInt(character, 0, lineLength);
    const endCharacter = clamped < lineLength ? clamped + 1 : clamped;
    return {
        start: { line, character: clamped },
        end: { line, character: endCharacter },
    };
}

/**
 * Диапазон строки (без EOL); для пустого текста даёт 0:0–0:0.
 * @param {string} text
 * @param {number} line
 */
function rangeOfLine(text, line) {
    const source = lineTextAt(text, line);
    const length = Math.min(1, source.length);
    return {
        start: { line, character: 0 },
        end: { line, character: length },
    };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clampInt(value, min, max) {
    const n = Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.min(Math.max(n, min), max);
}
