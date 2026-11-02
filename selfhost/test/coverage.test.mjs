// Дифференциальные тесты покрытия языка: oracle (Rust) vs stage1 vs stage2.
//
// Каждый кейс — программа на Latent; результат main() должен совпасть у всех
// трёх компиляторов. Набор целенаправленно покрывает конструкции, которые
// встречаются в самом shc.lat (условия с &&/||, индексация, циклы, вызовы с
// числовыми литералами), — регресс на само-компиляцию.

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
import { COVERAGE_CASES as CASES } from "./corpus.mjs";


describe("покрытие языка: oracle vs stage1 vs stage2", () => {
  let stage1;
  let stage2;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
    stage2 = compileWith(stage1, readFileSync(SHC_SRC, "utf8")).wasm;
  });

  for (const [name, c] of Object.entries(CASES)) {
    test(name, () => {
      const oracle = oracleRun(c.src);
      assert.equal(oracle.result, c.main, `эталон Rust дал ${oracle.result}, ожидалось ${c.main}`);

      const viaStage1 = runProgram(compileWith(stage1, c.src).wasm);
      assert.equal(viaStage1.result, c.main, `stage1 дал ${viaStage1.result}, ожидалось ${c.main}`);

      const viaStage2 = runProgram(compileWith(stage2, c.src).wasm);
      assert.equal(viaStage2.result, c.main, `stage2 дал ${viaStage2.result}, ожидалось ${c.main}`);
    });
  }
});