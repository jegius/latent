// Тесты формирования отчёта (JSON-структура и Markdown).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildReport, renderMarkdown } from "../src/report.mjs";

function fixture() {
  return {
    source: { path: "selfhost/shc.lat", mode: "shc", parts: [], bytes: 1000, sha256: "a".repeat(64) },
    builder: { kind: "latentc", path: "latentc", bytes: 4000 },
    instrumentation: { lines: false, functions: 3, lineCounters: 0, counterBase: 32768, lineCounterBase: 49152, bytes: 1200 },
    functions: [
      { id: 0, name: "a", part: "00_abi.lat", file: "selfhost/src/00_abi.lat", line: 1, endLine: 1 },
      { id: 1, name: "b", part: "00_abi.lat", file: "selfhost/src/00_abi.lat", line: 2, endLine: 2 },
      { id: 2, name: "c", part: "10_buffer.lat", file: "selfhost/src/10_buffer.lat", line: 5, endLine: 6 },
    ],
    functionHits: [4, 0, 1],
    lines: [],
    lineHits: [],
    corpus: [
      { name: "x", kind: "test", ok: true, trapped: false, timeout: false, ret: 100 },
      { name: "y", kind: "test", ok: false, trapped: false, timeout: false, ret: -3, error: "err" },
      { name: "z", kind: "probe", ok: false, trapped: false, timeout: true, ret: 0 },
    ],
    fidelity: { checked: 2, mismatches: [] },
    gate: { min: 50 },
  };
}

describe("buildReport", () => {
  test("считает покрытие функций и по частям", () => {
    const r = buildReport(fixture());
    assert.equal(r.functions.total, 3);
    assert.equal(r.functions.covered, 2);
    assert.equal(r.functions.percent, 66.67);
    assert.deepEqual(r.functions.uncovered.map((f) => f.name), ["b"]);
    const abi = r.functions.byPart.find((p) => p.part === "00_abi.lat");
    assert.deepEqual({ covered: abi.covered, total: abi.total, percent: abi.percent }, { covered: 1, total: 2, percent: 50 });
  });

  test("агрегирует корпус, включая таймауты", () => {
    const r = buildReport(fixture());
    assert.equal(r.corpus.total, 3);
    assert.equal(r.corpus.ok, 1);
    assert.equal(r.corpus.failed, 2);
    assert.equal(r.corpus.timedOut, 1);
    assert.equal(r.corpus.byKind.test, 2);
    assert.equal(r.corpus.byKind.probe, 1);
  });

  test("порог --min: passed/failed", () => {
    assert.equal(buildReport(fixture()).gate.passed, true);
    const strict = fixture();
    strict.gate.min = 90;
    assert.equal(buildReport(strict).gate.passed, false);
  });

  test("строчный раздел появляется только при наличии счётчиков", () => {
    assert.equal(buildReport(fixture()).lines, null);
    const withLines = fixture();
    withLines.lines = [
      { id: 4096, functionId: 0, functionName: "a", part: "00_abi.lat", line: 1, text: "return 1;" },
      { id: 4097, functionId: 0, functionName: "a", part: "00_abi.lat", line: 2, text: "return 2;" },
    ];
    withLines.lineHits = [1, 0];
    const r = buildReport(withLines);
    assert.equal(r.lines.total, 2);
    assert.equal(r.lines.covered, 1);
    assert.equal(r.lines.percent, 50);
  });
});

describe("renderMarkdown", () => {
  test("содержит сводку, таблицу частей и непокрытые функции", () => {
    const md = renderMarkdown(buildReport(fixture()), { run: "node run.mjs --min 50" });
    assert.match(md, /# Покрытие self-hosted компилятора Latent/);
    assert.match(md, /Покрыто 2 из 3 \(66\.67%\)/);
    assert.match(md, /00_abi\.lat/);
    assert.match(md, /`b`/);
    assert.match(md, /node run\.mjs --min 50/);
    assert.match(md, /Порог --min 50%: PASS/);
  });

  test("показывает расхождения fidelity", () => {
    const f = fixture();
    f.fidelity.mismatches = [{ name: "x", reason: "вывод различается" }];
    const md = renderMarkdown(buildReport(f));
    assert.match(md, /Расхождения fidelity/);
    assert.match(md, /вывод различается/);
  });
});
