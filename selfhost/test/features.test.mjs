// Дифференциальные тесты: Rust-эталон (oracle) против stage1 и stage2.
//
// Каждая программа компилируется тремя компиляторами и исполняется; результат
// main() (и вывод print) должен совпасть у всех. Это ловит семантические
// расхождения, которые фиксированная точка сама по себе не обнаруживает
// (можно стабильно ошибаться одинаково на обоих stage).

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

// Программа: исходник + ожидаемый результат main() (+ опционально вывод print).
const CASES = {
  "арифметика и приоритеты": {
    src: `fn main() -> int { return 2 + 3 * 4 - 10 / 2; }`,
    main: 9,
  },
  "унарный минус и отрицательные": {
    src: `fn main() -> int { let x = 5; return 0 - x; }`,
    main: -5,
  },
  "локали и вызовы": {
    src: `fn add(a, b) -> int { return a + b; }
fn main() -> int { let x = add(3, 4); return add(x, 5); }`,
    main: 12,
  },
  "рекурсия (факториал)": {
    src: `fn fact(n) -> int { if (n <= 1) { return 1; } return n * fact(n - 1); }
fn main() -> int { return fact(6); }`,
    main: 720,
  },
  "цикл while": {
    src: `fn main() -> int { let i = 0; let s = 0; while (i < 10) { s = s + i; i = i + 1; } return s; }`,
    main: 45,
  },
  "while true с ранним return": {
    src: `fn f() -> int { let i = 0; while (true) { i = i + 1; if (i == 7) { return i; } } return 0; }
fn main() -> int { return f(); }`,
    main: 7,
  },
  "каскад if/else": {
    src: `fn grade(n) -> int {
  if (n >= 90) { return 5; } else { if (n >= 80) { return 4; } else { if (n >= 70) { return 3; } else { return 2; } } }
}
fn main() -> int { return grade(85) * 10 + grade(60); }`,
    main: 42,
  },
  "повторное объявление let (соседние ветки)": {
    src: `fn f(c) -> int {
  let n = 0;
  if (c < 100) { let k = 10; n = n + k; } else { let k = 20; n = n + k; }
  return n;
}
fn main() -> int { return f(200) + f(50); }`,
    main: 30,
  },
  "битовые операции и сдвиги": {
    src: `fn main() -> int { return (1 << 5) + (128 >> 3) + (12 & 10) + (1 | 4) + (7 ^ 3); }`,
    main: 32 + 16 + 8 + 5 + 4,
  },
  "логические операторы": {
    src: `fn main() -> int { let a = true; let b = false; if (a && !b) { return 1; } return 0; }`,
    main: 1,
  },
  "сравнения": {
    src: `fn main() -> int { let n = 0;
  if (3 < 5) { n = n + 1; } if (5 <= 5) { n = n + 1; } if (7 > 2) { n = n + 1; }
  if (7 >= 8) { n = n + 100; } if (3 == 3) { n = n + 1; } if (3 != 4) { n = n + 1; }
  return n; }`,
    main: 5,
  },
  "линейная память: alloc/store32/load32": {
    src: `fn main() -> int { let p = alloc(16); store32(p, 1234); store32(p + 4, 5678); return load32(p) + load32(p + 4); }`,
    main: 6912,
  },
  "байтовый доступ: load8/store8": {
    src: `fn main() -> int { let p = alloc(8); store8(p, 65); store8(p + 1, 66); return load8(p) * 100 + load8(p + 1); }`,
    main: 6566,
  },
  "memcopy": {
    src: `fn main() -> int { let a = alloc(8); let b = alloc(8); store32(a, 777); memcopy(b, a, 4); return load32(b); }`,
    main: 777,
  },
  "цикл с массивом-как-указателем": {
    src: `fn main() -> int {
  let a = alloc(40);
  let i = 0;
  while (i < 10) { store32(a + i * 4, i * i); i = i + 1; }
  let s = 0; i = 0;
  while (i < 10) { s = s + load32(a + i * 4); i = i + 1; }
  return s;
}`,
    main: 285,
  },
  "строковый литерал: длина по заголовку": {
    // Строковый литерал хранится как [len u32 LE][utf8]; len читается load32.
    // Внимание: `+` на строках — конкатенация, поэтому байты берём через alloc.
    src: `fn main() -> int { let s = "ABC"; return load32(s); }`,
    main: 3,
  },
  "строка: побайтовое чтение через memcopy": {
    // memcopy копирует строковый литерал ([len u32][utf8]); байты 'A','B','C'
    // лежат по смещению +4..+6 от указателя.
    src: `fn main() -> int {
  let s = "ABC";
  let dst = alloc(8);
  memcopy(dst, s, 7);
  return load8(dst + 4) + load8(dst + 5) + load8(dst + 6);
}`,
    main: 65 + 66 + 67,
  },
  "глубокая вложенность else (регресс find_local)": {
    src: `fn f(c) -> int {
  let n = 0;
  if (c == 1) { let v = 1; n = n + v; } else {
    if (c == 2) { let v = 2; n = n + v; } else {
      if (c == 3) { let v = 3; n = n + v; } else {
        if (c == 4) { let v = 4; n = n + v; } else { n = n + 99; }
      }
    }
  }
  return n;
}
fn main() -> int { return f(1) + f(2) + f(3) + f(4) + f(9); }`,
    main: 1 + 2 + 3 + 4 + 99,
  },
  "несколько одинаковых let в трёх ветках": {
    src: `fn f(c) -> int {
  let r = 0;
  if (c == 1) { let x = 100; r = r + x; } else {
    if (c == 2) { let x = 200; r = r + x; } else { let x = 300; r = r + x; }
  }
  return r;
}
fn main() -> int { return f(1) + f(2) + f(3); }`,
    main: 600,
  },
};

describe("дифференциальные тесты: oracle vs stage1 vs stage2", () => {
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