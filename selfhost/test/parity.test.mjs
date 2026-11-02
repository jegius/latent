// Паритет с Rust-эталоном для новых конструкций: oracle vs stage1 vs stage2.
//
// Проверяются:
//   * host-конструкции, которые эталон компилирует в суррогат:
//     spawn / yield / async-await / select (выражение и инструкция) / test;
//   * match по строковым литералам;
//   * методы to_str/to_int с учётом статического типа получателя;
//   * top-level let (в эталоне — Undefined variable, а не invalid wasm);
//   * host-builtin'ы (channel/tensor/ai_*), каналы и неизвестные методы —
//     все три компилятора обязаны дать ошибку с осмысленным текстом,
//     причём stage1 и stage2 — ОДИНАКОВЫМ (регресс на «битый текст» stage2);
//   * попутные расширения паритета: print-конверсии, null, строковые
//     параметры, float("..."), экспоненциальные литералы, escape-строки,
//     вложенные блочные комментарии.
//
// Для успешных кейсов сверяются результат main(), вывод print и отсутствие
// invalid WASM; для ошибочных — факт ошибки у всех трёх и текст.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SELFHOST,
  SHC_SRC,
  buildStage1,
  compileWith,
  runProgram,
  oracleRun,
} from "./harness.mjs";
import { PARITY_OK_CASES as OK_CASES, PARITY_ERROR_CASES as ERROR_CASES } from "./corpus.mjs";

/** Компилирует программу компилятором-байтами и исполняет; ошибка — как {ok:false}. */
function viaCompiler(compilerBytes, src) {
  const { wasm, ret } = compileWith(compilerBytes, src);
  if (ret < 0) {
    return { ok: false, error: new TextDecoder().decode(wasm) };
  }
  try {
    const { result, output } = runProgram(wasm);
    return { ok: true, result, output };
  } catch (e) {
    return { ok: false, error: "run: " + e.message };
  }
}

/** Запуск эталона; ошибка компиляции/валидации — {ok:false}. */
function oracleOutcome(src) {
  try {
    const { result, output } = oracleRun(src);
    return { ok: true, result, output };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).trim() };
  }
}

// Успешные кейсы: ожидаемый результат main() (+ опционально вывод print).

// Ошибочные кейсы: все три компилятора обязаны отказать; текст selfhost
// должен соответствовать re (имя конструкции), stage1 и stage2 — совпадать.

describe("паритет новых конструкций: oracle vs stage1 vs stage2", () => {
  let stage1;
  let stage2;

  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
    stage2 = compileWith(stage1, readFileSync(SHC_SRC, "utf8")).wasm;
  });

  for (const [name, c] of Object.entries(OK_CASES)) {
    test(name, () => {
      const oracle = oracleOutcome(c.src);
      assert.ok(oracle.ok, `эталон не скомпилировал кейс: ${oracle.error}`);
      assert.equal(oracle.result, c.main, `эталон дал ${oracle.result}, ожидалось ${c.main}`);
      if (c.output) assert.deepEqual(oracle.output, c.output);

      for (const [label, compiler] of [["stage1", stage1], ["stage2", stage2]]) {
        const r = viaCompiler(compiler, c.src);
        assert.ok(r.ok, `${label} не скомпилировал: ${r.error}`);
        assert.equal(r.result, c.main, `${label} дал ${r.result}, ожидалось ${c.main}`);
        if (c.output) assert.deepEqual(r.output, c.output, `${label}: вывод print расходится`);
      }
    });
  }

  for (const [name, c] of Object.entries(ERROR_CASES)) {
    test(name, () => {
      const oracle = oracleOutcome(c.src);
      assert.equal(oracle.ok, false, "эталон неожиданно скомпилировал ошибочный кейс");

      const a = viaCompiler(stage1, c.src);
      const b = viaCompiler(stage2, c.src);
      assert.equal(a.ok, false, "stage1 неожиданно скомпилировал ошибочный кейс");
      assert.equal(b.ok, false, "stage2 неожиданно скомпилировал ошибочный кейс");
      assert.match(a.error, c.re, `stage1: текст ошибки не содержит имени/смысла: ${a.error}`);
      assert.match(b.error, c.re, `stage2: текст ошибки не содержит имени/смысла: ${b.error}`);
      if (c.also) {
        assert.match(a.error, c.also);
        assert.match(b.error, c.also);
      }
      // Регресс на «битый текст» stage2 (ошибка чтения буфера ERRB).
      assert.equal(b.error, a.error, "текст ошибки stage2 отличается от stage1");
    });
  }

  // Осознанные надмножества: эталон в этих случаях наблюдаемо ошибается
  // (теряет строковый тип результата МЕТОДА: print печатает указатель,
  // индекс читает 4-байтовые ячейки массива), поэтому oracle здесь не
  // проверяем — фиксируем корректное поведение selfhost.
  describe("осознанные надмножества (эталон ошибается — selfhost точен)", () => {
    test("print(n.to_str()) печатает строку, а не указатель", () => {
      const src = `fn main() -> int { let n = 7; print(n.to_str()); return 0; }`;
      for (const [label, compiler] of [["stage1", stage1], ["stage2", stage2]]) {
        const r = viaCompiler(compiler, src);
        assert.ok(r.ok, `${label}: ${r.error}`);
        assert.deepEqual(r.output, ["7"], `${label}: ожидалась строка "7"`);
      }
    });

    test("n.to_str()[i] — байт строки", () => {
      const src = `fn main() -> int { let n = 12345; return n.to_str()[3]; }`;
      for (const [label, compiler] of [["stage1", stage1], ["stage2", stage2]]) {
        const r = viaCompiler(compiler, src);
        assert.ok(r.ok, `${label}: ${r.error}`);
        assert.equal(r.result, 52, `${label}: ожидался байт '4' (52)`);
      }
    });

    test("метод класса, вернувший string: p.get()[i] — байт строки", () => {
      const src = `class P { s: string; fn init(v: string) { this.s = v; }
        fn get() -> string { return this.s; } }
        fn main() -> int { let p = new P("abc"); return p.get()[1]; }`;
      for (const [label, compiler] of [["stage1", stage1], ["stage2", stage2]]) {
        const r = viaCompiler(compiler, src);
        assert.ok(r.ok, `${label}: ${r.error}`);
        assert.equal(r.result, 98, `${label}: ожидался байт 'b' (98)`);
      }
    });
  });
});
