// test/playground-host.test.js — полноценное исполнение host-фич в playground.
//
// Главный контракт браузерной IDE: обычный Run любой программы языка
// исполняется движком №1 (host runtime), даже если движок №2 уже загружен.
// Host-фичи (каналы, select/spawn/yield, AI, тензоры, контракты) не должны
// давать финальную ошибку «требует host-рантайма».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CompilerService } from '../services/compiler-service.js';
import { loadExamples } from '../examples.js';
import {
    configureAI, getAIConfig, clearAICache, ENGINE1_LABEL,
} from '../compiler-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WASM = join(__dirname, '..', 'compiler.wasm');

/** Сервис с реальным compiler.wasm, загруженным тем же путём, что в IDE. */
async function realService(t) {
    if (!existsSync(REAL_WASM)) {
        t.skip('compiler.wasm не собран');
        return null;
    }
    const bytes = readFileSync(REAL_WASM);
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(
            bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        clone() { return this; },
    });
    try {
        const svc = new CompilerService();
        const ok = await svc.ensureWasmCompiler({
            url: 'compiler.wasm', cacheName: 'playground-host-test',
        });
        assert.equal(ok, true, 'engine #2 должен загрузиться');
        return svc;
    } finally {
        globalThis.fetch = origFetch;
    }
}

/** Временно подменяет AI-конфигурацию и чистит кэш. */
async function withAIConfig(cfg, fn) {
    const before = getAIConfig();
    clearAICache();
    configureAI(cfg);
    try {
        return await fn();
    } finally {
        configureAI(before);
        clearAICache();
    }
}

test('playground: все примеры исполняются в обычном Run при загруженном engine #2', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    await withAIConfig({ provider: 'mock', model: 'mock' }, async () => {
        const examples = await loadExamples();
        assert.ok(examples.length >= 24, 'ожидались все примеры каталога');
        for (const ex of examples) {
            const run = await svc.compileAndRun(ex.code, false);
            assert.notEqual(run.result, undefined, `${ex.id}: result undefined`);
            assert.equal(run.engine, '1', `${ex.id}: исполнять должен engine #1`);
            assert.equal(run.engineLabel, ENGINE1_LABEL, `${ex.id}: метка движка`);
            assert.ok(!run.logs.some(line => /требует host-рантайма/.test(line)),
                `${ex.id}: host-ошибка движка №2 попала в вывод`);
        }
    });
});

test('playground: channels.lat в обычном Run не даёт «требует host-рантайма»', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    const ex = (await loadExamples()).find(e => e.id === 'channels');
    const run = await svc.compileAndRun(ex.code, false);
    assert.equal(run.result, 730);
    assert.equal(run.compileEngine, '1');
    assert.equal(run.fallback, true);
    assert.ok(run.hostFeatures.includes('channel'));
    assert.ok(run.hostFeatures.includes('.send()'));
    assert.ok(run.hostFeatures.includes('.recv()'));
    assert.ok(run.notes.some(n => n.includes(ENGINE1_LABEL)));
    assert.ok(run.logs.includes('fan-in total: 730'));
    assert.ok(!run.logs.some(line => /требует host-рантайма/.test(line)));
});

test('playground: select_yield.lat исполняет select/yield/<- в engine #1', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    const ex = (await loadExamples()).find(e => e.id === 'select-yield');
    const run = await svc.compileAndRun(ex.code, false);
    assert.equal(run.result, 114);
    assert.equal(run.fallback, true);
    assert.ok(run.hostFeatures.includes('select'));
    assert.ok(run.hostFeatures.includes('yield'));
    assert.ok(run.hostFeatures.includes('channel operator <-'));
    assert.ok(run.logs.includes('first = 1 second = 4 third = 9'));
});

test('playground: parallel_sum.lat считает сумму квадратов через spawn', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    const ex = (await loadExamples()).find(e => e.id === 'parallel-sum');
    const run = await svc.compileAndRun(ex.code, false);
    assert.equal(run.result, 333833500);
    assert.equal(run.fallback, true);
    assert.ok(run.hostFeatures.includes('spawn'));
    assert.ok(run.logs.includes('Total sum of squares 1^2..1000^2: 333833500'));
});

test('playground: AI-примеры в обычном Run используют mock без сети и не падают', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    let fetchCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalls++; throw new Error('network must not be used'); };
    try {
        await withAIConfig({ provider: 'ollama', model: 'm' }, async () => {
            const examples = await loadExamples();
            const infer = examples.find(e => e.id === 'ai-infer');
            const run = await svc.compileAndRun(infer.code, false);
            assert.equal(run.aiEnabled, true);
            assert.equal(run.result, 0);
            assert.match(run.logs.join('\n'), /AI analysis: \[gpt-4\]/);
            assert.ok(run.notes.some(n => n.includes('mock-режиме')));
            assert.equal(fetchCalls, 0, 'обычный Run не должен ходить в гейтвей');

            const streaming = examples.find(e => e.id === 'ai-streaming');
            const streamRun = await svc.compileAndRun(streaming.code, false);
            assert.equal(streamRun.result, 8);
            assert.match(streamRun.logs.join('\n'), /token 0 : \[gpt-4\]/);
        });
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('playground: Run with AI по-прежнему использует настроенный гейтвей', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        calls++;
        return { ok: true, status: 200, json: async () => ({ response: 'REMOTE-ANSWER' }) };
    };
    try {
        await withAIConfig({ provider: 'ollama', model: 'm' }, async () => {
            const run = await svc.compileAndRun(
                'fn main() { return ai_infer("m", "analyze 1 2 3"); }', true);
            assert.equal(run.result, 'REMOTE-ANSWER');
            assert.equal(calls, 1);
        });
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('playground: tensors.lat исполняет tensor/matmul/semantic в engine #1', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    const ex = (await loadExamples()).find(e => e.id === 'tensors');
    const run = await svc.compileAndRun(ex.code, false);
    assert.equal(run.result, 21);
    assert.equal(run.fallback, true);
    for (const feature of ['tensor', 'matmul', 'semantic', 'cosine_similarity']) {
        assert.ok(run.hostFeatures.includes(feature), feature);
    }
    assert.ok(run.logs.includes('matmul[0][0] = 19'));
    assert.ok(run.logs.includes('C shape = [2, 2]'));
});

test('playground: testing_contracts.lat исполняет test/snapshot/контракты', async (t) => {
    const svc = await realService(t);
    if (!svc) return;
    const ex = (await loadExamples()).find(e => e.id === 'testing-contracts');
    const run = await svc.compileAndRun(ex.code, false);
    assert.equal(run.result, 1);
    assert.equal(run.fallback, true);
    for (const feature of ['test', 'snapshot', 'ai_contract', 'enforce_contract']) {
        assert.ok(run.hostFeatures.includes(feature), feature);
    }
    assert.ok(run.logs.includes('contracts active'));
    assert.ok(run.logs.includes('test "arithmetic": ok'));
    assert.ok(run.logs.includes('test "arrays": ok'));
});
