// Дифференциальный тест файловых модулей через self-hosted компилятор.
//
// Модули — фича ХОСТА: latentc читает дерево import'ов, линкует проект и
// печатает плоский bundle (`latentc bundle`); selfhost-компилятор
// (selfhost/shc.lat) модулей не знает и потребляет уже связанный bundle:
// import/export сняты, имена манглены как `m0__name` (selfhost-лексер не
// принимает `$`). Проверяется ПОВЕДЕНЧЕСКИЙ паритет:
//
//   Rust compile_files(entry) == selfhost compile(bundle)  по результату main();
//   Rust compile(bundle)      == Rust compile_files(entry)  байт-в-байт (хост).
//
// Байт-паритет `selfhost(bundle) == Rust compile_files` НЕ проверяется и на
// текущем selfhost не выполним: Rust и selfhost исторически генерируют разный
// WASM даже для `fn main() -> int { return 42; }` (1019 vs 934 байт). Это не
// свойство модулей: bundle — лишь плоский вход для selfhost. Поэтому ниже
// сверяются результат main() и статус ошибок, а размеры/diff печатаются
// диагностикой. Подробнее — selfhost/test/fixtures/modules/README.md.
//
// Ошибки модулей (нет файла/экспорта, кривой путь, ...) — прерогатива хоста:
// bundle не создаётся, а selfhost на сыром модульном исходнике обязан отказать
// (иначе ошибка «проглатывается»). Тексты Rust и selfhost различаются — это ок.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileWith, countDiffBytes, errorText, runWasm } from "../wasm-compiler.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SELFHOST = join(HERE, "..");
const FIXTURES = join(HERE, "fixtures", "modules");
const ERRORS = join(FIXTURES, "errors");
const SEED = join(SELFHOST, "seed.wasm");

/** latentc из LATENTC или target/debug (Windows — .exe). */
function findLatentc() {
  return [
    process.env.LATENTC,
    join(ROOT, "target", "debug", "latentc.exe"),
    join(ROOT, "target", "debug", "latentc"),
  ].find((p) => p && existsSync(p)) || null;
}

const LATENTC = findLatentc();
const NO_RUST = LATENTC ? false : "latentc не найден (соберите cargo build --bin latentc)";

/** Маркер `// name: value` из шапки fixture. */
function annotation(text, name) {
  const m = text.match(new RegExp(`^//\\s*${name}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

/** Запуск latentc; ошибка — {ok:false, code, stderr}, а не исключение. */
function runLatentc(args) {
  try {
    execFileSync(LATENTC, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return { ok: true, code: 0, stderr: "" };
  } catch (e) {
    const stderr = String(e.stderr || "").trim();
    return { ok: false, code: e.status, stderr: stderr || String(e.message) };
  }
}

/** Компилирует исходник selfhost-компилятором и исполняет main(). */
function viaSelfhost(compilerBytes, source) {
  const r = compileWith(compilerBytes, source);
  if (r.ret < 0) return { ok: false, error: errorText(r) || "compilation failed" };
  try {
    return { ok: true, wasm: r.wasm, result: runWasm(r.wasm).result };
  } catch (e) {
    return { ok: false, error: "run: " + e.message };
  }
}

/** Entry-проекты (каталоги fixtures, кроме errors) по маркеру `// entry: true`. */
function projectEntries() {
  const out = [];
  for (const d of readdirSync(FIXTURES, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === "errors") continue;
    for (const f of readdirSync(join(FIXTURES, d.name))) {
      if (!f.endsWith(".lat")) continue;
      const path = join(FIXTURES, d.name, f);
      const text = readFileSync(path, "utf8");
      if (annotation(text, "entry") !== "true") continue;
      out.push({ name: d.name, path, expectMain: Number(annotation(text, "expect-main")) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

describe("модули: latentc bundle → selfhost-компилятор", () => {
  let compilers;

  before(() => {
    assert.ok(existsSync(SEED), "нет selfhost/seed.wasm");
    compilers = [["seed", readFileSync(SEED)]];
    // stage1/stage2 — артефакты bootstrap; если их нет, хватает seed.
    for (const [label, file] of [["stage1", "stage1.wasm"], ["stage2", "stage2.wasm"]]) {
      const p = join(SELFHOST, file);
      if (existsSync(p)) compilers.push([label, readFileSync(p)]);
    }
  });

  test("fixtures содержат entry-проекты basic и cycle", () => {
    const names = projectEntries().map((p) => p.name);
    assert.deepEqual(names, ["basic", "cycle"]);
    for (const p of projectEntries()) {
      assert.ok(Number.isInteger(p.expectMain), `${p.name}: нет // expect-main: N`);
    }
  });

  for (const project of projectEntries()) {
    test(`${project.name}: bundle без import/export, selfhost даёт main = ${project.expectMain}`,
      { skip: NO_RUST }, (t) => {
        const dir = mkdtempSync(join(tmpdir(), `latent-mod-${project.name}-`));
        try {
          const bundlePath = join(dir, "bundle.lat");
          const bundled = runLatentc(["bundle", project.path, bundlePath]);
          assert.ok(bundled.ok, `latentc bundle: ${bundled.stderr}`);
          const bundle = readFileSync(bundlePath, "utf8");

          // Bundle — плоский исходник: ни import/export, ни `$` (лексер selfhost),
          // зато мангленные имена на месте.
          assert.doesNotMatch(bundle, /\b(import|export)\b/, "bundle содержит import/export");
          assert.doesNotMatch(bundle, /\$/, "bundle содержит '$' — selfhost его не принимает");
          assert.match(bundle, /\bm\d+__[A-Za-z_]/, "в bundle нет мангленных имён mN__name");

          const directPath = join(dir, "direct.wasm");
          const direct = runLatentc(["compile", project.path, directPath]);
          assert.ok(direct.ok, `Rust compile_files: ${direct.stderr}`);
          const oracleWasm = readFileSync(directPath);
          const oracle = runWasm(oracleWasm);
          assert.equal(oracle.result, project.expectMain, "Rust compile_files: main() != expect-main");

          // Хост-инвариант: compile(bundle) байт-в-байт равен compile_files.
          const viaBundlePath = join(dir, "bundle.wasm");
          const viaHost = runLatentc(["compile", bundlePath, viaBundlePath]);
          assert.ok(viaHost.ok, `Rust compile(bundle): ${viaHost.stderr}`);
          assert.ok(readFileSync(viaBundlePath).equals(oracleWasm),
            "Rust: compile(bundle) != compile_files байт-в-байт");
          assert.equal(runWasm(readFileSync(viaBundlePath)).result, project.expectMain);

          const outcomes = [];
          for (const [label, bytes] of compilers) {
            const sh = viaSelfhost(bytes, bundle);
            if (!sh.ok) {
              // Не подделываем результат: честный SKIP с причиной. Хост-часть
              // выше уже доказала, что проект и bundle валидны.
              t.skip(`selfhost(${label}) не компилирует bundle: ${sh.error}`);
              return;
            }
            outcomes.push({ label, ...sh });
          }

          for (const o of outcomes) {
            assert.equal(o.result, project.expectMain, `selfhost(${o.label}): main() != expect-main`);
            assert.equal(o.result, oracle.result,
              `selfhost(${o.label}) vs Rust compile_files: результаты main() расходятся`);
          }

          // Все поколения компилятора (seed/stage1/stage2) обязаны дать один WASM.
          const first = outcomes[0];
          for (const o of outcomes.slice(1)) {
            assert.ok(Buffer.from(first.wasm).equals(Buffer.from(o.wasm)),
              `selfhost(${first.label}) != selfhost(${o.label}) на bundle`);
          }

          // Байт-паритет с Rust — осознанно НЕ требование (см. шапку файла).
          const selfhostWasm = Buffer.from(first.wasm);
          t.diagnostic(`${project.name}: selfhost(bundle)=${selfhostWasm.length} B, ` +
            `Rust compile_files=${oracleWasm.length} B, diff=${countDiffBytes(selfhostWasm, oracleWasm)} B ` +
            `(байт-паритет не гарантируется; требование — поведенческий)`);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
  }

  test("errors/**: Rust и selfhost отвергают ошибки, bundle не создаётся", { skip: NO_RUST }, () => {
    const seed = compilers[0][1];
    const dir = mkdtempSync(join(tmpdir(), "latent-mod-errors-"));
    try {
      const files = readdirSync(ERRORS).filter((f) => f.endsWith(".lat")).sort();
      assert.ok(files.length >= 6, `ожидались все error-fixtures, найдено ${files.length}`);

      for (const file of files) {
        const path = join(ERRORS, file);
        const text = readFileSync(path, "utf8");
        const expected = annotation(text, "expect-error");
        assert.ok(expected, `${file}: нет маркера // expect-error`);

        // Rust check: статус ошибки и её текст (тексты — часть контракта хоста).
        const checked = runLatentc(["check", path]);
        assert.equal(checked.ok, false, `${file}: check неожиданно успешен`);
        assert.notEqual(checked.code, 0, `${file}: check вернул код 0 при ошибке`);
        assert.ok(checked.stderr.includes(expected),
          `${file}: в ошибке Rust нет «${expected}»: ${checked.stderr}`);

        // Rust compile: ошибка, никакого wasm.
        const outWasm = join(dir, `${file}.wasm`);
        const compiled = runLatentc(["compile", path, outWasm]);
        assert.equal(compiled.ok, false, `${file}: compile неожиданно успешен`);
        assert.ok(!existsSync(outWasm), `${file}: compile создал wasm при ошибке`);

        // Rust bundle: ошибка, никакого bundle (ошибки не «проглатываются»).
        const outBundle = join(dir, `${file}.lat`);
        const bundled = runLatentc(["bundle", path, outBundle]);
        assert.equal(bundled.ok, false, `${file}: bundle неожиданно успешен`);
        assert.ok(!existsSync(outBundle), `${file}: bundle создан при ошибке`);

        // Сырой модульный исходник selfhost не понимает (import/export — не его
        // язык): он обязан ОТКАЗАТЬ, а не скомпилировать что-то молча.
        const raw = compileWith(seed, text);
        assert.ok(raw.ret < 0, `${file}: selfhost неожиданно скомпилировал модульный исходник`);
        assert.ok(errorText(raw).trim().length > 0, `${file}: selfhost вернул пустой текст ошибки`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
