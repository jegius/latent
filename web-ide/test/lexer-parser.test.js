// test/lexer-parser.test.js — тесты лексера и парсера интерпретатора (движок №1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, TokenType, Parser } from '../compiler-loader.js';

test('tokenize: числа, строки, идентификаторы, операторы', () => {
    const tokens = tokenize('let x = 42 + 3.14; print("hi");');
    const types = tokens.map(t => t.type);
    assert.deepEqual(types.slice(0, 6),
        [TokenType.Keyword, TokenType.Ident, TokenType.Op, TokenType.Number,
         TokenType.Op, TokenType.Number]);
    assert.equal(tokens[0].value, 'let');
    assert.equal(tokens[3].value, 42);
    assert.equal(tokens[5].value, 3.14);
});

test('tokenize: двухсимвольные операторы', () => {
    const tokens = tokenize('== != <= >= && || ->');
    const ops = tokens.filter(t => t.type === TokenType.Op).map(t => t.value);
    assert.deepEqual(ops, ['==', '!=', '<=', '>=', '&&', '||', '->']);
});

test('tokenize: комментарии пропускаются', () => {
    const tokens = tokenize('// comment\nlet x = 1;');
    assert.equal(tokens[0].value, 'let');
});

test('tokenize: escape-последовательности в строках', () => {
    const tokens = tokenize('"a\\nb\\tc"');
    assert.equal(tokens[0].value, 'a\nb\tc');
});

test('tokenize: неизвестный символ бросает ошибку с номером строки', () => {
    assert.throws(() => tokenize('let x = 1;\n#bad'), /line 2/);
});

test('парсер: приоритеты арифметики (каскад)', () => {
    const ast = new Parser(tokenize('fn main() { return 2 + 3 * 4; }')).parseProgram();
    const ret = ast.functions.main.body.statements[0];
    assert.equal(ret.type, 'Return');
    // 2 + (3 * 4): корень — '+', правый — '*'
    assert.equal(ret.value.op, '+');
    assert.equal(ret.value.right.op, '*');
});

test('парсер: левая ассоциативность вычитания', () => {
    const ast = new Parser(tokenize('fn main() { return 10 - 3 - 2; }')).parseProgram();
    const ret = ast.functions.main.body.statements[0];
    // (10 - 3) - 2
    assert.equal(ret.value.op, '-');
    assert.equal(ret.value.left.op, '-');
});

test('парсер: if / else if / else', () => {
    const ast = new Parser(tokenize(
        'fn main() { if (a) { print(1); } else if (b) { print(2); } else { print(3); } }'
    )).parseProgram();
    const stmt = ast.functions.main.body.statements[0];
    assert.equal(stmt.type, 'If');
    assert.equal(stmt.elseBranch.type, 'If');
});

test('парсер: аннотации типов парсятся и выбрасываются', () => {
    const ast = new Parser(tokenize(
        'fn f(x: int, y: [string]) -> bool { return true; }'
    )).parseProgram();
    assert.deepEqual(ast.functions.f.params, ['x', 'y']);
});

test('парсер: hoisting — функции в map до исполнения', () => {
    const ast = new Parser(tokenize(
        'fn main() { return helper(); } fn helper() -> int { return 5; }'
    )).parseProgram();
    assert.ok(ast.functions.helper);
    assert.ok(ast.functions.main);
});

test('парсер: присваивание в индекс arr[i] = v', () => {
    const ast = new Parser(tokenize('fn main() { arr[2] = 9; }')).parseProgram();
    const stmt = ast.functions.main.body.statements[0];
    assert.equal(stmt.type, 'IndexAssign');
});

test('парсер: каналы (channel, send, recv)', () => {
    const ast = new Parser(tokenize(
        'fn main() { let ch = channel(); ch.send(1); let v = ch.recv(); }'
    )).parseProgram();
    const stmts = ast.functions.main.body.statements;
    assert.equal(stmts[1].type, 'ExprStmt');
    assert.equal(stmts[1].expr.callee.type, 'Member');
    assert.equal(stmts[1].expr.callee.name, 'send');
});

test('парсер: сообщение об ошибке содержит строку', () => {
    assert.throws(
        () => new Parser(tokenize('fn main() { let x = ; }')).parseProgram(),
        /line 1/);
});