// test/builtins.test.js — таблица встроенных функций движка №1.
//
// builtins — «стандартная библиотека» интерпретатора: печать, массивы, тензоры,
// каналы, Result/Option, assert, AI-примитивы и контракты. Проверяем контракты
// напрямую через buildBuiltins с интерпретатором-заглушкой.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertTruthy, assertEqual, structuralEqual, vectorOf, buildBuiltins,
} from '../compiler/interpreter-builtins.js';
import { Tensor } from '../compiler/value-utils.js';
import { Channel } from '../compiler/environment.js';

/** Интерпретатор-заглушка: фиксирует вывод и делегирует AI-методы. */
function fakeInterp() {
    const logs = [];
    return {
        logs,
        output: (text) => logs.push(text),
        stepScheduler: () => false,
        aiInfer: (model, prompt) => `[${model}] ${prompt}`,
        aiEmbed: (text) => [text.length, 1],
        aiStream: (model, prompt) => `stream:${model}:${prompt}`,
        streamNext: (handle) => `next:${handle}`,
        snapshot: (name) => name === 'ok',
    };
}

// ---------- Чистые помощники assert ----------

test('assertTruthy: истина не бросает, ложь бросает с сообщением', () => {
    assert.doesNotThrow(() => assertTruthy(1));
    assert.throws(() => assertTruthy(0), /assertion failed$/);
    assert.throws(() => assertTruthy(null, 'boom'), /assertion failed: boom/);
});

test('assertEqual/structuralEqual: вложенные структуры и тензоры', () => {
    assert.doesNotThrow(() => assertEqual([1, [2, 3]], [1, [2, 3]]));
    assert.throws(() => assertEqual([1, 2], [1, 3]), /assert_eq failed/);
    assert.throws(() => assertEqual(1, 2, 'msg'), /: msg$/);
    assert.ok(structuralEqual(new Tensor([1, 2], [2]), new Tensor([1, 2], [2])));
    assert.ok(!structuralEqual(new Tensor([1, 2], [2]), new Tensor([1, 2], [1, 2])));
    assert.ok(structuralEqual({ a: { b: 1 } }, { a: { b: 1 } }));
    assert.ok(!structuralEqual({ a: 1 }, { a: 1, b: 2 }));
    assert.ok(!structuralEqual(1, '1'));
});

test('vectorOf: semantic/Tensor/массив/скаляр', () => {
    assert.deepEqual(vectorOf({ __semantic: true, vector: [1, 2] }), [1, 2]);
    assert.deepEqual(vectorOf(new Tensor([[1, 2], [3, 4]])), [1, 2, 3, 4]);
    assert.deepEqual(vectorOf([5, 6]), [5, 6]);
    assert.deepEqual(vectorOf(7), [7]);
});

// ---------- Таблица builtins ----------

test('builtins: print форматирует значения через пробел', () => {
    const interp = fakeInterp();
    const b = buildBuiltins(interp);
    b.print([42, true, null, [1, 2]]);
    assert.deepEqual(interp.logs, ['42 true null [1, 2]']);
});

test('builtins: len для массива, строки и тензора', () => {
    const b = buildBuiltins(fakeInterp());
    assert.equal(b.len([[1, 2, 3]]), 3);
    assert.equal(b.len(['abcd']), 4);
    assert.equal(b.len([new Tensor([[1, 2], [3, 4]])]), 4);
});

test('builtins: push мутирует массив; range/zeros/ones', () => {
    const b = buildBuiltins(fakeInterp());
    const arr = [1];
    assert.equal(b.push([arr, 2]), arr);
    assert.deepEqual(arr, [1, 2]);
    assert.deepEqual(b.range([3]), [0, 1, 2]);
    assert.deepEqual(b.zeros([2]).data, [0, 0]);
    assert.deepEqual(b.ones([3]).data, [1, 1, 1]);
    assert.deepEqual(b.zeros([2]).shape, [2]);
});

test('builtins: channel с буфером и без', () => {
    const b = buildBuiltins(fakeInterp());
    const ch = b.channel([]);
    assert.ok(ch instanceof Channel);
    assert.equal(ch.buffer, 0);
    const buffered = b.channel([3]);
    assert.equal(buffered.buffer, 3);
});

test('builtins: tensor с явной формой и выведенной', () => {
    const b = buildBuiltins(fakeInterp());
    assert.deepEqual(b.tensor([[[1, 2], [3, 4]]]).shape, [2, 2]);
    assert.deepEqual(b.tensor([[1, 2, 3, 4], [4]]).shape, [4]);
});

test('builtins: semantic + cosine_similarity + matmul + dot + magnitude', () => {
    const b = buildBuiltins(fakeInterp());
    const a = b.semantic(['hello world']);
    const c = b.semantic(['hello world']);
    assert.equal(a.__semantic, true);
    assert.equal(a.text, 'hello world');
    assert.equal(a.vector.length, 8);
    assert.ok(Math.abs(b.cosine_similarity([a, c]) - 1) < 1e-9);
    const m = b.matmul([new Tensor([[1, 2], [3, 4]]), new Tensor([[5, 6], [7, 8]])]);
    assert.deepEqual(m.data, [[19, 22], [43, 50]]);
    assert.equal(b.dot([new Tensor([1, 2, 3]), new Tensor([4, 5, 6])]), 32);
    assert.ok(Math.abs(b.magnitude([new Tensor([3, 4])]) - 5) < 1e-9);
});

test('builtins: Result/Option — теги, unwrap, unwrap_or, предикаты', () => {
    const b = buildBuiltins(fakeInterp());
    const ok = b.Ok([5]);
    const err = b.Err(['bad']);
    const some = b.Some([7]);
    const none = b.None([]);
    assert.deepEqual(ok, { __tag: 'Ok', value: 5 });
    assert.deepEqual(none, { __tag: 'None', value: undefined });
    assert.equal(b.unwrap([ok]), 5);
    assert.equal(b.unwrap([some]), 7);
    assert.throws(() => b.unwrap([err]), /unwrap on Err: bad/);
    assert.throws(() => b.unwrap([none]), /unwrap on None/);
    assert.equal(b.unwrap([99]), 99); // не тегированное — как есть
    assert.equal(b.unwrap_or([none, 100]), 100);
    assert.equal(b.unwrap_or([err, 100]), 100);
    assert.equal(b.unwrap_or([ok, 100]), 5);
    assert.equal(b.unwrap_or([null, 100]), 100);
    assert.equal(b.unwrap_or([7, 100]), 7);
    assert.equal(b.is_ok([ok]), true);
    assert.equal(b.is_ok([err]), false);
    assert.equal(b.is_err([err]), true);
    assert.equal(b.is_some([some]), true);
    assert.equal(b.is_some([none]), false);
});

test('builtins: assert/assert_eq возвращают true или бросают', () => {
    const b = buildBuiltins(fakeInterp());
    assert.equal(b.assert([true]), true);
    assert.equal(b.assert([1 == 1, 'ok']), true);
    assert.throws(() => b.assert([false, 'boom']), /assertion failed: boom/);
    assert.equal(b.assert_eq([[1, 2], [1, 2]]), true);
    assert.equal(b.assert_eq([1, 1, 'msg']), true);
    assert.throws(() => b.assert_eq([1, 2, 'msg']), /assert_eq failed: 1 != 2: msg/);
});

test('builtins: AI-примитивы и контракты делегируют интерпретатору', () => {
    const b = buildBuiltins(fakeInterp());
    assert.equal(b.ai_infer(['m', 'p']), '[m] p');
    assert.deepEqual(b.ai_embed(['abc']), [3, 1]);
    assert.equal(b.ai_stream(['m', 'p']), 'stream:m:p');
    assert.equal(b.stream_next([7]), 'next:7');
    assert.deepEqual(b.ai_contract(['sorting']), { __contract: true, name: 'sorting' });
    assert.equal(b.enforce_contract([]), true);
    assert.equal(b.snapshot(['ok']), true);
});
