// test/ai.test.js — тесты AI-функций движка №1 и self-repair.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    runLatent, analyzeCode, configureAI, getAIConfig,
    repairCode, deterministicRepair, extractCode,
    clearAICache, getAICacheSize,
} from '../compiler-loader.js';

test('AI выключен → ai_infer бросает ошибку', async () => {
    await assert.rejects(
        () => runLatent('fn main() { return ai_infer("m", "hi"); }', false),
        /AI is not enabled/);
});

test('mock ai_infer: детерминированный анализ чисел', async () => {
    const { result } = await runLatent(
        'fn main() { return ai_infer("gpt-4", "analyze 10 20 30"); }', true);
    assert.match(result, /detected 3 numeric values/);
    assert.match(result, /sum=60/);
});

test('mock ai_embed: детерминированный 8-мерный вектор', async () => {
    const { result } = await runLatent(
        'fn main() { return ai_embed("hello"); }', true);
    assert.equal(result.length, 8);
    // детерминированность
    const { result: r2 } = await runLatent(
        'fn main() { return ai_embed("hello"); }', true);
    assert.deepEqual(result, r2);
});

test('ai_stream + stream_next читают токены', async () => {
    const { result } = await runLatent(
        'fn main() { let h = ai_stream("m", "one two three");' +
        ' let a = stream_next(h); let b = stream_next(h); return a + " " + b; }', true);
    assert.match(result, /^\[m\]/);
});

test('анализ кода: метрики и сложность', () => {
    const stats = analyzeCode(
        'fn f(a) { for (let i = 0; i < a.length; i = i + 1) { print(a[i]); } }' +
        'fn main() { return f([1,2,3]); }');
    assert.equal(stats.functions, 2);
    assert.equal(stats.loops, 1);
    assert.equal(stats.complexity, 'O(n)');
});

test('анализ кода: двойной цикл → O(n²)', () => {
    const stats = analyzeCode(
        'fn main() { for (let i = 0; i < 3; i = i + 1) { for (let j = 0; j < 3; j = j + 1) { } } }');
    assert.equal(stats.complexity, 'O(n²)');
});

test('configureAI меняет конфигурацию', () => {
    const before = getAIConfig();
    configureAI({ provider: 'ollama', model: 'llama3' });
    assert.equal(getAIConfig().provider, 'ollama');
    assert.equal(getAIConfig().model, 'llama3');
    configureAI(before);
});

test('extractCode снимает markdown-ограждения', () => {
    const raw = 'Here you go:\n```latent\nfn main() { return 1; }\n```\n';
    assert.equal(extractCode(raw), 'fn main() { return 1; }');
});

test('extractCode без ограждений возвращает trim', () => {
    assert.equal(extractCode('  fn main() {}  '), 'fn main() {}');
});

test('deterministicRepair: вставляет ; перед }', () => {
    const src = 'fn main() {\n    let x = 1\n}';
    const fixed = deterministicRepair(src, "Expected ; but got '}' at line 3");
    assert.ok(fixed.includes('let x = 1;'));
});

test('deterministicRepair: закрывает несбалансированные скобки', () => {
    const fixed = deterministicRepair('fn main() { print(1);', 'Unexpected EOF');
    assert.ok(fixed.trimEnd().endsWith('}'));
});

test('deterministicRepair: null когда нечего чинить', () => {
    assert.equal(deterministicRepair('fn main() { return 1; }', 'unknown'), null);
});

test('repairCode в mock-режиме использует детерминированный ремонт', async () => {
    const before = getAIConfig();
    configureAI({ provider: 'mock' });
    const fixed = await repairCode('fn main() {\n let x = 1\n}', "Expected ; but got '}' at line 3", true);
    assert.ok(fixed.includes('let x = 1;'));
    configureAI(before);
});

test('AI-кэш: clearAICache/getAICacheSize', () => {
    clearAICache();
    assert.equal(getAICacheSize(), 0);
});