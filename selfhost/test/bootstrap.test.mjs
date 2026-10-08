// Тесты bootstrap-цепочки self-hosted компилятора.
//
// Проверяют, что shc.lat корректно компилирует сам себя: stage2 валиден,
// ведёт себя как stage1 и замыкается в фиксированную точку (stage2===stage3).

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SHC_SRC,
  SELFHOST,
  buildStage1,
  compileWith,
  runProgram,
  compileState,
  bytesEqual,
  firstDiffIndex,
  hex,
} from "./harness.mjs";
import { readFileSync } from "node:fs";

const MINIMAL = "fn main() -> int { return 7; }\n";

describe("bootstrap: shc.lat -> stage1 -> stage2 -> stage3", () => {
  let source;
  let stage1;
  let stage2;

  before(() => {
    source = readFileSync(SHC_SRC, "utf8");
    const cached = join(SELFHOST, "stage1.wasm");
    stage1 = existsSync(cached) ? readFileSync(cached) : buildStage1();
    stage2 = compileWith(stage1, source).wasm;
  });

  test("stage1 валиден", () => {
    assert.ok(WebAssembly.validate(stage1), "stage1 не валиден");
  });

  test("stage1 компилирует тривиальную программу в рабочий WASM", () => {
    const { wasm } = compileWith(stage1, MINIMAL);
    assert.equal(runProgram(wasm).result, 7);
  });

  test("stage2 валиден", () => {
    assert.ok(WebAssembly.validate(stage2), "stage2 не валиден");
  });

  test("stage2 компилирует тривиальную программу в рабочий WASM", () => {
    const { wasm } = compileWith(stage2, MINIMAL);
    assert.equal(runProgram(wasm).result, 7);
  });

  test("stage2 ведёт себя как stage1 на тривиальной программе (токены)", () => {
    const a = compileState(stage1, MINIMAL);
    const b = compileState(stage2, MINIMAL);
    assert.equal(b.nt, a.nt, "NT расходится: лексер stage2 неисправен");
    assert.equal(b.nf, a.nf, "NF расходится");
  });

  test("stage2 === stage3 (фиксированная точка)", () => {
    const stage3 = compileWith(stage2, source).wasm;
    assert.ok(WebAssembly.validate(stage3), "stage3 не валиден");
    const d = firstDiffIndex(stage2, stage3);
    assert.ok(
      bytesEqual(stage2, stage3),
      `фиксированная точка не достигнута: stage2 ${stage2.length}B / stage3 ${stage3.length}B, ` +
        `первое расхождение @${d}: stage2[${hex(stage2, Math.max(0, d - 3), d + 6)}] ` +
        `stage3[${hex(stage3, Math.max(0, d - 3), d + 6)}]`,
    );
  });
});

describe("bootstrap: ABI выхода", () => {
  test("main() компилятора возвращает длину выходного WASM", () => {
    const stage1 = readFileSync(join(SELFHOST, "stage1.wasm"));
    const { wasm, ret } = compileWith(stage1, MINIMAL);
    assert.equal(ret, wasm.length, "возврат main() != длине выходного WASM");
  });
});