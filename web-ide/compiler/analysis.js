// compiler/analysis.js — статический анализ исходного кода Latent.
// Единственная ответственность: метрики и оценка сложности (вкладка AI Insights).

import { TokenType } from './token.js';
import { tokenize } from './lexer.js';
import { Parser } from './parser.js';

export function analyzeCode(source) {
    const tokens = tokenize(source);
    const stats = {
        functions: 0,
        loops: 0,
        conditionals: 0,
        arrays: 0,
        recursiveCalls: 0,
        aiCalls: 0,
        lines: source.split('\n').length,
        tokens: tokens.length,
    };

    const functionNames = new Set();
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === TokenType.Keyword && t.value === 'fn') {
            stats.functions++;
            if (tokens[i + 1]) functionNames.add(tokens[i + 1].value);
        }
        if (t.type === TokenType.Keyword && (t.value === 'for' || t.value === 'while')) stats.loops++;
        if (t.type === TokenType.Keyword && t.value === 'if') stats.conditionals++;
        if (t.type === TokenType.Punct && t.value === '[') stats.arrays++;
        if (t.type === TokenType.Keyword && t.value === 'ai') stats.aiCalls++;
    }

    // Рекурсия: функция вызывает саму себя. Работаем по AST, а не по токенам —
    // иначе любой вызов функции считался бы рекурсией.
    let recursiveCalls = 0;
    try {
        const program = new Parser(tokens).parseProgram();
        for (const fn of Object.values(program.functions)) {
            recursiveCalls += countSelfCalls(fn.body, fn.name);
        }
    } catch (e) {
        // Некорректный код — анализ всё равно должен вернуть метрики
    }
    stats.recursiveCalls = recursiveCalls;

    // Оценка сложности
    let complexity = 'O(1)';
    if (stats.loops > 0) complexity = 'O(n)';
    if (stats.loops > 1) complexity = 'O(n²)';
    if (stats.recursiveCalls > 0 && stats.loops > 0) complexity = 'O(n log n)';
    else if (stats.recursiveCalls > 0) complexity = 'O(n) — O(2^n)';

    return {
        ...stats,
        complexity,
        functionNames: [...functionNames],
    };
}

/**
 * Считает вызовы функции `name` внутри её собственного тела (рекурсия).
 * @param {object} node — узел AST
 * @param {string} name — имя функции
 * @returns {number}
 */
export function countSelfCalls(node, name) {
    if (!node || typeof node !== 'object') return 0;
    let count = 0;
    if (node.type === 'Call' && node.callee && node.callee.type === 'Ident'
        && node.callee.name === name) {
        count++;
    }
    for (const key of Object.keys(node)) {
        if (key === 'callee' && node.type === 'Call') {
            // callee не содержит рекурсивных вызовов сам по себе (это имя)
            continue;
        }
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) count += countSelfCalls(item, name);
        } else if (child && typeof child === 'object') {
            count += countSelfCalls(child, name);
        }
    }
    return count;
}