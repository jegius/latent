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
    const src = `
fn classify(c) -> int {
    let n = 0;
    if (c < 100) {
        let k = 10;
        n = n + k;
    } else {
        let k = 20;
        n = n + k;
    }
    return n;
}
fn main() -> int { return classify(200) + classify(50); }
`;
    // 20 + 10 = 30
    assert.equal(runViaStage1(stage1, src).result, 30);
  });

  test("одноимённые let в соседних ветках во вложенном блоке", () => {
    const src = `
fn f(c) -> int {
    let r = 0;
    if (c == 1) {
        let x = 100;
        r = r + x;
    } else {
        if (c == 2) {
            let x = 200;
            r = r + x;
        } else {
            let x = 300;
            r = r + x;
        }
    }
    return r;
}
fn main() -> int { return f(1) + f(2) + f(3); }
`;
    // 100 + 200 + 300 = 600
    assert.equal(runViaStage1(stage1, src).result, 600);
  });

  test("повторное объявление let — последняя привязка активна (семантика функции)", () => {
    // Семантика языка совпадает с эталонным Rust-компилятором: `let` не
    // создаёт блочную область, повторное объявление перекрывает прежнее до
    // конца функции. Поэтому после `let k = 5` обе ветки читают 5.
    const src = `
fn f() -> int {
    let k = 1;
    let r = 0;
    if (k == 1) {
        let k = 5;
        r = r + k;
    }
    r = r + k;
    return r;
}
fn main() -> int { return f(); }
`;
    assert.equal(runViaStage1(stage1, src).result, 10);
  });

  test("let внутри цикла не утекает за его пределы", () => {
    const src = `
fn f() -> int {
    let total = 0;
    let i = 0;
    while (i < 3) {
        let step = 2;
        total = total + step;
        i = i + 1;
    }
    return total;
}
fn main() -> int { return f(); }
`;
    assert.equal(runViaStage1(stage1, src).result, 6);
  });
});