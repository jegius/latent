// test/parser-edge.test.js — граничные случаи лексера/парсера движка №1.
//
// Цель — реальные ветки разбора: паттерны match (в т.ч. default без `case`),
// лямбды, декораторы, аннотации типов, for-in без `let`, нетривиальные
// конструкции spawn/return/assert и восстановление после ошибок.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLatent, Parser, tokenize, Interpreter } from '../compiler-loader.js';

const run = (src, ai = false) => runLatent(src, ai);
const parse = (src) => new Parser(tokenize(src)).parseProgram();

// ---------- match: паттерны ----------

test('match: литералы строк/bool/null и default', async () => {
    const { result } = await run(
        'fn f(x) { return match x { case "s": 1, case true: 2, case false: 3,' +
        ' case null: 4, default: 0 }; }' +
        ' fn main() { return f("s") + f(true) + f(false) + f(null); }');
    assert.equal(result, 10);
});

test('match: default без ключевого слова case', async () => {
    const { result } = await run('fn main() { return match 1 { default: 5, }; }');
    assert.equal(result, 5);
});

test('match: ветка без case и без разделителя перед }', async () => {
    const { result } = await run('fn main() { return match 2 { 2: 20 }; }');
    assert.equal(result, 20);
});

test('match: wildcard `_` совпадает с любым значением', async () => {
    const { result } = await run('fn main() { return match [1, 2] { case _: 42 }; }');
    assert.equal(result, 42);
});

test('match: нуль-арный конструктор None()', async () => {
    const { result } = await run('fn main() { return match None() { case None(): 1, default: 0 }; }');
    assert.equal(result, 1);
});

test('match: недопустимый паттерн → ошибка с номером строки', () => {
    assert.throws(
        () => parse('fn main() { return match 1 { case @: 1 }; }'),
        /Invalid match pattern/);
});

test('match: отсутствует разделитель и скобка → ошибка разбора', () => {
    assert.throws(
        () => parse('fn main() { return match 1 { case 1: 10 20 } }'), /Expected \}/);
});

// ---------- Лямбды ----------

test('lambda: параметр с аннотацией типа', async () => {
    const { result } = await run(
        'fn main() { let f = fn(x: int) => x + 1; return f(1); }');
    assert.equal(result, 2);
});

test('lambda: без параметров', async () => {
    const { result } = await run('fn main() { let f = fn() => 5; return f(); }');
    assert.equal(result, 5);
});

test('lambda: нечисловой параметр → ошибка', () => {
    assert.throws(() => parse('fn main() { let f = fn(1) => 1; }'), /Expected lambda parameter/);
});

// ---------- Декораторы и аннотации типов ----------

test('декоратор без аргументов над функцией', async () => {
    const { result } = await run(
        '@test fn f() { return 1; } fn main() { return f(); }');
    assert.equal(result, 1);
});

test('декоратор с недопустимым именем → ошибка', () => {
    assert.throws(() => parse('@ 123 fn f() {}'), /Expected decorator name/);
});

test('аннотации типов: tuple, generic, пустой tuple, вложенный массив', () => {
    const ast = parse(
        'fn f(a: (int, string), b: channel<int>, c: (), d: [[int]]) -> (bool) { return true; }' +
        ' fn main() { return 0; }');
    assert.deepEqual(ast.functions.f.params, ['a', 'b', 'c', 'd']);
});

test('аннотация типа: недопустимый токен → ошибка', () => {
    assert.throws(() => parse('fn f(x: 123) {} fn main() {}'), /Invalid type annotation/);
});

// ---------- for-in и C-for ----------

test('for-in без let: for (x in [..])', async () => {
    const { result } = await run(
        'fn main() { let s = 0; for (x in [1, 2, 3]) { s = s + x; } return s; }');
    assert.equal(result, 6);
});

test('C-for: update как выражение (не присваивание)', async () => {
    const { result } = await run(
        'fn main() { let i = 0; for (let k = 0; i < 3; i + 0) { i = i + 1; } return i; }');
    assert.equal(result, 3);
});

// ---------- return/spawn/assert ----------

test('return без значения и перед }', async () => {
    const { result } = await run(
        'fn f() { return; } fn g() { if (true) { return } }' +
        ' fn main() { return [f(), g()]; }');
    assert.deepEqual(result, [null, null]);
});

test('spawn: не вызов и не блок → ошибка разбора', () => {
    assert.throws(() => parse('fn main() { spawn 5; }'), /spawn requires a function call or block/);
});

test('assert без скобок: assert cond;', async () => {
    const { result } = await run('fn main() { assert true; return 0; }');
    assert.equal(result, 0);
});

test('test-блок с идентификатором вместо строки', async () => {
    const program = parse('test mytest { assert(true); } fn main() { return 0; }');
    assert.equal(program.tests[0].name, 'mytest');
    const interp = new Interpreter(program, () => {});
    interp.run();
    assert.equal(interp.testResults[0].passed, true);
});

test('test как обычный идентификатор: let test = 5', async () => {
    const { result } = await run('fn main() { let test = 5; return test; }');
    assert.equal(result, 5);
});

// ---------- Выражения ----------

test('|| короткое замыкание: true || boom() не вычисляет правую часть', async () => {
    const { result } = await run(
        'fn boom() { return null[0]; } fn main() { return true || boom(); }');
    assert.equal(result, true);
});

test('сравнение с generic-подобным синтаксисом: a < 3', async () => {
    const { result } = await run('fn main() { let a = 2; let x = a < 3; return x; }');
    assert.equal(result, true);
});

test('class: поле без типа и метод без fn', () => {
    const ast = parse(
        'class A { x; fn m() { return 1; } }' +
        ' class B { n() { return 2; } } fn main() { return 0; }');
    assert.equal(ast.classes.A.fields[0].name, 'x');
    assert.equal(ast.classes.A.fields[0].type, null);
    assert.equal(ast.classes.A.methods[0].name, 'm');
    assert.equal(ast.classes.B.methods[0].name, 'n');
});

test('выражение-инструкция с индексом (без присваивания)', async () => {
    const { result } = await run('fn main() { let a = [1]; a[0]; return a[0]; }');
    assert.equal(result, 1);
});

test('незакрытая индексная скобка → ошибка', () => {
    assert.throws(() => parse('fn main() { let a = [1]; a[0; }'), /Expected \]/);
});

test('let с недопустимым именем → ошибка', () => {
    assert.throws(() => parse('fn main() { let 5 = 1; }'), /Expected identifier/);
});

test('new без скобок: new A', async () => {
    const { result } = await run(
        'class A { x: int; } fn main() { let a = new A; return a.x == null; }');
    assert.equal(result, true);
});

test('неожиданный токен в выражении → ошибка', () => {
    assert.throws(() => parse('fn main() { return @; }'), /Unexpected token/);
});
