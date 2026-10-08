// test/interpreter.test.js — тесты tree-walking интерпретатора (движок №1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLatent, Interpreter, Channel } from '../compiler-loader.js';

async function run(src, withAI = false) {
    return runLatent(src, withAI);
}

test('арифметика и приоритеты', async () => {
    const { result } = await run('fn main() { return 2 + 3 * 4; }');
    assert.equal(result, 14);
});

test('строковая конкатенация и JS-коэрция чисел', async () => {
    const { result } = await run('fn main() { return "v" + 1 + "." + 0; }');
    assert.equal(result, 'v1.0');
});

test('deep equality массивов', async () => {
    const { result } = await run(
        'fn main() { return [1,[2,3],4] == [1,[2,3],4]; }');
    assert.equal(result, true);
});

test('рекурсия: factorial', async () => {
    const { result } = await run(
        'fn f(n) { if (n <= 1) { return 1; } return n * f(n - 1); } fn main() { return f(5); }');
    assert.equal(result, 120);
});

test('цикл for и массивы', async () => {
    const { result } = await run(
        'fn main() { let s = 0; for (let i = 1; i <= 5; i = i + 1) { s = s + i; } return s; }');
    assert.equal(result, 15);
});

test('строки: length', async () => {
    const { result } = await run('fn main() { return "abc".length; }');
    assert.equal(result, 3);
});

test('массивы: push/pop/length', async () => {
    const { result } = await run(
        'fn main() { let a = []; a.push(1); a.push(2); let x = a.pop(); return a.length + x; }');
    assert.equal(result, 3);
});

test('массивы: конкатенация через +', async () => {
    const { result } = await run('fn main() { return [1,2] + [3,4]; }');
    assert.deepEqual(result, [1, 2, 3, 4]);
});

test('short-circuit: false && throw не вычисляется', async () => {
    const { result } = await run(
        'fn boom() { return null[0]; } fn main() { return false && boom(); }');
    assert.equal(result, false);
});

test('spawn + channel: планировщик внутри recv', async () => {
    const { result, output } = await run(
        'fn worker(ch, n) { ch.send(n * n); }' +
        'fn main() { let ch = channel(); spawn worker(ch, 7); return ch.recv(); }');
    assert.equal(result, 49);
});

test('write-then-read: worker шлёт несколько значений', async () => {
    const { result } = await run(
        'fn producer(ch, n) { let i = 1; while (i <= n) { ch.send(i); i = i + 1; } }' +
        'fn main() { let ch = channel(); spawn producer(ch, 3); return ch.recv() + ch.recv() + ch.recv(); }');
    assert.equal(result, 6);
});

test('deadlock: recv на пустом канале без горутин бросает ошибку', async () => {
    await assert.rejects(
        () => run('fn main() { let ch = channel(); return ch.recv(); }'),
        /Deadlock/);
});

test('deadlock: оставшиеся горутины после main → ошибка', async () => {
    await assert.rejects(
        () => run('fn worker(ch) { ch.recv(); } fn main() { let ch = channel(); spawn worker(ch); }'),
        /Deadlock/);
});

test('recv wait limit: livelock-guard срабатывает', async () => {
    // Горутина ничего не шлёт в канал, но другие задачи есть → guard
    await assert.rejects(
        () => run(
            'fn busy() { let i = 0; while (i < 3) { i = i + 1; } }' +
            'fn main() { let ch = channel(); spawn busy(); return ch.recv(); }'),
        /Deadlock|wait limit/);
});

test('неопределённая функция', async () => {
    await assert.rejects(
        () => run('fn main() { return nope(); }'),
        /Undefined function/);
});

test('неопределённая переменная', async () => {
    await assert.rejects(
        () => run('fn main() { return zzz; }'),
        /Undefined variable/);
});

test('нет main', async () => {
    await assert.rejects(() => run('fn other() { return 1; }'), /main/);
});

test('loop limit защищает от вечного while', async () => {
    await assert.rejects(
        () => run('fn main() { while (true) { let x = 1; } }'),
        /Loop iteration limit/);
});

test('formatValue: массивы и bool', async () => {
    const { output } = await run('fn main() { print([1,2], true, null); }');
    assert.equal(output[0], '[1, 2] true null');
});

test('Channel: send/recv напрямую', () => {
    const ch = new Channel(() => false);
    ch.send(1);
    ch.send(2);
    assert.equal(ch.recv(), 1);
    assert.equal(ch.recv(), 2);
});

test('Channel: пустой + нет планировщика → deadlock', () => {
    const ch = new Channel(null);
    assert.throws(() => ch.recv(), /Deadlock/);
});

test('Interpreter: spawnCount/finishedCount', async () => {
    const { Parser } = await import('../compiler-loader.js');
    const { tokenize } = await import('../compiler-loader.js');
    const program = new Parser(tokenize(
        'fn w(ch) { ch.send(1); } fn main() { let ch = channel(); spawn w(ch); ch.recv(); }'
    )).parseProgram();
    const interp = new Interpreter(program, () => {});
    interp.run();
    assert.equal(interp.spawnCount, 1);
    assert.equal(interp.finishedCount, 1);
});