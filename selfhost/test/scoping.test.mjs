// Тесты лексической области видимости локальных переменных в shc.lat.
//
// Регресс: таблица локальных в shc.lat плоская, find_local возвращал первую
// декларацию по имени. Из-за этого повторный `let` с тем же именем в соседнем
// блоке писался в новый слот, а читался из старого. Это делало stage2
// (самокомпиляция) неисправным: в tokenize дважды объявляются `s` и `k`.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SELFHOST, buildStage1, compileWith, runProgram } from "./harness.mjs";
import { SCOPING_PROGRAMS } from "./corpus.mjs";

// Собирает программу компилятором stage1 и возвращает результат main().
function runViaStage1(stage1, source) {
  const { wasm } = compileWith(stage1, source);
  return runProgram(wasm);
}

describe("лексическая область видимости (stage1 как компилятор)", () => {
  let stage1;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
  });

  test("повторный let того же имени в соседнем блоке не путает слоты", () => {
    // В ветках if/else объявляется одноимённая `k` со разными значениями.
    const src = SCOPING_PROGRAMS[0].src;
    // 20 + 10 = 30
    assert.equal(runViaStage1(stage1, src).result, 30);
  });

  test("одноимённые let в соседних ветках во вложенном блоке", () => {
    const src = SCOPING_PROGRAMS[1].src;
    // 100 + 200 + 300 = 600
    assert.equal(runViaStage1(stage1, src).result, 600);
  });

  test("повторное объявление let — последняя привязка активна (семантика функции)", () => {
    // Семантика языка совпадает с эталонным Rust-компилятором: `let` не
    // создаёт блочную область, повторное объявление перекрывает прежнее до
    // конца функции. Поэтому после `let k = 5` обе ветки читают 5.
    const src = SCOPING_PROGRAMS[2].src;
    assert.equal(runViaStage1(stage1, src).result, 10);
  });

  test("let внутри цикла не утекает за его пределы", () => {
    const src = SCOPING_PROGRAMS[3].src;
    assert.equal(runViaStage1(stage1, src).result, 6);
  });
});