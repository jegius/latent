// test/value-utils.test.js — чистые помощники runtime-значений движка №1.
//
// Tensor/формы, истинность, глубокое равенство, форматирование, matmul,
// диспетчеризация методов, окружение и модель экземпляров классов.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    Tensor, inferShape, isTensor, flatTensor, isTruthy, deepEqual,
    formatValue, dot, magnitude, cosineSimilarity, matmul, callMethod,
} from '../compiler/value-utils.js';
import {
    Channel, Environment, resolvedPromise, isPromise, taggedValue, isTagged,
} from '../compiler/environment.js';
import { Instance, findMethod, isInstance } from '../compiler/oop.js';

test('Tensor: ранг, форма по умолчанию и inferShape', () => {
    const t = new Tensor([[1, 2], [3, 4]]);
    assert.deepEqual(t.shape, [2, 2]);
    assert.equal(t.rank, 2);
    assert.deepEqual(inferShape([1, 2, 3]), [3]);
    assert.deepEqual(inferShape([]), [0]);
    assert.equal(isTensor(t), true);
    assert.equal(isTensor([]), false);
});

test('flatTensor: тензор, вложенный массив, скаляр', () => {
    assert.deepEqual(flatTensor(new Tensor([[1, 2], [3, 4]])), [1, 2, 3, 4]);
    assert.deepEqual(flatTensor([1, [2, 3]]), [1, 2, 3]);
    assert.deepEqual(flatTensor(5), [5]);
});

test('isTruthy: null/undefined/false/0 — ложь; прочее — истина', () => {
    for (const v of [null, undefined, false, 0]) assert.equal(isTruthy(v), false);
    for (const v of [1, -1, '', 'x', [], {}]) assert.equal(isTruthy(v), true);
});

test('deepEqual: примитивы, массивы, объекты, тензоры', () => {
    assert.ok(deepEqual(1, 1));
    assert.ok(deepEqual([1, [2]], [1, [2]]));
    assert.ok(!deepEqual([1], [1, 2]));
    assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
    assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1 }));
    assert.ok(deepEqual(new Tensor([1, 2], [2]), new Tensor([1, 2], [2])));
    assert.ok(!deepEqual(new Tensor([1, 2], [2]), new Tensor([1, 2], [1, 2])));
    assert.ok(!deepEqual(new Tensor([1, 2], [2]), new Tensor([1, 3], [2])));
    assert.ok(!deepEqual(1, '1'));
});

test('formatValue: null/tensor/массив/bool/promise/tag/semantic/объект', () => {
    assert.equal(formatValue(null), 'null');
    assert.equal(formatValue(undefined), 'null');
    assert.equal(formatValue(new Tensor([1, 2], [2])), 'Tensor(shape=[2], data=[1, 2])');
    assert.equal(formatValue([1, true, null]), '[1, true, null]');
    assert.equal(formatValue(false), 'false');
    assert.equal(formatValue(resolvedPromise(5)), '5');
    assert.equal(formatValue(taggedValue('Ok', 5)), 'Ok(5)');
    assert.equal(formatValue(taggedValue('None', undefined)), 'None');
    assert.equal(formatValue({ __semantic: true, text: 'hi' }), 'Semantic(hi)');
    assert.equal(formatValue({ a: 1 }), '{a: 1}');
    assert.equal(formatValue('x'), 'x');
});

test('dot/magnitude/cosineSimilarity: в т.ч. нулевая норма', () => {
    assert.equal(dot([1, 2], [3, 4]), 11);
    assert.equal(dot([1, 2], [3]), 3); // длина — по короткому вектору
    assert.equal(magnitude([3, 4]), 5);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test('matmul: 2D×2D, 2D×1D, 1D×2D, скаляр и несовместимые формы', () => {
    assert.deepEqual(matmul([[1, 2], [3, 4]], [[1, 0], [0, 1]]).data, [[1, 2], [3, 4]]);
    assert.deepEqual(matmul([[1, 2], [3, 4]], [[10], [20]]).shape, [2, 1]);
    assert.deepEqual(matmul([1, 2], [[10, 20], [30, 40]]).data, [[70, 100]]);
    assert.deepEqual(matmul(5, 3).data, [[15]]);
    assert.throws(() => matmul([[1, 2], [3, 4]], [[1, 2, 3]]), /shape mismatch/);
});

test('isPromise: true только для __promise-объектов', () => {
    assert.equal(isPromise(resolvedPromise(1)), true);
    assert.equal(isPromise({}), false);
    assert.equal(isPromise(null), false);
    assert.equal(isTagged(taggedValue('Ok', 1)), true);
    assert.equal(isTagged({}), false);
});

test('callMethod: каналы (send/recv/try_recv/len)', () => {
    const ch = new Channel(() => false);
    callMethod(ch, 'send', [5]);
    assert.equal(callMethod(ch, 'len', []), 1);
    assert.equal(callMethod(ch, 'recv', []), 5);
    assert.equal(callMethod(ch, 'try_recv', []), undefined);
    assert.throws(() => callMethod(ch, 'nope', []), /Unknown method 'nope'/);
});

test('callMethod: тензоры (shape/rank/data/size/reshape)', () => {
    const t = new Tensor([[1, 2], [3, 4]]);
    assert.deepEqual(callMethod(t, 'shape', []), [2, 2]);
    assert.equal(callMethod(t, 'rank', []), 2);
    assert.deepEqual(callMethod(t, 'data', []), [[1, 2], [3, 4]]);
    assert.equal(callMethod(t, 'size', []), 4);
    assert.deepEqual(callMethod(t, 'reshape', [[1, 4]]).data, [[1, 2, 3, 4]]);
    assert.deepEqual(callMethod(t, 'reshape', [[4]]).data, [1, 2, 3, 4]);
});

test('callMethod: массивы и строки', () => {
    const arr = [1];
    assert.equal(callMethod(arr, 'push', [2]), arr);
    assert.equal(callMethod(arr, 'pop', []), 2);
    assert.equal(callMethod(arr, 'length', []), 1);
    assert.equal(callMethod(arr, 'len', []), 1);
    assert.equal(callMethod('abc', 'length', []), 3);
    assert.equal(callMethod('abc', 'len', []), 3);
    assert.equal(callMethod('abc', 'upper', []), 'ABC');
    assert.equal(callMethod('ABC', 'lower', []), 'abc');
    assert.throws(() => callMethod([], 'boom', []), /Unknown method 'boom'/);
});

test('Instance/findMethod: поля, наследование, isInstance', () => {
    const inst = new Instance({ methods: [] }, new Map([['x', 1]]));
    assert.equal(inst.get('x'), 1);
    assert.equal(inst.get('missing'), undefined);
    inst.set('y', 2);
    assert.equal(inst.get('y'), 2);
    assert.equal(isInstance(inst), true);
    assert.equal(isInstance({}), false);

    const method = { name: 'm' };
    const parent = { methods: [method], parent: null };
    const child = { methods: [], parent };
    assert.equal(findMethod(child, 'm'), method);
    assert.equal(findMethod(child, 'nope'), null);
    const bare = { methods: [] }; // без parent — цикл завершается null
    assert.equal(findMethod(bare, 'x'), null);
});

test('Environment: define/get/set/has, родительские области и ошибки', () => {
    const global = new Environment();
    global.define('x', 1);
    assert.equal(global.get('x'), 1);
    assert.equal(global.has('x'), true);

    const local = new Environment(global);
    local.define('y', 2);
    assert.equal(local.get('x'), 1); // из родителя
    assert.equal(local.has('x'), true);
    assert.equal(local.has('zzz'), false);

    local.set('x', 10); // присваивание уходит в родителя
    assert.equal(global.get('x'), 10);
    local.set('y', 20);
    assert.equal(local.get('y'), 20);

    assert.throws(() => global.get('nope'), /Undefined variable 'nope'/);
    assert.throws(() => global.set('nope', 1), /Undefined variable 'nope'/);
    assert.throws(() => local.get('nope'), /Undefined variable 'nope'/);
});
