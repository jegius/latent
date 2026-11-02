// Rust-free bootstrap: seed.wasm сам собирает shc.lat и замыкается.
//
// Главное требование «компилятор не требует Rust» проверяется здесь целиком:
//   * seed -> stage1' -> stage2' -> stage3', stage2' === stage3' (latentc нет);
//   * seed.json (sha256/размер/исходник) соответствует файлу;
//   * CLI wasm-compiler.mjs компилирует и запускает пользовательские программы;
//   * ошибки компиляции возвращаются текстом (и кодом 1);
//   * --refresh-seed пересобирает seed без Rust и печатает diff.
//
// latentc/cargo не вызываются: LATENTC указывает на заведомо отсутствующий путь,
// а PATH для дочерних процессов содержит только каталог Node.js.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  compileWith,
  runWasm,
  bytesEqual,
  errorText,
  sha256,
} from "../wasm-compiler.mjs";
import {
  bootstrapWithoutRust,
  refreshSeed,
  verifySeed,
} from "../bootstrap-wasm.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELFHOST = join(HERE, "..");
const NODE = process.execPath;
const CLI = join(SELFHOST, "wasm-compiler.mjs");
const BOOTSTRAP_CLI = join(SELFHOST, "bootstrap-wasm.mjs");
const SEED = join(SELFHOST, "seed.wasm");
const META = join(SELFHOST, "seed.json");
const SRC = join(SELFHOST, "shc.lat");

// Дочерние процессы не должны найти latentc/cargo даже случайно.
const NORUST_ENV = { ...process.env };
NORUST_ENV.LATENTC = join(SELFHOST, "__no_latentc__");
delete NORUST_ENV.LATENT_COMPILER;
delete NORUST_ENV.LATENT_SEED;
delete NORUST_ENV.SEED;
NORUST_ENV.PATH = dirname(NODE);
if (process.platform === "win32") NORUST_ENV.Path = dirname(NODE);

/** Запускает Node-скрипт без Rust в окружении. */
function runNode(args) {
  return spawnSync(NODE, args, { encoding: "utf8", env: NORUST_ENV });
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeTempSource(dir, name, src) {
  const path = join(dir, name);
  writeFileSync(path, src, "utf8");
  return path;
}

describe("Rust-free bootstrap: seed -> stage1' -> stage2' -> stage3'", () => {
  test("seed.wasm соответствует seed.json (sha256, размер, исходник)", () => {
    assert.ok(existsSync(SEED), "нет selfhost/seed.wasm");
    assert.ok(existsSync(META), "нет selfhost/seed.json");
    const seed = readFileSync(SEED);
    const meta = JSON.parse(readFileSync(META, "utf8"));
    assert.ok(WebAssembly.validate(seed), "seed.wasm невалиден");
    assert.equal(meta.seedBytes, seed.length, "seed.json: неверный размер seed");
    assert.equal(meta.seedSha256, sha256(seed), "seed.json: неверный sha256 seed");
    assert.equal(
      meta.shcSha256,
      sha256(readFileSync(SRC)),
      "seed устарел: shc.lat изменился после сборки seed — выполните " +
        "node selfhost/bootstrap-wasm.mjs --refresh-seed",
    );
    assert.ok(meta.compilerVersion, "seed.json: нет compilerVersion");
    assert.ok(meta.seedRevision >= 1, "seed.json: нет seedRevision");
  });

  test("verifySeed(): все проверки проходят без Rust", () => {
    const result = verifySeed();
    for (const check of result.checks) {
      assert.ok(check.ok, `${check.name}: ${check.detail}`);
    }
    assert.ok(result.ok);
  });

  test("verifySeed(): обнаруживает подменённый seed", () => {
    const dir = tempDir("latent-tamper-");
    const tampered = Buffer.from(readFileSync(SEED));
    tampered[0] = tampered[0] ^ 0xff; // ломаем WASM-магию
    const tamperedPath = join(dir, "seed.wasm");
    writeFileSync(tamperedPath, tampered);
    const result = verifySeed({ seedPath: tamperedPath, metaPath: META });
    assert.equal(result.ok, false, "подменённый seed не должен проходить проверку");
    const hashCheck = result.checks.find((c) => c.name === "seedSha256");
    assert.equal(hashCheck.ok, false);
  });

  let boot;
  before(() => {
    const seed = readFileSync(SEED);
    boot = bootstrapWithoutRust({ seedBytes: seed, source: readFileSync(SRC, "utf8") });
  });

  test("цепочка seed -> stage1' -> stage2' -> stage3' замыкается (без Rust)", () => {
    for (const [name, stage] of [
      ["stage-sh-1", boot.stage1],
      ["stage-sh-2", boot.stage2],
      ["stage-sh-3", boot.stage3],
    ]) {
      assert.ok(WebAssembly.validate(stage), `${name} невалиден`);
    }
    assert.ok(
      bytesEqual(boot.stage2, boot.stage3),
      "фиксированная точка не достигнута: stage2' !== stage3' (без Rust)",
    );
    assert.equal(boot.fixed, true);
  });

  test("seed актуален: stage1' === seed (иначе нужен --refresh-seed)", () => {
    assert.ok(
      bytesEqual(boot.stage1, readFileSync(SEED)),
      "seed устарел: seed компилирует shc.lat не в себя; выполните " +
        "node selfhost/bootstrap-wasm.mjs --refresh-seed",
    );
  });

  test("CLI bootstrap-wasm.mjs печатает FIXED POINT без Rust", () => {
    const r = runNode([BOOTSTRAP_CLI, "--no-write"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /FIXED POINT/);
    assert.match(r.stdout, /stage-sh-2 === stage-sh-3/);
    // latentc/cargo не запускаются: в окружении их нет.
    assert.ok(!/cargo|latentc/i.test(r.stdout + r.stderr));
  });

  test("stage2' (собранный без Rust) компилирует программу", () => {
    const { wasm, ret } = compileWith(boot.stage2, 'fn main() -> int { print("stage2"); return 42; }');
    assert.ok(ret >= 0, "stage2' вернул ошибку компиляции");
    const run = runWasm(wasm);
    assert.equal(run.result, 42);
    assert.deepEqual(run.output, ["stage2"]);
  });

  test("--verify-seed завершается с кодом 0", () => {
    const r = runNode([BOOTSTRAP_CLI, "--verify-seed"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /OK\s+seedSha256/);
  });
});

describe("CLI без Rust: compile/check/run/version", () => {
  const PROGRAMS = {
    hello: {
      src: 'fn main() -> int { print("hello"); return 42; }',
      main: 42,
      output: ["hello"],
    },
    classes: {
      src: `class Point {
  x: int;
  y: int;
  fn init(x: int, y: int) { this.x = x; this.y = y; }
  fn norm2() -> int { return this.x * this.x + this.y * this.y; }
}
fn main() -> int { let p = new Point(3, 4); return p.norm2() + 17; }`,
      main: 42,
      output: [],
    },
    enum: {
      src: `enum Color { Red, Green, Blue }
fn main() -> int {
  let c = Green;
  return match c { case Green(): 42, default: 0 };
}`,
      main: 42,
      output: [],
    },
    match: {
      src: `fn main() -> int {
  let x = 2;
  return match x { case 1: 10, case 2: 42, default: 0 };
}`,
      main: 42,
      output: [],
    },
    float: {
      src: `fn main() -> int {
  let x: float = 2.5;
  let y = x * 2.0;
  return int(y) + 37;
}`,
      main: 42,
      output: [],
    },
  };

  for (const [name, c] of Object.entries(PROGRAMS)) {
    test(`CLI компилирует и запускает ${name}`, () => {
      const dir = tempDir("latent-cli-");
      const srcPath = writeTempSource(dir, `${name}.lat`, c.src);
      const outPath = join(dir, `${name}.wasm`);
      const r = runNode([CLI, "compile", srcPath, outPath]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(outPath), "CLI не создал .wasm");
      const wasm = readFileSync(outPath);
      assert.ok(WebAssembly.validate(wasm), "CLI вернул невалидный WASM");
      const run = runWasm(wasm);
      assert.equal(run.result, c.main, "main() вернул не то значение");
      assert.deepEqual(run.output, c.output);
    });
  }

  test("CLI check: валидная программа — код 0", () => {
    const dir = tempDir("latent-check-");
    const srcPath = writeTempSource(dir, "ok.lat", "fn main() -> int { return 42; }");
    const r = runNode([CLI, "check", srcPath]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^OK: /m);
  });

  test("CLI check: ошибка — код 1 и текст ошибки", () => {
    const dir = tempDir("latent-check-");
    const srcPath = writeTempSource(dir, "bad.lat", "fn main() -> int { return nosuch(1); }");
    const r = runNode([CLI, "check", srcPath]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /error: undefined function: nosuch/);
  });

  test("CLI run: печатает вывод и код выхода = main()", () => {
    const dir = tempDir("latent-run-");
    const srcPath = writeTempSource(
      dir,
      "run.lat",
      'fn main() -> int { print("hello"); return 42; }',
    );
    const r = runNode([CLI, "run", srcPath]);
    assert.equal(r.status, 42);
    assert.match(r.stdout, /hello/);
    assert.match(r.stdout, /main\(\) = 42/);
  });

  test("CLI version: печатает версию, sha256 и сверку seed.json", () => {
    const meta = JSON.parse(readFileSync(META, "utf8"));
    const r = runNode([CLI, "version"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /latent self-hosted WASM compiler/);
    assert.ok(r.stdout.includes(meta.seedSha256), "в version нет sha256 seed");
    assert.match(r.stdout, /seed revision \d+/);
    assert.match(r.stdout, /seed\.json\s*: совпадает/);
    assert.match(r.stdout, /source\s*: .*совпадает с seed\.json/);
  });

  test("CLI version --compiler stage-sh-2: показывает hash стадии", () => {
    const seed = readFileSync(SEED);
    const boot = bootstrapWithoutRust({ seedBytes: seed, source: readFileSync(SRC, "utf8") });
    const dir = tempDir("latent-stage-");
    const stagePath = join(dir, "stage-sh-2.wasm");
    writeFileSync(stagePath, boot.stage2);
    const r = runNode([CLI, "version", "--compiler", stagePath, "--meta", META]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(sha256(boot.stage2)), "в version нет sha256 стадии");
    assert.match(r.stdout, /seed\.json\s*: совпадает/);
  });
});

describe("ошибки компиляции: текст вместо WASM", () => {
  const CASES = [
    ["undefined function", "fn main() -> int { return nosuch(1); }", /undefined function: nosuch/],
    ["type mismatch", "fn main() -> int { let x: string = 1; return 0; }", /type mismatch/],
    ["host builtin", "fn main() -> int { let c = channel(); return 0; }", /channel/i],
  ];

  for (const [name, src, re] of CASES) {
    test(`seed возвращает текст ошибки: ${name}`, () => {
      const result = compileWith(readFileSync(SEED), src);
      assert.ok(result.ret < 0, "ожидалась ошибка компиляции");
      assert.match(errorText(result), re);
      assert.ok(!WebAssembly.validate(result.wasm), "текст ошибки не должен быть WASM");
    });
  }
});

describe("--refresh-seed: пересборка seed без Rust", () => {
  test("refreshSeed пересобирает seed и обновляет seed.json (diff 0 для текущего shc.lat)", () => {
    const dir = tempDir("latent-refresh-");
    const seedCopy = join(dir, "seed.wasm");
    const metaCopy = join(dir, "seed.json");
    copyFileSync(SEED, seedCopy);
    copyFileSync(META, metaCopy);
    const oldMeta = JSON.parse(readFileSync(metaCopy, "utf8"));

    const result = refreshSeed({
      seedPath: seedCopy,
      metaPath: metaCopy,
      sourcePath: SRC,
      log: () => {},
    });

    assert.equal(result.changed, false, "текущий shc.lat должен давать байт-в-байт тот же seed");
    assert.equal(result.diffBytes, 0);
    assert.ok(bytesEqual(readFileSync(seedCopy), result.stage2), "seed на диске не равен stage2'");
    assert.ok(bytesEqual(result.stage2, result.stage3), "нет фиксированной точки");

    const meta = JSON.parse(readFileSync(metaCopy, "utf8"));
    assert.equal(meta.seedSha256, sha256(result.stage2));
    assert.equal(meta.seedBytes, result.stage2.length);
    assert.equal(meta.shcSha256, sha256(readFileSync(SRC)));
    assert.equal(meta.fixedPoint, true);
    assert.equal(meta.seedRevision, oldMeta.seedRevision, "seed не менялся — ревизия не растёт");
    assert.ok(meta.updatedAt);
  });

  test("refreshSeed обновляет shcSha256, даже если байты seed не изменились", () => {
    const dir = tempDir("latent-refresh-meta-");
    const seedCopy = join(dir, "seed.wasm");
    const metaCopy = join(dir, "seed.json");
    copyFileSync(SEED, seedCopy);
    copyFileSync(META, metaCopy);
    // Комментарий не влияет на кодоген: компилятор получается тот же, но
    // исходник другой — манифест обязан обновить shcSha256/shcBytes.
    const changedSource = readFileSync(SRC, "utf8") + "\n// refresh metadata test\n";

    const result = refreshSeed({
      seedPath: seedCopy,
      metaPath: metaCopy,
      source: changedSource,
      log: () => {},
    });

    assert.equal(result.changed, false, "кодоген не должен измениться от комментария");
    const meta = JSON.parse(readFileSync(metaCopy, "utf8"));
    assert.equal(meta.shcSha256, sha256(Buffer.from(changedSource, "utf8")));
    assert.notEqual(meta.shcSha256, sha256(readFileSync(SRC)));
    assert.equal(meta.seedSha256, sha256(readFileSync(SEED)));
  });

  test("refreshSeed --dry-run не пишет файлы", () => {    const dir = tempDir("latent-refresh-dry-");
    const seedCopy = join(dir, "seed.wasm");
    const metaCopy = join(dir, "seed.json");
    copyFileSync(SEED, seedCopy);
    copyFileSync(META, metaCopy);
    const metaBefore = readFileSync(metaCopy);
    const seedBefore = readFileSync(seedCopy);

    const result = refreshSeed({
      seedPath: seedCopy,
      metaPath: metaCopy,
      sourcePath: SRC,
      dryRun: true,
      log: () => {},
    });

    assert.equal(result.wrote, false);
    assert.ok(bytesEqual(readFileSync(seedCopy), seedBefore));
    assert.ok(bytesEqual(readFileSync(metaCopy), metaBefore));
  });

  test("CLI --refresh-seed --dry-run печатает diff и не меняет файлы", () => {
    const seedBefore = sha256(readFileSync(SEED));
    const metaBefore = readFileSync(META);
    const r = runNode([BOOTSTRAP_CLI, "--refresh-seed", "--dry-run"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FIXED POINT/);
    assert.match(r.stdout, /diff seed:/);
    assert.equal(sha256(readFileSync(SEED)), seedBefore, "dry-run изменил seed.wasm");
    assert.ok(bytesEqual(readFileSync(META), metaBefore), "dry-run изменил seed.json");
  });
});
