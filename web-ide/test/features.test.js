// test/features.test.js — тесты продвинутых фич движка №1 и их AST.
// Покрывают: классы/OOP, match, async/await, select/yield/spawn-block,
// каналы `<-`, тензоры/semantic, тесты/assert/@forall/snapshot/контракты,
// лямбды и for-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLatent, Parser, tokenize, TokenType, Interpreter } from '../compiler-loader.js';

const run = (src, ai = false) => runLatent(src, ai);

// ---------- Лексер: новые операторы/ключевые слова ----------

test('lexer: трёхсимвольные/двухсимвольные операторы <- и =>', () => {
    const ops = tokenize('a <- b => c').filter(t => t.type === TokenType.Op).map(t => t.value);
    assert.deepEqual(ops, ['<-', '=>']);
});

test('lexer: @ как пунктуация и мягкие ключевые слова', () => {
    const tokens = tokenize('@forall("x") test assert_eq');
    assert.equal(tokens[0].value, '@');
    assert.equal(tokens[1].value, 'forall');
    assert.equal(tokens.filter(t => t.type === TokenType.Keyword).length, 3);
});

test('lexer: channel<int>() разбирается (generic-аргументы)', () => {
    const ast = new Parser(tokenize('fn main() { let ch = channel<int>(); }')).parseProgram();
    const stmt = ast.functions.main.body.statements[0];
    assert.equal(stmt.value.callee.name, 'channel');
});

// ---------- Классы и OOP ----------

test('OOP: поля, init, метод и this', async () => {
    const { result } = await run(
        'class Point { x: int; y: int; fn init(x, y) { this.x = x; this.y = y; }' +
        ' fn norm2() { return this.x * this.x + this.y * this.y; } }' +
        ' fn main() { let p = new Point(3, 4); return p.norm2(); }');
    assert.equal(result, 25);
});

test('OOP: мутация поля через this', async () => {
    const { result } = await run(
        'class C { n: int; fn init() { this.n = 0; }' +
        ' fn inc() { this.n = this.n + 1; return this.n; } }' +
        ' fn main() { let c = new C(); c.inc(); return c.inc(); }');
    assert.equal(result, 2);
});

test('OOP: новый экземпляр не разделяет состояние', async () => {
    const { result } = await run(
        'class C { n: int; fn init() { this.n = 0; } fn inc() { this.n = this.n + 1; return this.n; } }' +
        ' fn main() { let a = new C(); let b = new C(); a.inc(); a.inc(); return b.inc(); }');
    assert.equal(result, 1);
});

test('OOP: неизвестный класс → ошибка', async () => {
    await assert.rejects(() => run('fn main() { let x = new Nope(); }'), /Undefined class/);
});

test('парсер: class даёт узел Class с методами', () => {
    const ast = new Parser(tokenize('class A { x: int; fn m() { return 1; } } fn main() { return 1; }')).parseProgram();
    assert.ok(ast.classes.A);
    assert.equal(ast.classes.A.fields[0].name, 'x');
    assert.equal(ast.classes.A.methods[0].name, 'm');
});

// ---------- Pattern matching ----------

test('match: литералы и default', async () => {
    const { result } = await run(
        'fn f(n) { return match n { case 1: 10, case 2: 20, default: 99, }; }' +
        ' fn main() { return f(2) + f(7); }');
    assert.equal(result, 119);
});

test('match: связка идентификатора и wildcard', async () => {
    const { result } = await run(
        'fn main() { return match 5 { case 1: 1, case x: x * 3, }; }');
    assert.equal(result, 15);
});

test('match: конструкторы Ok/Err', async () => {
    const { result } = await run(
        'fn f(r) { return match r { case Ok(v): v, case Err(e): -1, }; }' +
        ' fn main() { return f(Ok(42)) + f(Err("x")); }');
    assert.equal(result, 41);
});

test('match: тело-блок с return', async () => {
    const { result } = await run(
        'fn main() { return match 3 { case 3: { let y = 4; return y * 10; } default: 0, }; }');
    assert.equal(result, 40);
});

test('match: нет совпадения → ошибка', async () => {
    await assert.rejects(() => run('fn main() { return match 5 { case 1: 1, }; }'), /no arm matched/);
});

// ---------- Async/await ----------

test('async/await: простое разворачивание', async () => {
    const { result } = await run('async fn f() -> int { return 42; } fn main() { return await f(); }');
    assert.equal(result, 42);
});

test('async/await: цепочка асинхронных вызовов', async () => {
    const { result } = await run(
        'async fn a() -> int { return 10; }' +
        ' async fn b() -> int { let x = await a(); return x + 5; }' +
        ' fn main() { return await b(); }');
    assert.equal(result, 15);
});

test('async: функция без return отдаёт promise(null)', async () => {
    const { result } = await run('async fn f() { print("x"); } fn main() { let v = await f(); return v == null; }');
    assert.equal(result, true);
});

test('await не-promise — тождество', async () => {
    const { result } = await run('fn main() { return await 7; }');
    assert.equal(result, 7);
});

// ---------- Каналы, select, yield, spawn-block ----------

test('channels: send <- и recv', async () => {
    const { result } = await run('fn main() { let ch = channel(); ch <- 5; return ch.recv(); }');
    assert.equal(result, 5);
});

test('spawn block: анонимная горутина', async () => {
    const { result } = await run('fn main() { let ch = channel(); spawn { ch <- 99; } return ch.recv(); }');
    assert.equal(result, 99);
});

test('select: берёт готовый канал (блокирующий, без default)', async () => {
    const { result } = await run(
        'fn w(ch) { ch.send(7); } fn main() { let ch = channel(); spawn w(ch);' +
        ' return select { case v <- ch: v }; }');
    assert.equal(result, 7);
});

test('select: default при отсутствии готовых каналов', async () => {
    const { result } = await run(
        'fn main() { let ch = channel(); return select { case v <- ch: v default: -1 }; }');
    assert.equal(result, -1);
});

test('select: выбор среди нескольких каналов', async () => {
    const { result } = await run(
        'fn w1(ch) { ch.send(1); } fn w2(ch) { ch.send(2); }' +
        ' fn main() { let a = channel(); let b = channel(); spawn w1(a); spawn w2(b);' +
        ' let r = 0; let done = 0;' +
        ' while (done < 2) { select { case v <- a: { r = r + v; done = done + 1; }' +
        ' case v <- b: { r = r + v * 10; done = done + 1; } } } return r; }');
    assert.equal(result, 21);
});

test('yield: уступает планировщику и завершает цикл', async () => {
    const { result } = await run('fn main() { let i = 0; while (i < 3) { yield; i = i + 1; } return i; }');
    assert.equal(result, 3);
});

// ---------- For-in ----------

test('for-in: суммирование массива', async () => {
    const { result } = await run('fn main() { let s = 0; for (let x in [1,2,3,4]) { s = s + x; } return s; }');
    assert.equal(result, 10);
});

test('for-in: строка как итерируемое', async () => {
    const { result } = await run('fn main() { let n = 0; for (let c in "abc") { n = n + 1; } return n; }');
    assert.equal(result, 3);
});

// ---------- Lambda / замыкания ----------

test('lambda: выражение-тело', async () => {
    const { result } = await run('fn main() { let f = fn(x) => x * 2; return f(21); }');
    assert.equal(result, 42);
});

test('lambda: блочное тело с return', async () => {
    const { result } = await run('fn main() { let f = fn(x) { let y = x + 1; return y * 10; }; return f(4); }');
    assert.equal(result, 50);
});

test('lambda: замыкание захватывает окружение', async () => {
    const { result } = await run('fn main() { let k = 10; let f = fn(x) => x + k; return f(5); }');
    assert.equal(result, 15);
});

test('lambda: функция высшего порядка', async () => {
    const { result } = await run(
        'fn map_arr(arr, f) { let r = []; for (let x in arr) { r.push(f(x)); } return r; }' +
        ' fn main() { let d = map_arr([1,2,3], fn(x) => x * x); return d[2]; }');
    assert.equal(result, 9);
});

// ---------- Tensor / semantic ----------

test('tensor: форма и rank', async () => {
    const { result } = await run('fn main() { let t = tensor([1,2,3,4], [2,2]); return t.shape[0] + t.shape[1]; }');
    assert.equal(result, 4);
});

test('matmul: [2,2]x[2,2]', async () => {
    const { result } = await run(
        'fn main() { let a = tensor([[1,2],[3,4]]); let b = tensor([[5,6],[7,8]]);' +
        ' let c = matmul(a, b); return c.data[0][0] + c.data[1][1]; }');
    assert.equal(result, 19 + 50);
});

test('semantic: cosine_similarity самоподобия = 1', async () => {
    const { result } = await run(
        'fn main() { let a = semantic("hello world"); let b = semantic("hello world");' +
        ' return cosine_similarity(a, b); }');
    assert.ok(Math.abs(result - 1) < 1e-9);
});

test('matmul: несовместимые формы → ошибка', async () => {
    await assert.rejects(
        () => run('fn main() { return matmul(tensor([[1,2],[3,4]]), tensor([[1,2,3]])); }'),
        /shape mismatch/);
});

// ---------- Тесты, assert, forall, snapshot, контракты ----------

test('test-блоки: результаты доступны после run', async () => {
    const program = new Parser(tokenize(
        'test "ok" { assert(1 == 1); } test "eq" { assert_eq(2 + 2, 4); } fn main() { return 0; }'
    )).parseProgram();
    const interp = new Interpreter(program, () => {});
    interp.run();
    assert.equal(interp.testResults.length, 2);
    assert.ok(interp.testResults.every(r => r.passed));
});

test('test-блок: провал assert фиксируется как failed', async () => {
    const program = new Parser(tokenize(
        'test "bad" { assert(1 == 2); } fn main() { return 0; }'
    )).parseProgram();
    const interp = new Interpreter(program, () => {});
    interp.run();
    assert.equal(interp.testResults[0].passed, false);
    assert.match(interp.testResults[0].error, /assertion failed/);
});

test('assert_eq: несовпадение бросает с сообщением', async () => {
    await assert.rejects(() => run('fn main() { assert_eq(1, 2, "msg"); return 1; }'), /assert_eq failed/);
});

test('assert: ложное условие бросает', async () => {
    await assert.rejects(() => run('fn main() { assert(false, "boom"); return 1; }'), /assertion failed/);
});

test('@forall и @ai_contract: декораторы парсятся без ошибок', async () => {
    const { result } = await run(
        '@forall("array") fn p(arr) { assert(arr.length >= 0); }' +
        ' @ai_contract("sorting") fn c(f) { assert(true); }' +
        ' fn main() { return 1; }');
    assert.equal(result, 1);
});

test('snapshot и enforce_contract вызываются', async () => {
    const { result } = await run(
        'fn main() { snapshot("v"); let c = ai_contract("x"); return enforce_contract(c); }');
    assert.equal(result, true);
});

test('Result/Option: unwrap, unwrap_or, is_ok/is_err', async () => {
    const { result } = await run(
        'fn main() { let ok = Ok(5); let none = None();' +
        ' return unwrap(ok) + unwrap_or(none, 100) + is_ok(ok) + is_err(ok); }');
    assert.equal(result, 106);
});

// ---------- Порядок/структура AST ----------

test('парсер: async fn помечается isAsync', () => {
    const ast = new Parser(tokenize('async fn f() { } fn main() { }')).parseProgram();
    assert.equal(ast.functions.f.isAsync, true);
    assert.equal(ast.functions.main.isAsync, false);
});

test('парсер: select как инструкция и как выражение', () => {
    const stmtAst = new Parser(tokenize(
        'fn main() { select { case v <- ch: { print(v); } default: { print(0); } } }'
    )).parseProgram();
    assert.equal(stmtAst.functions.main.body.statements[0].type, 'Select');
    const exprAst = new Parser(tokenize(
        'fn main() { return select { case v <- ch: v default: 0 }; }'
    )).parseProgram();
    assert.equal(exprAst.functions.main.body.statements[0].value.type, 'SelectExpr');
});