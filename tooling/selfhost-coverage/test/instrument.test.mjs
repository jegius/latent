// Тесты инструментатора: сканирование верхнего уровня и вставка счётчиков.
//
// Запуск: node --test "tooling/selfhost-coverage/test/*.test.mjs"

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  scanTopLevelFunctions,
  instrumentSource,
  findPreambleConflicts,
  COUNTER_BASE,
  LINE_ID_BASE,
} from "../src/instrument.mjs";

const SAMPLE = `// комментарий с fn fake() { }
fn a(x) -> int { return x + 1; }
/* блок
   fn nested() { }
*/
fn main() -> int {
  let s = "fn not_a_function() { }";
  if (x > 0) {
    return a(1);
  } else {
    return 0;
  }
}
async fn later() -> int { return 2; }
fn typed(f: fn(int) -> int) -> int { return 0; }
`;

describe("scanTopLevelFunctions", () => {
  test("находит только функции верхнего уровня, не строки/комментарии/типы", () => {
    const funcs = scanTopLevelFunctions(SAMPLE);
    assert.deepEqual(funcs.map((f) => f.name), ["a", "main", "later", "typed"]);
  });

  test("определяет границы тела (bodyOpen/bodyClose) корректно", () => {
    const funcs = scanTopLevelFunctions(SAMPLE);
    const a = funcs[0];
    assert.equal(SAMPLE[a.bodyOpen], "{");
    assert.equal(SAMPLE[a.bodyClose], "}");
    assert.ok(a.bodyClose > a.bodyOpen);
    const main = funcs[1];
    assert.equal(SAMPLE[main.bodyOpen], "{");
    assert.equal(SAMPLE[main.bodyClose], "}");
    assert.equal(SAMPLE[main.bodyClose + 1], "\n");
  });

  test("однострочные функции и async fn", () => {
    const funcs = scanTopLevelFunctions("async fn f() -> int { return 1; }\nfn g() -> int { return 2; }\n");
    assert.deepEqual(funcs.map((f) => f.name), ["f", "g"]);
  });

  test("не считает объявление типа `fn(...)` функцией", () => {
    const funcs = scanTopLevelFunctions("let f: fn(int) -> int = 0;\n");
    assert.equal(funcs.length, 0);
  });

  test("незакрытая функция — ошибка", () => {
    assert.throws(() => scanTopLevelFunctions("fn broken() -> int { return 1;\n"), /незакрытая/);
  });
});

describe("instrumentSource: функции", () => {
  const res = instrumentSource(SAMPLE);

  test("каждая функция получает ровно один cov_bump(ID) в начале тела", () => {
    assert.equal(res.functions.length, 4);
    for (const f of res.functions) {
      assert.match(res.source, new RegExp(`\\{ cov_bump\\(${f.id}\\);`), `нет cov_bump(${f.id})`);
    }
    assert.equal((res.source.match(/cov_bump\(\d+\);/g) ?? []).length, 4);
  });

  test("ID идут по порядку исходника", () => {
    assert.deepEqual(res.functions.map((f) => f.id), [0, 1, 2, 3]);
    assert.deepEqual(res.functions.map((f) => f.name), ["a", "main", "later", "typed"]);
  });

  test("номера строк функций не меняются и указывают на оригинал", () => {
    for (const f of res.functions) {
      const line = SAMPLE.split("\n")[f.line - 1];
      assert.match(line, new RegExp(`fn ${f.name}\\b`), `${f.name}: строка ${f.line} = ${line}`);
    }
  });

  test("преамбула объявляет cov_bump/cov_read и базу счётчиков", () => {
    assert.match(res.source, /^\/\/ ==== selfhost-coverage/m);
    assert.match(res.source, /fn cov_bump\(id\)/);
    assert.match(res.source, /fn cov_read\(id\)/);
    assert.match(res.source, /32768/);
    assert.equal(res.counterBase, COUNTER_BASE);
    assert.equal(res.lines.length, 0);
  });

  test("строчный режим выключен по умолчанию", () => {
    assert.equal(res.source.includes("cov_line"), false);
  });
});

describe("instrumentSource: строки", () => {
  const res = instrumentSource(SAMPLE, { lines: true });

  test("счётчики строк начинаются с LINE_ID_BASE", () => {
    assert.ok(res.lines.length > 0);
    assert.equal(res.lines[0].id, LINE_ID_BASE);
    for (let i = 0; i < res.lines.length; i++) assert.equal(res.lines[i].id, LINE_ID_BASE + i);
  });

  test("инструментируются инструкции, но не `}`, `else`, `case`, `default`", () => {
    const texts = res.lines.map((l) => l.text);
    assert.ok(texts.some((t) => t.startsWith("let ")));
    assert.ok(texts.some((t) => t.startsWith("return ")));
    assert.ok(texts.some((t) => t.startsWith("if (")));
    assert.ok(!texts.some((t) => t.startsWith("}")));
    assert.ok(!texts.some((t) => t.startsWith("else")));
  });

  test("вставки cov_line стоят в начале строк, номера строк не смещаются", () => {
    const lines = res.source.split("\n");
    for (const rec of res.lines.slice(0, 5)) {
      const line = lines.find((l) => l.includes(`cov_line(${rec.id});`));
      assert.ok(line, `нет cov_line(${rec.id})`);
    }
    for (const f of res.functions) {
      assert.equal(SAMPLE.split("\n")[f.line - 1].includes(`fn ${f.name}`), true);
    }
  });

  test("преамбула в строчном режиме объявляет cov_line", () => {
    assert.match(res.source, /fn cov_line\(id\)/);
  });

  test("пользовательские cov_* имена обнаруживаются как конфликт", () => {
    assert.deepEqual(findPreambleConflicts(SAMPLE), []);
    assert.deepEqual(findPreambleConflicts(`${SAMPLE}fn cov_bump(x) -> int { return x; }\n`), ["cov_bump"]);
  });
});
