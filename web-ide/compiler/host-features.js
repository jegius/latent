// compiler/host-features.js — определение host-зависимых конструкций и
// распознавание ошибок движка №2 «требует host-рантайма».
//
// Единственная ответственность: по исходнику сказать, нужен ли полноценный
// host-рантайм движка №1, и помочь UI объяснить, почему движок №2 не подходит.
// Модуль не исполняет код и не зависит от DOM.

import { tokenize } from './lexer.js';
import { TokenType } from './token.js';

/** Человекочитаемая метка движка №1 для статус-бара и сообщений. */
export const ENGINE1_LABEL = 'engine #1 (host runtime)';
/** Человекочитаемая метка движка №2 для статус-бара и сообщений. */
export const ENGINE2_LABEL = 'engine #2 (rust→wasm)';

// Builtins движка №1, которых нет в кодогене движка №2 (host-примитивы).
const HOST_BUILTINS = new Set([
    'channel', 'tensor', 'semantic', 'matmul', 'cosine_similarity',
    'dot', 'magnitude', 'zeros', 'ones', 'snapshot',
    'ai_contract', 'enforce_contract',
    'ai_infer', 'ai_embed', 'ai_stream', 'stream_next', 'ai_generate',
]);

// Ключевые слова/конструкции, которым нужен планировщик/рантайм движка №1:
// каналы, goroutines, select, yield, тесты и контракты.
const HOST_KEYWORDS = new Set([
    'channel', 'spawn', 'select', 'yield',
    'test', 'forall', 'ai_contract', 'enforce_contract', 'snapshot',
]);

// Host-методы каналов (вызываются только через точку).
const HOST_METHODS = new Set(['send', 'recv', 'try_recv', 'close']);

// AI-примитивы, для которых движок №1 нужно включить (mock/гейтвей).
const AI_BUILTINS = new Set([
    'ai_infer', 'ai_embed', 'ai_stream', 'stream_next', 'ai_generate',
]);

// Тексты ошибок движка №2: русские (основной компилятор) и английские
// (документация/альтернативные сборки).
const HOST_RUNTIME_ERROR_RE =
    /требует\s+host-рантайма|requires?\s+(?:a\s+)?host[-\s]?runtime|host[-\s]?runtime/i;

/**
 * Прогоняет токены исходника через visitor. Если лексер упал (синтаксически
 * некорректный код), просто возвращает управление: решение об ошибке примет
 * интерпретатор движка №1.
 * @param {string} source
 * @param {(token: object, index: number, tokens: object[]) => void} visitor
 */
function scanTokens(source, visitor) {
    let tokens;
    try {
        tokens = tokenize(String(source ?? ''));
    } catch (e) {
        return;
    }
    for (let i = 0; i < tokens.length; i++) {
        visitor(tokens[i], i, tokens);
    }
}

/** true, если токен — идентификатор или ключевое слово. */
function isNameToken(token) {
    return token && (token.type === TokenType.Ident || token.type === TokenType.Keyword);
}

/**
 * Находит host-фичи в исходнике: каналы, spawn/select/yield, AI, тензоры,
 * тесты и контракты. Это консервативная проверка: она может отметить больше,
 * чем нужно, но никогда не пропустит конструкцию, которой нужен движок №1.
 * @param {string} source
 * @returns {{host: boolean, features: string[]}}
 */
export function detectHostFeatures(source) {
    const features = new Set();
    scanTokens(source, (token, index, tokens) => {
        if (token.type === TokenType.Op && token.value === '<-') {
            features.add('channel operator <-');
            return;
        }
        if (!isNameToken(token)) return;
        const name = String(token.value);
        if (HOST_BUILTINS.has(name) || HOST_KEYWORDS.has(name)) {
            features.add(name);
            return;
        }
        const prev = tokens[index - 1];
        if (HOST_METHODS.has(name) && prev &&
            prev.type === TokenType.Punct && prev.value === '.') {
            features.add(`.${name}()`);
        }
    });
    const list = [...features];
    return { host: list.length > 0, features: list };
}

/**
 * Находит AI-примитивы, для которых нужно включить AI-режим движка №1.
 * @param {string} source
 * @returns {{required: boolean, features: string[]}}
 */
export function detectAIFeatures(source) {
    const features = new Set();
    scanTokens(source, (token) => {
        if (!isNameToken(token)) return;
        const name = String(token.value);
        if (AI_BUILTINS.has(name)) features.add(name);
    });
    const list = [...features];
    return { required: list.length > 0, features: list };
}

/**
 * true, если ошибка движка №2 сообщает о нехватке host-рантайма.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isHostRuntimeError(error) {
    const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error ?? '');
    return HOST_RUNTIME_ERROR_RE.test(message);
}

/**
 * Короткий список фич для сообщения/статуса (не более max).
 * @param {string[]} features
 * @param {number} [max]
 * @returns {string}
 */
export function describeFeatures(features, max = 6) {
    const list = (features || []).filter(Boolean);
    if (list.length === 0) return '—';
    const shown = list.slice(0, max);
    return shown.join(', ') + (list.length > max ? `, … (+${list.length - max})` : '');
}

/**
 * Понятное пользователю объяснение ограничения движка №2.
 * @param {string[]} features — host-фичи, найденные в программе
 * @returns {string}
 */
export function explainEngine2HostLimit(features) {
    const list = (features || []).filter(Boolean);
    const used = list.length > 0
        ? `Программа использует: ${describeFeatures(list)}.`
        : 'Программа использует host-конструкции, которых нет в движке №2.';
    return [
        'Engine #2 (Rust → WASM) компилирует только подмножество языка без host-фич.',
        used,
        'Эти конструкции полностью поддерживает engine #1 (host runtime).',
    ].join('\n');
}
