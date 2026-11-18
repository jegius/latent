// Интеграционные тесты инструмента покрытия:
//   * строчная инструментация не меняет поведение программы;
//   * CLI собирает отчёт и проходит fidelity;
//   * --src собирает те же части, что build.mjs.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentSource, LINE_ID_BASE, COUNTER_BASE } from "../src/instrument.mjs";
import { assembleParts } from "../src/source.mjs";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const TOOL = join(REPO, "tooling", "selfhost-coverage", "run.mjs");
const SHC = process.env.SELFHOST_COVERAGE_SHC || join(REPO, "selfhost", "shc.lat");
const STAGE1 = join(REPO, "selfhost", "stage1.wasm");
const LATENTC =
  process.env.LATENTC ||
  [join(REPO, "target", "debug", "latentc.exe"), join(REPO, "target", "debug", "latentc")].find((p) => existsSync(p));
const NODE = process.execPath;

let tmp;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "selfhost-coverage-test-"));
});
process.on("exit", () => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function compileAndRun(source, wasmPath) {
  execFileSync(LATENTC, ["compile", source, wasmPath], { stdio: "pipe", encoding: "utf8" });
  const bytes = readFileSync(wasmPath);
  assert.ok(WebAssembly.validate(bytes), "скомпилированный WASM невалиден");
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { print: () => {} } });
  const result = inst.exports.main();
  return { result, inst };
}

describe("строчная инструментация не ломает семантику", () => {
  test("ветки if/else: счётчики отражают фактическое исполнение", { skip: !LATENTC }, () => {
    const src = `fn pick(n) -> int {
  if (n > 0) {
    return 1;
  } else {
    return 2;
  }
}
fn main() -> int {
  return pick(1) + pick(0);
}
`;
    const res = instrumentSource(src, { lines: true });
    assert.ok(res.lines.length >= 4, `ожидались счётчики строк, получено ${res.lines.length}`);
    const p = join(tmp, "lines.lat");
    const w = join(tmp, "lines.wasm");
    writeFileSync(p, res.source, "utf8");
    const { result, inst } = compileAndRun(p, w);
    assert.equal(result, 3);
    const dv = new DataView(inst.exports.memory.buffer);
    const hit = (lineText) => {
      const rec = res.lines.find((l) => l.text === lineText);
      assert.ok(rec, `нет записи для строки «${lineText}»`);
      return dv.getUint32(COUNTER_BASE + rec.id * 4, true);
    };
    // Обе ветки исполнены (pick(1) и pick(0)), значит обе строки return покрыты.
    assert.ok(hit("return 1;") > 0);
    assert.ok(hit("return 2;") > 0);
    assert.ok(res.lines[0].id >= LINE_ID_BASE);
  });

  test("функциональные счётчики читаются из памяти", { skip: !LATENTC }, () => {
    const src = "fn f(x) -> int { return x + 1; }\nfn main() -> int { return f(41); }\n";
    const res = instrumentSource(src);
    const p = join(tmp, "fn.lat");
    const w = join(tmp, "fn.wasm");
    writeFileSync(p, res.source, "utf8");
    const { result, inst } = compileAndRun(p, w);
    assert.equal(result, 42);
    const dv = new DataView(inst.exports.memory.buffer);
    const hits = res.functions.map((f) => dv.getUint32(COUNTER_BASE + f.id * 4, true));
    assert.deepEqual(hits, [1, 1]);
  });
});

describe("CLI покрытия", () => {
  test("полный прогон на shc.lat: отчёт, fidelity, валидный JSON", { skip: !existsSync(STAGE1) || !existsSync(SHC) }, () => {
    const json = join(tmp, "cov.json");
    const md = join(tmp, "cov.md");
    const out = join(tmp, "cov.wasm");
    const r = spawnSync(
      NODE,
      [TOOL, "--shc", SHC, "--builder", "stage1", "--no-tests", "--no-fuzz", "--no-examples", "--json", json, "--md", md, "--out", out, "--timeout", "4000"],
      { encoding: "utf8", timeout: 180000 },
    );
    assert.equal(r.status, 0, `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`);
    assert.match(r.stdout, /functions: \d+\/\d+ \([\d.]+%\)/);
    assert.ok(existsSync(json));
    assert.ok(existsSync(md));
    assert.ok(existsSync(out));
    const report = JSON.parse(readFileSync(json, "utf8"));
    assert.equal(report.tool, "selfhost-coverage");
    assert.ok(report.functions.total > 300, `мало функций: ${report.functions.total}`);
    assert.ok(report.functions.covered > 0);
    assert.ok(report.functions.uncovered.every((f) => f.name && f.part));
    assert.equal(report.fidelity.mismatches.length, 0, JSON.stringify(report.fidelity.mismatches.slice(0, 3)));
    assert.ok(report.corpus.total >= 20);
    assert.ok(report.instrumentation.bytes > 1000);
    const mdText = readFileSync(md, "utf8");
    assert.match(mdText, /# Покрытие self-hosted компилятора Latent/);
    assert.match(mdText, /## Непокрытые функции/);
  });

  test("--src собирает те же части, что и build.mjs (маркеры и порядок)", () => {
    const dir = join(REPO, "selfhost", "src");
    const { source, parts } = assembleParts(dir);
    assert.ok(parts.length >= 10);
    assert.deepEqual(parts, [...parts].sort());
    for (const p of parts) assert.match(source, new RegExp(`// ===== часть: ${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} =====`));
    assert.match(source, /^\/\/ СГЕНЕРИРОВАНО/);
  });

  test("ошибка: несуществующий --shc даёт код 2 и понятное сообщение", () => {
    const r = spawnSync(NODE, [TOOL, "--shc", join(tmp, "nope.lat")], { encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /нет файла --shc/);
  });

  test("--min 100 завершаетcя кодом 1 (если покрытие не 100%)", { skip: !existsSync(STAGE1) || !existsSync(SHC) }, () => {
    const r = spawnSync(
      NODE,
      [TOOL, "--shc", SHC, "--builder", "stage1", "--no-tests", "--no-fuzz", "--no-examples", "--min", "100", "--json", join(tmp, "min.json"), "--md", join(tmp, "min.md"), "--timeout", "4000", "--quiet"],
      { encoding: "utf8", timeout: 180000 },
    );
    // Если вдруг покрытие 100%, тест не должен падать: проверяем согласованность.
    const report = JSON.parse(readFileSync(join(tmp, "min.json"), "utf8"));
    assert.equal(r.status, report.gate.passed ? 0 : 1);
  });
});
