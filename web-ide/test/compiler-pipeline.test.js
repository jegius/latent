// test/compiler-pipeline.test.js — компиляционный конвейер сервисного слоя.
//
// Проверяем CompilerService (компиляция/проверка синтаксиса), self-repair
// (успех, отказ, исчерпание попыток), детерминированный ремонт, статический
// анализ кода и детерминированные mock-AI помощники.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompilerService } from '../services/compiler-service.js';
import { analyzeCode, countSelfCalls } from '../compiler/analysis.js';
import { mockInfer, mockEmbed, simpleHash } from '../compiler/interpreter-ai.js';
import { configureAI, getAIConfig, Parser, tokenize, deterministicRepair } from '../compiler-loader.js';

// ---------- CompilerService ----------

test('compiler: checkSyntax валидный/невалидный', async () => {
    const svc = new CompilerService();
    assert.equal(await svc.checkSyntax('fn main() { return 1; }'), true);
    await assert.rejects(() => svc.checkSyntax('fn main() { let x = ; }'), /line 1/);
});

test('compiler: analyze возвращает метрики', () => {
    const stats = new CompilerService().analyze('fn main() { return 1; }');
    assert.equal(stats.functions, 1);
});

test('compiler: compile (движок №1) возвращает UTF-8 байты', async () => {
    const bytes = await new CompilerService().compile('abc');
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes), 'abc');
});

// ---------- Self-repair ----------

test('self-repair: нечего чинить → пробрасывает исходную ошибку', async () => {
    const svc = new CompilerService();
    await assert.rejects(
        () => svc.compileAndRunWithRepair('fn main() { return nope(); }', false, 3),
        /Undefined function/);
});

test('deterministicRepair: предыдущая строка уже завершена → null', () => {
    // Предыдущая строка кончается ';' — вставлять нечего.
    assert.equal(
        deterministicRepair('fn main() {\n    print(1);\n}', "Expected ; but got '}' at line 3"),
        null);
    // Предыдущая строка — открывающая скобка '{' — тоже не трогаем.
    assert.equal(
        deterministicRepair('fn main() {\n}', "Expected ; but got '}' at line 2"),
        null);
});

test('self-repair: успешный ремонт моделью (2 попытки)', async () => {
    const origFetch = globalThis.fetch;
    const origCfg = getAIConfig();
    globalThis.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: 'fn main() { return 42; }' } }] }),
    });
    configureAI({ provider: 'openai-compatible', model: 'm' });
    try {
        const out = await new CompilerService().compileAndRunWithRepair(
            'fn main() { return nope(); }', true, 3);
        assert.equal(out.result, 42);
        assert.equal(out.repaired, true);
        assert.equal(out.attempts, 2);
        assert.match(out.finalSource, /return 42/);
    } finally {
        configureAI(origCfg);
        globalThis.fetch = origFetch;
    }
});

test('self-repair: модель не чинит за 3 попытки → ошибка лимита', async () => {
    const origFetch = globalThis.fetch;
    const origCfg = getAIConfig();
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return {
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: 'fn main() { return nope();' } }] }),
        };
    };
    configureAI({ provider: 'openai-compatible', model: 'm' });
    try {
        await assert.rejects(
            () => new CompilerService().compileAndRunWithRepair('fn main() { return nope(); }', true, 3),
            /Self-repair failed after 3 attempts/);
        assert.equal(calls, 3);
    } finally {
        configureAI(origCfg);
        globalThis.fetch = origFetch;
    }
});

// ---------- Анализ кода ----------

test('analysis: некорректный код всё равно даёт метрики', () => {
    const stats = analyzeCode('fn main() { let x = ; }');
    assert.equal(stats.functions, 1);
    assert.equal(stats.complexity, 'O(1)');
    assert.ok(Array.isArray(stats.functionNames));
});

test('analysis: рекурсия без циклов → экспоненциальная оценка', () => {
    const stats = analyzeCode(
        'fn f(n) { if (n <= 1) { return 1; } return f(n - 1); } fn main() { return f(3); }');
    assert.equal(stats.recursiveCalls, 1);
    assert.equal(stats.complexity, 'O(n) — O(2^n)');
});

test('analysis: рекурсия с циклом → O(n log n)', () => {
    const stats = analyzeCode(
        'fn f(a) { for (let i = 0; i < 2; i = i + 1) { return f(a); } } fn main() { return f([1]); }');
    assert.equal(stats.recursiveCalls, 1);
    assert.equal(stats.complexity, 'O(n log n)');
});

test('countSelfCalls: нерекурсивные вызовы не считаются', () => {
    assert.equal(countSelfCalls({ type: 'Number', value: 1 }, 'f'), 0);
    assert.equal(countSelfCalls(null, 'f'), 0);
    assert.equal(countSelfCalls({ type: 'Call', callee: { type: 'Ident', name: 'g' }, args: [] }, 'f'), 0);
});

test('analyze: отдельный токен `ai` считается AI-вызовом', () => {
    const stats = analyzeCode('let x = ai;');
    assert.equal(stats.aiCalls, 1);
    const ast = new Parser(tokenize('fn main() { return 1; }')).parseProgram();
    assert.ok(ast.functions.main);
});

// ---------- Mock-AI помощники ----------

test('mockInfer: распознаёт сортировку, редукцию, рекурсию и границы', () => {
    assert.match(mockInfer('m', 'sort the array', simpleHash), /sorting pattern/);
    assert.match(mockInfer('m', 'sum all values', simpleHash), /reduction pattern/);
    assert.match(mockInfer('m', 'recursive call', simpleHash), /recursion detected/);
    assert.match(mockInfer('m', 'handle empty input', simpleHash), /empty input/);
    // Ни один паттерн не сработал → generic-инсайт, а не пустая строка
    const generic = mockInfer('m', 'привет', simpleHash);
    assert.match(generic, /^\[m\] .+\.$/);
});

test('mockEmbed/simpleHash: детерминированы и в ожидаемых диапазонах', () => {
    assert.deepEqual(mockEmbed('abc'), mockEmbed('abc'));
    assert.equal(mockEmbed('abc').length, 8);
    assert.ok(mockEmbed('abc').every(v => v >= -1 && v <= 1));
    assert.equal(simpleHash('abc'), simpleHash('abc'));
    assert.ok(simpleHash('abc') >= 0);
});
