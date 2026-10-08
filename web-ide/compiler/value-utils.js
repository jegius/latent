// compiler/value-utils.js — runtime-значения и чистые помощники Latent.
// Единственная ответственность: truthiness, глубокое сравнение, форматирование,
// тензоры, семантические векторы и диспетчеризация методов.

import { Channel } from './environment.js';
import { Instance } from './oop.js';

/** Tensor — многомерный массив с формой. */
export class Tensor {
    constructor(data, shape) {
        this.data = data;
        this.shape = shape || inferShape(data);
    }
    get rank() { return this.shape.length; }
}

/** Выводит форму вложенного массива. */
export function inferShape(data) {
    const shape = [];
    let cur = data;
    while (Array.isArray(cur)) {
        shape.push(cur.length);
        cur = cur[0];
    }
    return shape;
}

export function isTensor(v) { return v instanceof Tensor; }

/** Плоское представление тензора (для matmul/cosine). */
export function flatTensor(t) {
    if (isTensor(t)) return t.data.flat(Infinity);
    if (Array.isArray(t)) return t.flat(Infinity);
    return [t];
}

export function isTruthy(value) {
    if (value === null || value === undefined || value === false) return false;
    if (value === 0) return false;
    return true;
}

export function deepEqual(a, b) {
    if (a === b) return true;
    if (isTensor(a) && isTensor(b)) {
        return JSON.stringify(a.shape) === JSON.stringify(b.shape)
            && deepEqual(a.data, b.data);
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        return ka.every(k => deepEqual(a[k], b[k]));
    }
    return false;
}

export function formatValue(value) {
    if (value === null || value === undefined) return 'null';
    if (isTensor(value)) return `Tensor(shape=[${value.shape.join(', ')}], data=${formatValue(value.data)})`;
    if (Array.isArray(value)) return '[' + value.map(v => formatValue(v)).join(', ') + ']';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value && value.__promise) return formatValue(value.value);
    if (value && value.__tag) return value.value === undefined
        ? value.__tag : `${value.__tag}(${formatValue(value.value)})`;
    if (value && value.__semantic) return `Semantic(${value.text})`;
    if (typeof value === 'object' && value !== null) {
        return '{' + Object.entries(value).map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ') + '}';
    }
    return String(value);
}

/** Скалярное произведение двух векторов. */
export function dot(a, b) {
    let s = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
    return s;
}

export function magnitude(a) {
    return Math.sqrt(dot(a, a));
}

/** Косинусная близость двух векторов (тензоров/массивов). */
export function cosineSimilarity(a, b) {
    const va = flatTensor(a);
    const vb = flatTensor(b);
    const denom = magnitude(va) * magnitude(vb);
    if (denom === 0) return 0;
    return dot(va, vb) / denom;
}

/**
 * Умножение матриц. Поддерживает 2D×2D, 2D×1D и 1D×2D.
 * @returns {Tensor}
 */
export function matmul(a, b) {
    const ma = toMatrix(a);
    const mb = toMatrix(b);
    const n = ma.length, m = mb[0].length, k = mb.length;
    if (ma[0].length !== k) {
        throw new Error(`matmul: shape mismatch [${ma.length},${ma[0].length}] x [${mb.length},${mb[0].length}]`);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push([]);
        for (let j = 0; j < m; j++) {
            let s = 0;
            for (let p = 0; p < k; p++) s += ma[i][p] * mb[p][j];
            out[i].push(s);
        }
    }
    return new Tensor(out, [n, m]);
}

function toMatrix(v) {
    const d = isTensor(v) ? v.data : v;
    if (Array.isArray(d) && Array.isArray(d[0])) return d;
    if (Array.isArray(d)) return [d];
    return [[d]];
}

/**
 * Диспетчер методов значений Latent. Экземпляры классов обрабатываются
 * интерпретатором отдельно (нужен доступ к окружению); здесь — встроенные типы.
 */
export function callMethod(obj, method, args) {
    if (obj instanceof Channel) {
        if (method === 'send') { obj.send(args[0]); return null; }
        if (method === 'recv') return obj.recv();
        if (method === 'try_recv') return obj.tryRecv();
        if (method === 'len') return obj.queue.length;
    }
    if (isTensor(obj)) {
        if (method === 'shape') return obj.shape;
        if (method === 'rank') return obj.rank;
        if (method === 'data') return obj.data;
        if (method === 'size') return flatTensor(obj).length;
        if (method === 'reshape') return new Tensor(reshape(obj.data.flat(Infinity), args[0]), args[0]);
    }
    if (Array.isArray(obj)) {
        if (method === 'push') { obj.push(args[0]); return obj; }
        if (method === 'pop') return obj.pop();
        if (method === 'length') return obj.length;
        if (method === 'len') return obj.length;
    }
    if (typeof obj === 'string') {
        if (method === 'length') return obj.length;
        if (method === 'len') return obj.length;
        if (method === 'upper') return obj.toUpperCase();
        if (method === 'lower') return obj.toLowerCase();
    }
    throw new Error(`Unknown method '${method}'`);
}

function reshape(flat, shape) {
    if (shape.length === 1) return flat.slice();
    const [rows, cols] = shape;
    const out = [];
    for (let i = 0; i < rows; i++) out.push(flat.slice(i * cols, (i + 1) * cols));
    return out;
}

export { Instance };