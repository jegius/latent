// test/formatter-edge.test.js — граничные ветки автоформаттера Latent.
//
// Форматтер — чистая функция: он выравнивает отступы по строкам и нормализует
// пробелы, но не переносит строки. Проверяем пробелы в заголовках if/for,
// сохранение строк/комментариев (включая многострочные блочные), схлопывание
// пустых строк и корректную глубину отступов.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLatent } from '../services/formatter-service.js';

test('formatLatent: пробел перед { и вокруг операторов в if/for', () => {
    const out = formatLatent('if(x){print(1);}\nfor(let i=0;i<2;i=i+1){print(i);}\n');
    assert.equal(out,
        'if (x) {print(1);}\nfor (let i = 0; i < 2; i = i + 1) {print(i);}\n');
});

test('formatLatent: else{ получает пробел перед фигурной скобкой', () => {
    // Строки не переносятся (ответственность форматтера — отступы и пробелы).
    const out = formatLatent('if(x){print(1);}else{print(2);}\n');
    assert.equal(out, 'if (x) {print(1);}else {print(2);}\n');
});

test('formatLatent: многострочный блочный комментарий сохраняет содержимое', () => {
    const src = '/* заголовок\n   второй   ряд */\nlet x=1;\n';
    const out = formatLatent(src);
    assert.ok(out.includes('/* заголовок'));
    assert.ok(out.includes('второй   ряд */')); // внутренние пробелы не схлопываются
    assert.ok(out.includes('let x = 1;'));
});

test('formatLatent: inline-комментарии и //-комментарии дословны', () => {
    const out = formatLatent('let x=1; /* a  b */\n// c   d\n');
    assert.ok(out.includes('/* a  b */'));
    assert.ok(out.includes('// c   d'));
});

test('formatLatent: строки с экранированием не трогаются', () => {
    const src = 'let s="a\\"b,  c";\nprint(s);\n';
    const out = formatLatent(src);
    assert.ok(out.includes('"a\\"b,  c"'));
});

test('formatLatent: пустые строки схлопываются, хвостовые удаляются', () => {
    const out = formatLatent('let a=1;\n\n\n\nlet b=2;\n\n\n');
    assert.equal(out, 'let a = 1;\n\nlet b = 2;\n');
});

test('formatLatent: не-строки и пустой ввод', () => {
    assert.equal(formatLatent(''), '');
    assert.equal(formatLatent(null), '');
    assert.equal(formatLatent(undefined), '');
});

test('formatLatent: унарные ! и - не получают лишних пробелов, -> форматируется', () => {
    const out = formatLatent('let a=!f(x);\nlet b=-x;\nfn g()->int{return 1;}\n');
    assert.ok(out.includes('let a = !f(x);'));
    assert.ok(out.includes('let b = -x;'));
    assert.ok(out.includes('fn g() -> int {'));
});

test('formatLatent: логические операторы и сравнения', () => {
    const out = formatLatent('let ok=a==b&&c!=d||e<=f;\n');
    assert.equal(out, 'let ok = a == b && c != d || e <= f;\n');
});

test('formatLatent: закрывающая скобка на отдельной строке уменьшает отступ', () => {
    const src = 'fn main() {\n{\nlet x=1;\n}\n}\n';
    const out = formatLatent(src);
    assert.equal(out, 'fn main() {\n    {\n        let x = 1;\n    }\n}\n');
});
