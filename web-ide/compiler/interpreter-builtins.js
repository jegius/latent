// compiler/interpreter-builtins.js — встроенные функции движка №1.
// Единственная ответственность: таблица builtins (структуры, каналы, тензоры,
// Result/Option, assert, AI-примитивы, контракты). Методы вызываются с `this`,
// привязанным к интерпретатору.

import { Channel } from './environment.js';
import { isTagged } from './environment.js';
import {
    formatValue, cosineSimilarity, matmul, Tensor, isTensor, flatTensor, dot, magnitude,
} from './value-utils.js';
import { mockEmbed } from './interpreter-ai.js';

/** Проверка истинности для assert. */
export function assertTruthy(cond, msg) {
    if (!cond) {
        throw new Error(`assertion failed${msg !== undefined ? ': ' + formatValue(msg) : ''}`);
    }
}

/** Проверка равенства для assert_eq (структурное). */
export function assertEqual(a, b, msg) {
    if (!structuralEqual(a, b)) {
        throw new Error(
            `assert_eq failed: ${formatValue(a)} != ${formatValue(b)}` +
            (msg !== undefined ? `: ${formatValue(msg)}` : ''));
    }
}

/** Структурное равенство без циклического импорта. */
export function structuralEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => structuralEqual(v, b[i]));
    }
    if (isTensor(a) && isTensor(b)) {
        return JSON.stringify(a.shape) === JSON.stringify(b.shape) && structuralEqual(a.data, b.data);
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        return ka.length === kb.length && ka.every(k => structuralEqual(a[k], b[k]));
    }
    return false;
}

/** Приводит значение к числовому вектору (Tensor/semantic/массив). */
export function vectorOf(v) {
    if (v && v.__semantic) return v.vector;
    if (isTensor(v)) return flatTensor(v);
    if (Array.isArray(v)) return v;
    return [v];
}

/**
 * Строит таблицу встроенных функций, привязанную к интерпретатору `interp`.
 * @param {import('./interpreter.js').Interpreter} interp
 * @returns {Object<string, function(any[]): any>}
 */
export function buildBuiltins(interp) {
    return {
        print: (args) => {
            interp.output(args.map(a => formatValue(a)).join(' '));
            return null;
        },
        len: (args) => isTensor(args[0]) ? flatTensor(args[0]).length : args[0].length,
        push: (args) => { args[0].push(args[1]); return args[0]; },
        channel: (args) => new Channel(() => interp.stepScheduler(), args[0] || 0),
        tensor: (args) => new Tensor(args[0], args[1] || undefined),
        semantic: (args) => ({
            __semantic: true, text: String(args[0]), vector: mockEmbed(String(args[0])),
        }),
        matmul: (args) => matmul(args[0], args[1]),
        cosine_similarity: (args) => cosineSimilarity(vectorOf(args[0]), vectorOf(args[1])),
        dot: (args) => dot(flatTensor(args[0]), flatTensor(args[1])),
        magnitude: (args) => magnitude(flatTensor(args[0])),
        zeros: (args) => new Tensor(new Array(args[0]).fill(0), [args[0]]),
        ones: (args) => new Tensor(new Array(args[0]).fill(1), [args[0]]),
        range: (args) => Array.from({ length: args[0] }, (_, i) => i),
        Ok: (args) => ({ __tag: 'Ok', value: args[0] }),
        Err: (args) => ({ __tag: 'Err', value: args[0] }),
        Some: (args) => ({ __tag: 'Some', value: args[0] }),
        None: () => ({ __tag: 'None', value: undefined }),
        unwrap: (args) => {
            const v = args[0];
            if (isTagged(v)) {
                if (v.__tag === 'Err') throw new Error(`unwrap on Err: ${formatValue(v.value)}`);
                if (v.__tag === 'None') throw new Error('unwrap on None');
                return v.value;
            }
            return v;
        },
        unwrap_or: (args) => {
            const v = args[0];
            if (isTagged(v)) return (v.__tag === 'None' || v.__tag === 'Err') ? args[1] : v.value;
            return v ?? args[1];
        },
        is_ok: (args) => isTagged(args[0]) && args[0].__tag === 'Ok',
        is_err: (args) => isTagged(args[0]) && args[0].__tag === 'Err',
        is_some: (args) => isTagged(args[0]) && args[0].__tag === 'Some',
        assert: (args) => { assertTruthy(args[0], args[1]); return true; },
        assert_eq: (args) => { assertEqual(args[0], args[1], args[2]); return true; },
        ai_infer: (args) => interp.aiInfer(args[0], args[1]),
        ai_embed: (args) => interp.aiEmbed(args[0]),
        ai_stream: (args) => interp.aiStream(args[0], args[1]),
        stream_next: (args) => interp.streamNext(args[0]),
        ai_contract: (args) => ({ __contract: true, name: String(args[0]) }),
        enforce_contract: () => true,
        snapshot: (args) => interp.snapshot(args[0]),
    };
}