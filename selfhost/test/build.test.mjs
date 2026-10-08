// Тесты сборщика selfhost/build.mjs (линковка частей компилятора).
//
// Проверяют, что сборка детерминирована (идемпотентна) и что собранный
// shc.lat эквивалентен по поведению: даёт тот же stage1 и замыкается в
// фиксированную точку.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SELFHOST, compileWith, runProgram } from "./harness.mjs";
import { assemble, listParts } from "../build.mjs";

describe("сборщик частей компилятора", () => {
  test("части существуют и пронумерованы по обязанностям", () => {
    const parts = listParts();
    assert.ok(parts.length >= 5, "ожидается несколько частей");
    // имена начинаются с числового префикса — порядок конкатенации детерминирован
    for (const p of parts) assert.match(p, /^\d\d_.+\.lat$/, `неверное имя части: ${p}`);
    assert.deepEqual(parts, [...parts].sort(), "порядок частей должен быть отсортирован");
  });

  test("сборка идемпотентна (два вызова дают один и тот же текст)", () => {
    assert.equal(assemble(), assemble());
  });

  test("собранный shc.lat совпадает с зафиксированным на диске", () => {
    const onDisk = readFileSync(join(SELFHOST, "shc.lat"), "utf8");
    assert.equal(assemble(), onDisk, "shc.lat устарел: запустите node selfhost/build.mjs");
  });
});

describe("собранный компилятор эквивалентен", () => {
  test("stage1 компилирует программу после разбиения", () => {
    const stage1 = readFileSync(join(SELFHOST, "stage1.wasm"));
    const { wasm } = compileWith(stage1, "fn main() -> int { return 21 + 21; }");
    assert.equal(runProgram(wasm).result, 42);
  });
});