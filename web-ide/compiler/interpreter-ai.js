// compiler/interpreter-ai.js — чистые AI-mock помощники движка №1.
// Единственная ответственность: детерминированные mock-инференс и эмбеддинги.

/**
 * Контекстно-зависимый mock-инференс (fallback и offline-режим).
 * @param {string} model
 * @param {string} text
 * @param {(str: string) => number} simpleHash
 * @returns {string}
 */
export function mockInfer(model, text, simpleHash) {
    const numbers = text.match(/-?\d+(\.\d+)?/g);
    const insights = [];

    if (numbers && numbers.length > 0) {
        const nums = numbers.map(Number);
        const sum = nums.reduce((a, b) => a + b, 0);
        const mean = sum / nums.length;
        const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
        insights.push(`detected ${nums.length} numeric values (sum=${sum}, mean=${mean.toFixed(2)}, std=${Math.sqrt(variance).toFixed(2)})`);
    }
    if (/sort|order|partition/i.test(text)) {
        insights.push('sorting pattern recognized — comparison-based, lower bound O(n log n)');
    }
    if (/sum|total|reduce|aggregate/i.test(text)) {
        insights.push('reduction pattern — parallelizable via map-reduce');
    }
    if (/recursive|recursion/i.test(text)) {
        insights.push('recursion detected — verify base case reachability and stack depth');
    }
    if (/error|edge|empty|null/i.test(text)) {
        insights.push('consider explicit handling of empty input and boundary values');
    }

    if (insights.length === 0) {
        const hash = simpleHash(text);
        const generic = [
            'the code implements an efficient algorithm with good asymptotic behavior',
            'consider adding error handling for edge cases',
            'the structure is sound; profile before optimizing further',
            'the algorithm correctly partitions the input data',
        ];
        insights.push(generic[hash % generic.length]);
    }

    return `[${model}] ${insights.join('; ')}.`;
}

/**
 * Детерминированный mock-embedding (8 измерений для наглядности).
 * @param {string} text
 * @returns {number[]}
 */
export function mockEmbed(text) {
    const str = String(text);
    const embedding = [];
    for (let i = 0; i < 8; i++) {
        let h = 0;
        for (let j = 0; j < str.length; j++) {
            h = ((h << 5) - h + str.charCodeAt(j) * (i + 1)) | 0;
        }
        embedding.push(((h % 2000) - 1000) / 1000);
    }
    return embedding;
}

/**
 * Простой детерминированный строковый хэш.
 * @param {string} str
 * @returns {number}
 */
export function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}