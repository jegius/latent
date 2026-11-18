// test/engine1-extra.test.js — граничные семантики движка №1.
//
// Покрываем редкие ветки интерпретатора: структурные assert/assert_eq,
// присваивания в поля/индексы, for-in по разным типам, вложенные объявления,
// select-выражения с блоками, rethrow не-ReturnSignal и disabled AI-режим.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLatent, Parser, tokenize, Interpreter } from '../compiler-loader.js';
import { Environment, Channel } from '../compiler/environment.js';
import { Instance } from '../compiler/oop.js';

const run = (src, ai = false) => runLatent(src, ai);

/** Создаёт интерпретатор с пустой программой — для прямых вызовов. */
function emptyInterp() {
    return new Interpreter(new Parser(tokenize('fn main() {}')).parseProgram(), () => {});
}

// ---------- Утверждения ----------

test('assert_eq: структурное равенство массивов, объектов и Result', async () => {
    const { result } = await run(
        'fn main() { assert(1 == 1, "ok"); assert_eq([1, [2]], [1, [2]]);' +
        ' assert_eq(Ok(1), Ok(1)); assert_eq(Some("x"), Some("x")); return 7; }');
    assert.equal(result, 7);
});

test('assert/assert_eq: сообщение из третьего аргумента попадает в ошибку', async () => {
    await assert.rejects(() => run('fn main() { assert(false, "boom"); }'), /assertion failed: boom/);
    await assert.rejects(
        () => run('fn main() { assert_eq(1, 2, "msg"); }'), /assert_eq failed: 1 != 2: msg/);
});

// ---------- Присваивания ----------

test('FieldAssign: присваивание поля не-экземпляру → ошибка', async () => {
    await assert.rejects(
        () => run('fn main() { let x = 5; x.field = 1; return 0; }'),
        /Cannot assign field on non-instance/);
});

test('IndexAssign: запись в vector semantic-значения', async () => {
    const { result } = await run(
        'fn main() { let s = semantic("abc"); s[0] = 9; return s[0]; }');
    assert.equal(result, 9);
});

test('IndexAssign: вложенный индекс arr[arr[0]] = v', async () => {
    const { result } = await run(
        'fn main() { let a = [0, 1]; a[a[0]] = 7; return a[0]; }');
    assert.equal(result, 7);
});

// ---------- for-in по типам ----------

test('for-in: semantic итерируется по вектору (8 измерений)', async () => {
    const { result } = await run(
        'fn main() { let n = 0; for (let x in semantic("abc")) { n = n + 1; } return n; }');
    assert.equal(result, 8);
});

test('for-in: Result/Option отдаёт упакованное значение', async () => {
    const { result } = await run(
        'fn main() { let n = 0; for (let x in Ok(5)) { n = n + x; } return n; }');
    assert.equal(result, 5);
});

test('for-in: экземпляр класса итерируется по значениям полей', async () => {
    const { result } = await run(
        'class C { a: int; b: int; }' +
        ' fn main() { let c = new C(); let n = 0;' +
        ' for (let v in c) { if (v == null) { n = n + 1; } } return n; }');
    assert.equal(result, 2);
});

test('for-in: неитерируемое значение → понятная ошибка', async () => {
    await assert.rejects(
        () => run('fn main() { for (let x in 5) { } return 0; }'),
        /Value is not iterable: 5/);
});

// ---------- Вложенные объявления ----------

test('вложенная fn регистрируется и вызывается', async () => {
    const { result } = await run(
        'fn main() { fn helper() { return 5; } return helper(); }');
    assert.equal(result, 5);
});

test('вложенный class регистрируется и инстанцируется', async () => {
    const { result } = await run(
        'fn main() { class A { x: int; fn init() { this.x = 3; } }' +
        ' let a = new A(); return a.x; }');
    assert.equal(result, 3);
});

test('spawn: вызов метода (не прямой функции) → ошибка', async () => {
    await assert.rejects(
        () => run('class C { fn m() { return 1; } }' +
            ' fn main() { let c = new C(); spawn c.m(); return 0; }'),
        /spawn supports only direct function calls/);
});

// ---------- select как выражение ----------

test('select-выражение: пустой канал без горутин → deadlock', async () => {
    await assert.rejects(
        () => run('fn main() { let ch = channel(); return select { case v <- ch: v }; }'),
        /Deadlock: select/);
});

test('select-выражение: блок с return как значение ветки', async () => {
    const { result } = await run(
        'fn main() { let ch = channel(); ch <- 5;' +
        ' return select { case v <- ch: { let y = v * 2; return y; } default: 0 }; }');
    assert.equal(result, 10);
});

test('select-выражение: блок из нескольких инструкций без return → последнее значение', async () => {
    const { result } = await run(
        'fn main() { let ch = channel(); ch <- 5;' +
        ' return select { case v <- ch: { let t = v + 1; t * 2 } default: 0 }; }');
    assert.equal(result, 12);
});

test('select-выражение: ошибка в блоке без return пробрасывается', async () => {
    await assert.rejects(
        () => run('fn main() { let ch = channel(); ch <- 1;' +
            ' return select { case v <- ch: { let t = v; return null[0]; } default: 0 }; }'),
        (e) => e instanceof TypeError);
});

test('select-инструкция: default выполняется, когда канал пуст', async () => {
    const { result, output } = await run(
        'fn main() { let ch = channel();' +
        ' select { case v <- ch: { print(v); } default: { print(0); } } return 1; }');
    assert.equal(result, 1);
    assert.deepEqual(output, ['0']);
});

test('select-инструкция: пустой канал без default → deadlock', async () => {
    await assert.rejects(
        () => run('fn main() { let ch = channel(); select { case v <- ch: { } } return 1; }'),
        /Deadlock: select/);
});

test('test-блок внутри main игнорируется исполнителем', async () => {
    const { result } = await run(
        'fn main() { test "inner" { assert(true); } return 3; }');
    assert.equal(result, 3);
});

// ---------- Ошибки, пробрасываемые из вызовов/блоков ----------

test('метод класса: ошибка внутри метода пробрасывается наружу', async () => {
    await assert.rejects(
        () => run('class C { x: int; fn boom() { return null[0]; } }' +
            ' fn main() { let c = new C(); return c.boom(); }'),
        (e) => e instanceof TypeError);
});

test('match: блок-выражение без return даёт null', async () => {
    const { result } = await run(
        'fn main() { return match 1 { case 1: { let x = 2; }, default: 0 }; }');
    assert.equal(result, null);
});

test('match: ошибка внутри блока-выражения пробрасывается', async () => {
    await assert.rejects(
        () => run('fn main() { return match 1 { case 1: { return null[0]; }, default: 0 }; }'),
        (e) => e instanceof TypeError);
});

test('лямбда с блочным телом без return возвращает null', async () => {
    const { result } = await run(
        'fn main() { let f = fn(x) { x + 1 }; return f(1); }');
    assert.equal(result, null);
});

test('лямбда: ошибка в блочном теле пробрасывается (не ReturnSignal)', async () => {
    await assert.rejects(
        () => run('fn main() { let f = fn() { return null[0]; }; return f(); }'),
        (e) => e instanceof TypeError);
});

test('match: конструктор с двумя аргументами совпадает без связок', async () => {
    const { result } = await run(
        'fn main() { return match Ok(5) { case Ok(a, b): 1, default: 0 }; }');
    assert.equal(result, 1);
});

// ---------- Вызов результата выражения ----------

test('вызов результата выражения: (fn(x) => x*2)(21)', async () => {
    const { result } = await run('fn main() { return (fn(x) => x * 2)(21); }');
    assert.equal(result, 42);
});

test('вызов не-функции → «Not a function»', async () => {
    await assert.rejects(
        () => run('fn main() { return (5 + 1)(2); }'), /Not a function/);
});

// ---------- AI-режим ----------

test('ai_embed/ai_stream при выключенном AI → понятная ошибка', async () => {
    await assert.rejects(
        () => run('fn main() { return ai_embed("x"); }', false), /AI is not enabled/);
    await assert.rejects(
        () => run('fn main() { let h = ai_stream("m", "p"); return h; }', false),
        /AI is not enabled/);
});

test('stream_next для неизвестного handle → null', async () => {
    const { result } = await run('fn main() { return stream_next(999); }', true);
    assert.equal(result, null);
});

test('ai_stream: поток отдаёт токены до исчерпания', async () => {
    const { result } = await run(
        'fn main() { let h = ai_stream("m", "a b c");' +
        ' let n = 0; while (stream_next(h) != null) { n = n + 1; } return n; }', true);
    assert.ok(result > 0, `ожидались токены потока, получено ${result}`);
});

// ---------- Прямые вызовы интерпретатора ----------

test('Interpreter: неизвестные типы инструкций/выражений/операторов → ошибки', () => {
    const interp = emptyInterp();
    const env = new Environment();
    assert.throws(() => interp.execute({ type: 'Nope' }, env), /Unknown statement type: Nope/);
    assert.throws(() => interp.evaluate({ type: 'Nope' }, env), /Unknown expression type: Nope/);
    assert.throws(
        () => interp.evaluate({ type: 'Unary', op: '~', operand: { type: 'Number', value: 1 } }, env),
        /Unknown unary operator: ~/);
    assert.throws(
        () => interp.evaluate({
            type: 'Binary', op: '&',
            left: { type: 'Number', value: 1 }, right: { type: 'Number', value: 2 },
        }, env),
        /Unknown binary operator: &/);
});

test('Channel: закрытый канал — send бросает, recv отдаёт null', () => {
    const ch = new Channel(() => false);
    ch.close();
    assert.throws(() => ch.send(1), /send on closed channel/);
    assert.equal(ch.recv(), null);
    assert.equal(ch.tryRecv(), undefined);
});

test('Instance: поля по умолчанию и get несуществующего поля', () => {
    const inst = new Instance({ methods: [] });
    assert.equal(inst.get('x'), undefined);
    inst.set('x', 1);
    assert.equal(inst.get('x'), 1);
});

test('getVersion: версия JS-интерпретатора', async () => {
    const { getVersion } = await import('../compiler/loader.js');
    assert.equal(await getVersion(), '0.1.0-js-interp');
});
