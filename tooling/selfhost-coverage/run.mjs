#!/usr/bin/env node
// Сбор покрытия self-hosted компилятора Latent (selfhost/shc.lat).
//
//   node tooling/selfhost-coverage/run.mjs
//   node tooling/selfhost-coverage/run.mjs --shc selfhost/shc.lat --out coverage.wasm --json cov.json --min 90
//
// Что делает:
//   1. читает shc.lat (или собирает из --src);
//   2. инструментирует каждую функцию верхнего уровня вызовом cov_bump(ID)
//      (и, при --lines, каждую инструкцию верхнего уровня — cov_line(ID));
//      счётчики живут в линейной памяти по адресам 32768..65535;
//   3. собирает инструментированный компилятор (latentc, stage1 или готовый wasm);
//   4. прогоняет корпус (тесты selfhost/test, shc.lat, примеры, пробы, фаззинг),
//      считывает счётчики после каждого прогона и проверяет fidelity:
//      инструментированный компилятор обязан выдавать ТЕ ЖЕ байты, что исходный;
//   5. пишет JSON + Markdown и завершается с кодом 1, если покрытие < --min.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

import { instrumentSource, findPreambleConflicts, COUNTER_BASE, LINE_COUNTER_BASE } from "./src/instrument.mjs";
import { findLatentc, compileWithLatentc, runCompiler, stage1Freshness } from "./src/compiler.mjs";
import { loadCompilerSource, listParts } from "./src/source.mjs";
import { buildCorpus, corpusSummary } from "./src/corpus.mjs";
import { buildReport, renderMarkdown } from "./src/report.mjs";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOL_DIR, "..", "..");

function usage() {
  return `Использование: node tooling/selfhost-coverage/run.mjs [опции]

  --shc <path>         собранный компилятор (по умолчанию selfhost/shc.lat)
  --src <dir>          собрать компилятор из частей selfhost/src
  --out <path>         куда сохранить инструментированный компилятор (.wasm)
  --json <path>        JSON-отчёт (по умолчанию tooling/selfhost-coverage/coverage.json)
  --md <path>          Markdown-отчёт (по умолчанию tooling/selfhost-coverage/coverage.md)
  --min <n>            порог покрытия функций в %, exit 1 если ниже (по умолчанию 0)
  --builder <kind>     auto | latentc | stage1 | <path к .wasm> (по умолчанию auto)
  --latentc <path>     путь к нативному latentc (или env LATENTC)
  --tests <dir>        каталог selfhost-тестов (по умолчанию selfhost/test)
  --no-tests           не брать кейсы из тестов
  --no-examples        не брать web-ide/examples
  --no-fuzz            не генерировать фаззинг-корпус
  --fuzz <n>           число фаззинг-программ (по умолчанию 24)
  --timeout <ms>       таймаут одного прогона компилятора (по умолчанию 3000)
  --lines              включить приблизительное покрытие инструкций
  --instrumented <p>   сохранить инструментированный исходник .lat
  --keep               не удалять временные файлы
  --quiet              только итоговая строка
  -h, --help           эта справка
`;
}

function parseArgs(argv) {
  const args = {
    shc: null,
    src: null,
    out: null,
    json: join(TOOL_DIR, "coverage.json"),
    md: join(TOOL_DIR, "coverage.md"),
    min: 0,
    builder: "auto",
    latentc: null,
    tests: join(REPO_ROOT, "selfhost", "test"),
    examples: join(REPO_ROOT, "web-ide", "examples"),
    includeTests: true,
    includeExamples: true,
    fuzz: 24,
    timeout: 3000,
    lines: false,
    instrumented: null,
    keep: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`опция ${a} требует значения`);
      return v;
    };
    switch (a) {
      case "--shc": args.shc = take(); break;
      case "--src": args.src = take(); break;
      case "--out": args.out = take(); break;
      case "--json": args.json = take(); break;
      case "--md": args.md = take(); break;
      case "--min": args.min = Number(take()); break;
      case "--builder": args.builder = take(); break;
      case "--latentc": args.latentc = take(); break;
      case "--tests": args.tests = take(); break;
      case "--no-tests": args.includeTests = false; break;
      case "--no-examples": args.includeExamples = false; break;
      case "--no-fuzz": args.fuzz = 0; break;
      case "--fuzz": args.fuzz = Number(take()); break;
      case "--timeout": args.timeout = Number(take()); break;
      case "--lines": args.lines = true; break;
      case "--instrumented": args.instrumented = take(); break;
      case "--keep": args.keep = true; break;
      case "--quiet": args.quiet = true; break;
      case "-h":
      case "--help": process.stdout.write(usage()); process.exit(0); break;
      default:
        throw new Error(`неизвестная опция: ${a}\n\n${usage()}`);
    }
  }
  if (!Number.isFinite(args.min) || args.min < 0 || args.min > 100) throw new Error("--min должен быть 0..100");
  if (!Number.isFinite(args.fuzz) || args.fuzz < 0) throw new Error("--fuzz должен быть >= 0");
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error("--timeout должен быть > 0");
  return args;
}

const log = (quiet, ...msg) => { if (!quiet) console.error(...msg); };

/** Разрешает сборщик инструментированного компилятора. */
function resolveBuilder(kind, latentcPath, repoRoot, selfhostDir) {
  if (kind === "latentc") {
    const p = findLatentc(latentcPath, repoRoot);
    if (!p) throw new Error("latentc не найден: соберите cargo build --bin latentc или задайте --latentc/LATENTC");
    return { kind: "latentc", path: p };
  }
  if (kind === "stage1") {
    const p = join(selfhostDir, "stage1.wasm");
    if (!existsSync(p)) throw new Error(`нет ${p}; соберите node selfhost/bootstrap.mjs`);
    return { kind: "stage1", path: p };
  }
  if (kind !== "auto") {
    if (!existsSync(kind)) throw new Error(`--builder ${kind}: файл не найден`);
    return { kind: "wasm", path: resolve(kind) };
  }
  const p = findLatentc(latentcPath, repoRoot);
  if (p) return { kind: "latentc", path: p };
  const s1 = join(selfhostDir, "stage1.wasm");
  if (existsSync(s1)) return { kind: "stage1", path: s1 };
  throw new Error("не найден ни latentc, ни selfhost/stage1.wasm");
}

/** Собирает wasm-компилятор из исходника выбранным сборщиком. */
function buildCompiler(builder, source, tmpDir, label) {
  if (builder.kind === "latentc") {
    const src = join(tmpDir, `${label}.lat`);
    const out = join(tmpDir, `${label}.wasm`);
    writeFileSync(src, source, "utf8");
    return compileWithLatentc(builder.path, src, out);
  }
  const bytes = readFileSync(builder.path);
  const r = runCompiler(bytes, source);
  if (r.trapped || r.ret < 0) {
    const text = new TextDecoder().decode(r.wasm) || r.error || "";
    throw new Error(`сборщик ${builder.kind} не скомпилировал ${label}: ret=${r.ret} ${text.slice(0, 300)}`);
  }
  return r.wasm;
}

function runOutput(wasmBytes) {
  if (!WebAssembly.validate(wasmBytes)) throw new Error("выходной WASM невалиден");
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), { env: { print: () => {} } });
  return inst.exports.main();
}

/**
 * Долгоживущий worker с жёстким таймаутом на один прогон.
 *
 * Worker переиспользуется между кейсами (старт потока на Windows дорог),
 * но при таймауте/падении убивается и создаётся заново. Это даёт и скорость,
 * и защиту от известных зависаний selfhost на структурных аннотациях.
 */
class CaseRunner {
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this.seq = 0;
    this.pending = null;
    this.closed = false;
  }

  #ensure() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./src/worker.mjs", import.meta.url), {
      workerData: { abi: {}, counterBase: COUNTER_BASE, counterWords: 8192 },
    });
    w.on("message", (msg) => {
      const p = this.pending;
      if (p && msg.id === p.id) {
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve({ ...msg, timeout: false });
      }
    });
    w.on("error", (err) => this.#crash(w, err));
    w.on("exit", (code) => {
      // Штатное завершение в close() уже обнулило this.worker, поэтому сюда
      // попадает только неожиданный выход (в т.ч. code 0) при живом pending.
      if (this.worker === w) this.#crash(w, new Error(`worker exit ${code}`));
    });
    this.worker = w;
    return w;
  }

  #crash(w, err) {
    if (this.worker === w) this.worker = null;
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      p.resolve({ ret: -1, trapped: true, timeout: false, error: String(err), wasmHash: "", wasmLen: 0, counters: new Uint8Array(8192 * 4) });
    }
  }

  run(compilerPath, source) {
    if (this.closed) throw new Error("CaseRunner закрыт");
    const w = this.#ensure();
    const id = ++this.seq;
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        if (!this.pending || this.pending.id !== id) return;
        this.pending = null;
        if (this.worker === w) {
          this.worker = null;
          w.terminate().catch(() => {});
        }
        resolvePromise({ ret: 0, trapped: false, timeout: true, wasmHash: "", wasmLen: 0, counters: new Uint8Array(8192 * 4) });
      }, this.timeoutMs);
      this.pending = { id, timer, resolve: resolvePromise };
      try {
        w.postMessage({ id, compilerPath, source, abi: {} });
      } catch (e) {
        this.pending = null;
        clearTimeout(timer);
        resolvePromise({ ret: -1, trapped: true, timeout: false, error: String(e), wasmHash: "", wasmLen: 0, counters: new Uint8Array(8192 * 4) });
      }
    });
  }

  close() {
    this.closed = true;
    const w = this.worker;
    this.worker = null;
    if (w) w.terminate().catch(() => {});
  }
}

function counterHits(counters, id) {
  const off = id * 4;
  if (off + 4 > counters.byteLength) return 0;
  return new DataView(counters.buffer, counters.byteOffset, counters.byteLength).getUint32(off, true);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function main(argv) {
  const args = parseArgs(argv);
  const selfhostDir = args.shc
    ? dirname(resolve(args.shc))
    : args.src
      ? resolve(args.src, "..")
      : join(REPO_ROOT, "selfhost");
  const loaded = loadCompilerSource({ shc: args.shc, src: args.src, repoRoot: REPO_ROOT });
  const sourceBytes = Buffer.from(loaded.source, "utf8");
  log(args.quiet, `исходник: ${loaded.path} (${sourceBytes.length} байт, режим ${loaded.mode})`);

  const conflicts = findPreambleConflicts(loaded.source);
  if (conflicts.length > 0) throw new Error(`в исходнике уже есть функции ${conflicts.join(", ")}: конфликт с преамбулой инструментатора`);

  const instr = instrumentSource(loaded.source, { lines: args.lines });
  log(args.quiet, `инструментация: функций ${instr.functions.length}, строчных счётчиков ${instr.lines.length}`);

  if (args.instrumented) {
    mkdirSync(dirname(args.instrumented), { recursive: true });
    writeFileSync(args.instrumented, instr.source, "utf8");
  }

  const builder = resolveBuilder(args.builder, args.latentc, REPO_ROOT, selfhostDir);
  let freshness = null;
  if (builder.kind === "stage1") {
    const watched = [loaded.mode === "shc" ? resolve(args.shc ?? loaded.path) : join(selfhostDir, "shc.lat")];
    freshness = stage1Freshness(builder.path, watched);
    if (freshness.stale) log(args.quiet, `ВНИМАНИЕ: ${freshness.reason}`);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "selfhost-coverage-"));
  let outPath = args.out;
  if (!outPath) outPath = join(tmpDir, "instrumented-compiler.wasm");
  let runner = null;
  let origRunner = null;
  try {
    log(args.quiet, `сборка инструментированного компилятора (${builder.kind})…`);
    const instrBytes = buildCompiler(builder, instr.source, tmpDir, "instrumented-shc");
    if (!WebAssembly.validate(instrBytes)) throw new Error("инструментированный компилятор невалиден — инструментация ломает сборку");
    writeFileSync(outPath, instrBytes);

    // Smoke: инструментированный компилятор обязан компилировать простую программу.
    const smokeSrc = "fn main() -> int { return 7; }\n";
    const smoke = runCompiler(instrBytes, smokeSrc);
    if (smoke.trapped || smoke.ret < 0) {
      throw new Error(`инструментированный компилятор не компилирует smoke-программу: ret=${smoke.ret} ${smoke.error ?? ""}`);
    }
    const smokeResult = runOutput(smoke.wasm);
    if (smokeResult !== 7) throw new Error(`smoke: main() вернул ${smokeResult}, ожидалось 7`);

    const corpus = buildCorpus({
      testDir: args.tests,
      examplesDir: args.examples,
      shcSource: loaded.source,
      shcName: loaded.mode === "shc" ? "shc.lat" : "shc.lat (из src)",
      fuzz: args.fuzz,
      includeTests: args.includeTests,
      includeExamples: args.includeExamples,
    });
    const summary = corpusSummary(corpus);
    log(args.quiet, `корпус: ${summary.total} программ (${Object.entries(summary.byKind).map(([k, v]) => `${k}=${v}`).join(", ")})`);

    const fnHits = new Array(instr.functions.length).fill(0);
    const lineHits = new Array(instr.lines.length).fill(0);
    const cases = [];
    const caseRuns = [];
    runner = new CaseRunner(args.timeout);

    for (const c of corpus) {
      // Прогон в долгоживущем worker: зависший компилятор убивается по
      // таймауту и не вешает весь сбор покрытия (известные зависания
      // selfhost на структурных аннотациях — см. selfhost-gaps.md, PR10).
      const r = await runner.run(outPath, c.source);
      let hit = 0;
      if (!r.timeout) {
        for (let id = 0; id < instr.functions.length; id++) {
          if (counterHits(r.counters, id) > 0) { fnHits[id]++; hit++; }
        }
        for (let i = 0; i < instr.lines.length; i++) {
          if (counterHits(r.counters, instr.lines[i].id) > 0) lineHits[i]++;
        }
      }
      const ok = !r.timeout && !r.trapped && r.ret >= 0;
      cases.push({
        name: c.name,
        kind: c.kind,
        ok,
        trapped: r.trapped,
        timeout: r.timeout,
        ret: r.ret,
        error: ok ? undefined : r.timeout ? `timeout ${args.timeout}ms` : r.errorText ?? r.error,
        functionsHit: hit,
      });
      caseRuns.push({ name: c.name, source: c.source, hash: r.wasmHash, len: r.wasmLen, ret: r.ret, trapped: r.trapped, timeout: r.timeout });
      if (!args.quiet && cases.length % 20 === 0) log(false, `  прогон ${cases.length}/${corpus.length}…`);
    }

    // Fidelity: неинструментированный компилятор, собранный тем же сборщиком,
    // обязан давать те же байты, что инструментированный. Если есть свежий
    // stage1.wasm (его собрал latentc из этого же shc.lat), переиспользуем его:
    // это экономит второй 15-секундный прогон нативного компилятора.
    log(args.quiet, "проверка fidelity инструментации…");
    let originalPath;
    if (builder.kind === "latentc") {
      const watched = loaded.mode === "src"
        ? [...listParts(args.src).map((p) => join(args.src, p))]
        : [resolve(args.shc ?? loaded.path)];
      const cachedStage1 = join(selfhostDir, "stage1.wasm");
      const fresh = stage1Freshness(cachedStage1, watched);
      if (fresh.exists && !fresh.stale) {
        originalPath = cachedStage1;
        log(args.quiet, `fidelity: использую свежий ${cachedStage1}`);
      } else {
        originalPath = join(tmpDir, "original-shc.wasm");
        writeFileSync(originalPath, buildCompiler(builder, loaded.source, tmpDir, "original-shc"));
      }
    } else {
      originalPath = builder.path;
    }
    let checked = 0;
    const mismatches = [];
    origRunner = new CaseRunner(args.timeout);
    for (const run of caseRuns) {
      const orig = await origRunner.run(originalPath, run.source);
      if (orig.timeout) continue; // исходный selfhost тоже зависает — сравнивать нечего
      checked++;
      if (run.timeout) {
        mismatches.push({ name: run.name, reason: `инструментированный завис (>${args.timeout}ms), исходный — нет` });
        continue;
      }
      if (run.trapped) {
        mismatches.push({ name: run.name, reason: `инструментированный трапит: ${run.error ?? ""}` });
        continue;
      }
      if (orig.trapped) continue;
      if ((orig.ret < 0) !== (run.ret < 0)) {
        mismatches.push({ name: run.name, reason: `код возврата: исходный ${orig.ret}, инструментированный ${run.ret}` });
        continue;
      }
      if (orig.wasmHash !== run.hash) {
        mismatches.push({ name: run.name, reason: `вывод различается: ${orig.wasmLen} vs ${run.len} байт` });
      }
    }

    const report = buildReport({
      source: {
        path: loaded.path,
        mode: loaded.mode,
        parts: loaded.parts,
        bytes: sourceBytes.length,
        sha256: sha256(sourceBytes),
      },
      builder: {
        kind: builder.kind,
        path: builder.kind === "latentc" ? builder.path : builder.path,
        bytes: instrBytes.length,
        stale: freshness?.stale ?? false,
        reason: freshness?.reason,
      },
      instrumentation: {
        lines: args.lines,
        functions: instr.functions.length,
        lineCounters: instr.lines.length,
        counterBase: COUNTER_BASE,
        lineCounterBase: LINE_COUNTER_BASE,
        bytes: Buffer.byteLength(instr.source, "utf8"),
      },
      functions: instr.functions,
      functionHits: fnHits,
      lines: instr.lines,
      lineHits,
      corpus: cases,
      fidelity: { checked, mismatches },
      gate: { min: args.min },
    });

    const command =
      `node tooling/selfhost-coverage/run.mjs${args.shc ? ` --shc ${args.shc}` : ""}${args.src ? ` --src ${args.src}` : ""}` +
      `${args.lines ? " --lines" : ""}${args.min ? ` --min ${args.min}` : ""}`;
    writeJson(args.json, report);
    mkdirSync(dirname(args.md), { recursive: true });
    writeFileSync(args.md, renderMarkdown(report, { run: command }), "utf8");

    log(args.quiet, `отчёт: ${args.json}, ${args.md}`);
    log(args.quiet, `инструментированный компилятор: ${outPath} (${instrBytes.length} байт)`);

    const line = report.lines ? `, строки ${report.lines.percent}%` : "";
    process.stdout.write(
      `functions: ${report.functions.covered}/${report.functions.total} (${report.functions.percent}%)${line}; ` +
        `corpus ${report.corpus.total} (fail ${report.corpus.failed}), fidelity mismatches ${mismatches.length}` +
        `${report.gate.min ? `; min ${report.gate.min}% -> ${report.gate.passed ? "PASS" : "FAIL"}` : ""}\n`,
    );

    if (mismatches.length > 0) {
      process.stderr.write(`selfhost-coverage: ${mismatches.length} расхождений fidelity — инструментация изменила семантику\n`);
      return 1;
    }
    if (!report.gate.passed) return 1;
    return 0;
  } finally {
    if (runner) runner.close();
    if (origRunner) origRunner.close();
    if (!args.keep) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      if (!args.out) { try { rmSync(outPath, { force: true }); } catch { /* ignore */ } }
    }
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`selfhost-coverage: ${err && err.stack ? err.stack : err}\n`);
    process.exit(2);
  });
