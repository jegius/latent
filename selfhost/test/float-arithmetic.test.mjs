// Арифметика f64 в self-hosted компиляторе: вычитание, деление и сравнения
// `<=`/`>=`.
//
// Rust-эталон («движок №2») на части float-выражений выдаёт невалидный WASM
// (см. selfhost/README.md, «Остаточные расхождения», п.1), поэтому эти кейсы
// проверяются только selfhost-компилятором: stage1 собирает программу, а
// `main()` должен вернуть ожидаемое значение. Раньше эти ветви эмиттера
// (`F64_SUB_OP`/`F64_DIV_OP`/`F64_LE_OP`/`F64_GE_OP`) не покрывались корпусом.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SELFHOST,
  buildStage1,
  compileWith,
  runProgram,
} from "./harness.mjs";

const CASES = [
  {
    name: "f64: вычитание",
    src: `fn main() -> int { let a = 7.5; let b = 2.5; return int(a - b); }`,
    main: 5,
  },
  {
    name: "f64: деление",
    src: `fn main() -> int { let a = 7.5; let b = 2.5; return int(a / b); }`,
    main: 3,
  },
  {
    name: "f64: <= и >= (в т.ч. результат вычитания)",
    src: `fn main() -> int {
  let a = 5.0; let b = 2.5; let c = a - b;
  if (a >= b && b <= a && c >= 2.5) { return int(c); }
  return 0;
}`,
    main: 2,
  },
];

describe("арифметика f64: вычитание, деление, <=/>= (selfhost)", () => {
  let stage1;
  before(() => {
    stage1 = existsSync(join(SELFHOST, "stage1.wasm"))
      ? readFileSync(join(SELFHOST, "stage1.wasm"))
      : buildStage1();
  });

  for (const c of CASES) {
    test(c.name, () => {
      const compiled = compileWith(stage1, c.src);
      assert.ok(compiled.ret >= 0, `stage1 не скомпилировал: ret=${compiled.ret}`);
      const { result } = runProgram(compiled.wasm);
      assert.equal(result, c.main, `main() = ${result}, ожидалось ${c.main}`);
    });
  }
});
