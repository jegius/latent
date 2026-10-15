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

const CASES = {
  "литерал массива и чтение по индексу": {
    src: `fn main() -> int { let a = [10, 20, 30]; return a[0] + a[1] * 2 + a[2]; }`,
    main: 10 + 40 + 30,
  },
  "длина массива": {
    src: `fn main() -> int { return [1, 2, 3, 4, 5].length; }`,
    main: 5,
  },
  "присваивание в элемент": {
    src: `fn main() -> int { let a = [1, 2, 3]; a[1] = 99; return a[0] + a[1] + a[2]; }`,
    main: 1 + 99 + 3,
  },
  "for-in по массиву": {
    src: `fn main() -> int { let a = [3, 5, 7, 11]; let s = 0; for (let x in a) { s = s + x; } return s; }`,
    main: 26,
  },
  "for-in накапливает индекс, как oracle": {
    src: `fn f() -> int { let a = [2, 4, 6]; let s = 0; for (let v in a) { s = s + v; } return s; }
fn main() -> int { return f() + f(); }`,
    main: 24,
  },
  "короткое замыкание && с побочным эффектом": {
    src: `fn main() -> int {
  let s = 0;
  let a = 0;
  if (a != 0 && (s = s + 1) == 1) { return 99; }
  if (a == 0 || (s = s + 10) == 10) { return s; }
  return 100;
}`,
    main: 10,
  },
  "&& внутри || как в is_alpha": {
    src: `fn is_alpha(c) -> bool { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95; }
fn main() -> int { if (is_alpha(65) && is_alpha(95) && !is_alpha(48)) { return 1; } return 0; }`,
    main: 1,
  },
  "вложенные && при сканировании": {
    src: `fn scan(a) -> int {
  let i = 0; let n = 0;
  while (i < 10) {
    if (i > 2 && i < 8 && i != 5) { n = n + 1; }
    i = i + 1;
  }
  return n;
}
fn main() -> int { return scan(0); }`,
    main: 4,
  },
  "блочный комментарий": {
    src: `fn main() -> int { /* leading */ let x = 3; /* mid */ return x * 2; }`,
    main: 6,
  },
  "цепочка присваиваний с индексом": {
    src: `fn main() -> int {
  let a = [0, 0, 0, 0];
  a[0] = 5; a[1] = a[0] + 1; a[2] = a[1] * 2; a[3] = a[2] - a[0];
  return a[0] + a[1] + a[2] + a[3];
}`,
    main: 5 + 6 + 12 + 7,
  },
  "вызов с числом-аргументом и индексом": {
    src: `fn put(a, i, v) -> int { a[i] = v; return v; }
fn main() -> int { let a = [0, 0, 0]; put(a, 2, 109); return a[2]; }`,
    main: 109,
  },
  "while с индексной записью как в build_module": {
    src: `fn fill(n) -> int {
  let a = alloc(64);
  let i = 0;
  while (i < n) { store32(a + i * 4, i + 1); i = i + 1; }
  let s = 0; i = 0;
  while (i < n) { s = s + load32(a + i * 4); i = i + 1; }
  return s;
}
fn main() -> int { return fill(6); }`,
    main: 21,
  },
  "for-in внутри функции с накоплением": {
    src: `fn sum(a) -> int { let s = 0; for (let x in a) { s = s + x; } return s; }
fn main() -> int { return sum([1, 2, 3]) + sum([10, 20]); }`,
    main: 36,
  },
};

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