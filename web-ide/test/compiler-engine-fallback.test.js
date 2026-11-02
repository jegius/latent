// test/compiler-engine-fallback.test.js — выбор движка и фолбэк в CompilerService.
//
// Проверяем контракт: Run не показывает финальную ошибку движка №2; host-фичи
// и любые сбои engine #2 откатываются на engine #1 (host runtime), а явная
// компиляция compileWithEngine2 по-прежнему возвращает диагностику.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CompilerService } from '../services/compiler-service.js';
import {
    runLatent, detectHostFeatures, detectAIFeatures, isHostRuntimeError,
    describeFeatures, explainEngine2HostLimit,
    ENGINE1_LABEL, ENGINE2_LABEL,
} from '../compiler-loader.js';

test('CompilerService: host-программу не отправляет в engine #2', async () => {
    const svc = new CompilerService();
    let called = 0;
    svc.wasmCompiler = { compile: () => { called++; throw new Error('should not be called'); } };
    const run = await svc.compileAndRun(
        'fn main() -> int { let ch = channel(); ch.send(1); return ch.recv(); }', false);
    assert.equal(run.result, 1);
    assert.equal(called, 0, 'host-программу нельзя компилировать движком №2');
    assert.equal(run.compileEngine, '1');
    assert.equal(run.fallback, true);
});

test('CompilerService: ошибка engine #2 «требует host-рантайма» → фолбэк на engine #1', async () => {
    const svc = new CompilerService();
    svc.wasmCompiler = {
        compile: () => {
            throw new Error("Метод 'send' не поддерживается движком №2 (требует host-рантайма)");
        },
    };
    const run = await svc.compileAndRun('fn main() -> int { return 7; }', false);
    assert.equal(run.result, 7);
    assert.equal(run.compileEngine, '1');
    assert.equal(run.fallback, true);
    assert.ok(run.notes.some(n => n.includes('engine #1 (host runtime)')));
    assert.ok(!run.notes.some(n => n.startsWith("Метод 'send'")));
});

test('CompilerService: любая ошибка engine #2 не становится финальной для Run', async () => {
    const svc = new CompilerService();
    svc.wasmCompiler = { compile: () => { throw new Error('boom'); } };
    const run = await svc.compileAndRun('fn main() -> int { return 3 + 4; }', false);
    assert.equal(run.result, 7);
    assert.equal(run.compileEngine, '1');
    assert.ok(run.notes.some(n => n.includes('boom') && n.includes('engine #1')));
});

test('CompilerService: чистую программу по-прежнему компилирует engine #2', async () => {
    const svc = new CompilerService();
    const marker = new Uint8Array([0, 0x61, 0x73, 0x6d]);
    svc.wasmCompiler = { compile: () => marker };
    const run = await svc.compileAndRun('fn main() -> int { return 42; }', false);
    assert.equal(run.result, 42);
    assert.equal(run.compileEngine, '2');
    assert.equal(run.fallback, false);
    assert.deepEqual(run.bytecode, marker);
});

test('CompilerService: без engine #2 компилирует и исполняет engine #1', async () => {
    const svc = new CompilerService();
    const run = await svc.compileAndRun('fn main() -> int { return 5; }', false);
    assert.equal(run.result, 5);
    assert.equal(run.compileEngine, '1');
    assert.equal(run.fallback, false);
    assert.equal(run.engineLabel, ENGINE1_LABEL);
});

test('CompilerService: compileWithEngine2 требует загрузки и не подменяется фолбэком', async () => {
    const svc = new CompilerService();
    assert.throws(() => svc.compileWithEngine2('fn main() {}'), /not loaded/);
    const marker = new Uint8Array([1, 2, 3]);
    svc.wasmCompiler = { compile: () => marker };
    assert.deepEqual(svc.compileWithEngine2('ignored'), marker);
});

test('CompilerService: compile() сохраняет явный выбор engine #2', async () => {
    const svc = new CompilerService();
    const marker = new Uint8Array([9, 9]);
    svc.wasmCompiler = { compile: () => marker };
    assert.deepEqual(await svc.compile('fn main() {}'), marker);
});

test('runLatent: результаты test-блоков видны в выводе (ok и FAILED)', async () => {
    const ok = await runLatent(
        'test "ok" { assert(1 == 1); } fn main() { return 0; }', false);
    assert.ok(ok.output.includes('test "ok": ok'));
    const bad = await runLatent(
        'test "bad" { assert(1 == 2); } fn main() { return 0; }', false);
    assert.ok(bad.output.some(line => line.startsWith('test "bad": FAILED')));
});

test('detectHostFeatures: каналы, concurrency, AI, тензоры, контракты', () => {
    const sources = {
        channel: 'fn main() { let ch = channel(); }',
        send: 'fn main() { let ch = channel(); ch.send(1); }',
        recv: 'fn main() { let ch = channel(); ch.recv(); }',
        operator: 'fn main() { let ch = channel(); ch <- 1; }',
        spawn: 'fn main() { spawn worker(1); }',
        select: 'fn main() { select { default: { print(1); } } }',
        yield: 'fn main() { yield; }',
        ai: 'fn main() { return ai_infer("m", "p"); }',
        tensor: 'fn main() { return tensor([[1, 2]]); }',
        test: 'test "x" { assert(1 == 1); } fn main() {}',
        contract: '@ai_contract("x") fn f() {} fn main() {}',
    };
    for (const [name, source] of Object.entries(sources)) {
        const found = detectHostFeatures(source);
        assert.equal(found.host, true, `${name}: host не найден`);
        assert.ok(found.features.length > 0, name);
    }
});

test('detectHostFeatures: чистые программы и строки/комментарии не host', () => {
    assert.deepEqual(detectHostFeatures('fn main() -> int { return 1; }'),
        { host: false, features: [] });
    assert.deepEqual(detectHostFeatures(
        '// channel spawn select yield\nfn main() { print("tensor ai_infer"); }'),
    { host: false, features: [] });
    // `send` без точки — обычный идентификатор, не host-метод.
    assert.equal(detectHostFeatures(
        'fn main() { let send = 1; return send; }').host, false);
});

test('detectHostFeatures: синтаксически битый код не роняет детектор', () => {
    assert.deepEqual(detectHostFeatures('fn main() { let x = §; }'),
        { host: false, features: [] });
});

test('detectAIFeatures: находит AI-примитивы и не реагирует на остальное', () => {
    assert.deepEqual(detectAIFeatures('fn main() { return ai_infer("m", "p"); }'),
        { required: true, features: ['ai_infer'] });
    assert.deepEqual(detectAIFeatures('fn main() { return ai; }'),
        { required: false, features: [] });
    assert.deepEqual(detectAIFeatures('fn main() { return 1; }'),
        { required: false, features: [] });
});

test('isHostRuntimeError: русские/английские тексты и обычные ошибки', () => {
    assert.equal(isHostRuntimeError(
        "Метод 'send' не поддерживается движком №2 (требует host-рантайма)"), true);
    assert.equal(isHostRuntimeError('Builtin requires a host runtime'), true);
    assert.equal(isHostRuntimeError('host-runtime is required'), true);
    assert.equal(isHostRuntimeError(new Error('Undefined function')), false);
    assert.equal(isHostRuntimeError('plain string'), false);
    assert.equal(isHostRuntimeError(null), false);
});

test('describeFeatures/explainEngine2HostLimit: понятные сообщения', () => {
    assert.equal(describeFeatures([]), '—');
    assert.equal(describeFeatures(['channel', 'spawn']), 'channel, spawn');
    assert.match(describeFeatures(['a', 'b', 'c', 'd'], 2), /… \(\+2\)/);
    const explained = explainEngine2HostLimit(['channel', '.send()']);
    assert.match(explained, /Engine #2/);
    assert.match(explained, /channel, \.send\(\)/);
    assert.match(explained, /engine #1 \(host runtime\)/);
    assert.match(explainEngine2HostLimit([]), /host-конструкции/);
    assert.equal(ENGINE1_LABEL, 'engine #1 (host runtime)');
    assert.equal(ENGINE2_LABEL, 'engine #2 (rust→wasm)');
});
