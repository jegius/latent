// Rust-free bootstrap самохостящегося компилятора Latent.
//
// В репозитории лежит seed.wasm — уже собранный компилятор Latent→WASM.
// Им можно собрать shc.lat и замкнуться, не запуская ни cargo, ни latentc:
//
//   seed        -> shc.lat -> stage-sh-1.wasm   (stage1')
//   stage-sh-1  -> shc.lat -> stage-sh-2.wasm   (stage2')
//   stage-sh-2  -> shc.lat -> stage-sh-3.wasm   (stage3')
//   проверка: stage-sh-2 === stage-sh-3          (то же, что stage2' === stage3')
//
// Имена stage-sh-*.wasm не пересекаются с stage1/2/3.wasm Rust-цепочки
// (bootstrap.mjs); все они покрыты .gitignore (`selfhost/stage*.wasm`).
//
// seed обновляется при изменении компилятора/языка БЕЗ Rust:
//
//   node selfhost/bootstrap-wasm.mjs --refresh-seed
//
// Происхождение seed фиксируется в selfhost/seed.json (sha256, размер,
// sha256 исходника shc.lat, версия, дата). seed — доверенная начальная точка:
// его целостность проверяется по sha256, а `--verify-seed` сверяет файл и
// метаданные.
//
// Запуск:
//   node selfhost/bootstrap-wasm.mjs               # цепочка + FIXED POINT
//   node selfhost/bootstrap-wasm.mjs --refresh-seed [--dry-run]
//   node selfhost/bootstrap-wasm.mjs --verify-seed
//   node selfhost/bootstrap-wasm.mjs --no-write    # только проверка

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compileWith,
  bytesEqual,
  errorText,
  firstDiffIndex,
  countDiffBytes,
  sha256,
  DEFAULT_COMPILER,
} from "./wasm-compiler.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SEED = DEFAULT_COMPILER;
export const DEFAULT_META = join(HERE, "seed.json");
export const DEFAULT_SOURCE = join(HERE, "shc.lat");

/** Имена stage-артефактов Rust-free цепочки (не пересекаются с Rust-цепочкой). */
export const STAGE_NAMES = ["stage-sh-1.wasm", "stage-sh-2.wasm", "stage-sh-3.wasm"];

const META_PURPOSE = "seed-компилятор для Rust-free bootstrap (selfhost/bootstrap-wasm.mjs)";
const META_ORIGIN =
  "исходно собран latentc (Rust) из selfhost/shc.lat; дальше — self-compiled: " +
  "seed.wasm компилирует shc.lat сам в себя (Rust в сборке не участвует)";
const META_HOW_TO_UPDATE =
  "node selfhost/bootstrap-wasm.mjs --refresh-seed (после node selfhost/build.mjs; без Rust)";
const META_NOTE =
  "seed — доверенная начальная точка. Проверка: sha256 в seed.json / " +
  "node selfhost/bootstrap-wasm.mjs --verify-seed. Rust для сборки компилятора и " +
  "пользовательских программ не требуется.";

function display(path) {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}

function readMeta(metaPath) {
  try {
    return JSON.parse(readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Компилирует source компилятором-байтами; ошибка компиляции — исключение. */
export function compileStage(compilerBytes, source, label) {
  const result = compileWith(compilerBytes, source);
  if (result.ret < 0) {
    throw new Error(`${label} не скомпилировал shc.lat: ${errorText(result) || "compilation failed"}`);
  }
  if (!WebAssembly.validate(result.wasm)) {
    throw new Error(`${label} вернул невалидный WASM`);
  }
  return result.wasm;
}

/** Собирает компилятор seed-компилятором (Rust-free, один шаг). */
export function compileFromSeed(seedBytes, source) {
  return compileStage(seedBytes, source, "seed");
}

/**
 * Полный Rust-free цикл: seed -> stage1' -> stage2' -> stage3'.
 * latentc/cargo не участвуют.
 *
 * @returns {{stage1: Uint8Array, stage2: Uint8Array, stage3: Uint8Array, fixed: boolean}}
 */
export function bootstrapWithoutRust({ seedBytes, source }) {
  if (!WebAssembly.validate(seedBytes)) throw new Error("seed.wasm невалиден");
  const stage1 = compileStage(seedBytes, source, "seed");
  const stage2 = compileStage(stage1, source, "stage-sh-1");
  const stage3 = compileStage(stage2, source, "stage-sh-2");
  return { stage1, stage2, stage3, fixed: bytesEqual(stage2, stage3) };
}

/**
 * Проверяет целостность seed: файл ↔ seed.json ↔ shc.lat.
 * @returns {{ok: boolean, checks: {name: string, ok: boolean, detail: string}[]}}
 */
export function verifySeed({
  seedPath = DEFAULT_SEED,
  metaPath = DEFAULT_META,
  sourcePath = DEFAULT_SOURCE,
} = {}) {
  const checks = [];
  if (!existsSync(seedPath)) {
    return { ok: false, checks: [{ name: "seed.wasm", ok: false, detail: `нет файла ${seedPath}` }] };
  }
  const seedBytes = readFileSync(seedPath);
  const actualHash = sha256(seedBytes);
  const meta = readMeta(metaPath);

  checks.push({
    name: "seed.wasm валиден",
    ok: WebAssembly.validate(seedBytes),
    detail: `${seedBytes.length} байт`,
  });

  if (!meta) {
    checks.push({ name: "seed.json", ok: false, detail: `не найден или не JSON: ${metaPath}` });
    return { ok: false, checks };
  }

  checks.push({
    name: "seedBytes",
    ok: meta.seedBytes === seedBytes.length,
    detail: `seed.json ${meta.seedBytes}, файл ${seedBytes.length}`,
  });
  checks.push({
    name: "seedSha256",
    ok: meta.seedSha256 === actualHash,
    detail: `seed.json ${meta.seedSha256 || "—"}, файл ${actualHash}`,
  });

  if (existsSync(sourcePath)) {
    const sourceBytes = readFileSync(sourcePath);
    const sourceHash = sha256(sourceBytes);
    checks.push({
      name: "shcSha256 (seed соответствует исходнику)",
      ok: meta.shcSha256 === sourceHash,
      detail: `seed.json ${meta.shcSha256 || "—"}, shc.lat ${sourceHash}` +
        (meta.shcSha256 === sourceHash ? "" : " (seed устарел — нужен --refresh-seed)"),
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Пересобирает seed из текущего shc.lat без Rust и обновляет seed.json.
 *
 * Все шаги выполняются в памяти; файлы пишутся только после проверки
 * фиксированной точки. Если stage2' !== stage3' — исключение и никаких записей.
 *
 * @returns {{changed: boolean, oldSeed: Buffer, newSeed: Uint8Array, stage2: Uint8Array,
 *            stage3: Uint8Array, diffOffset: number, diffBytes: number,
 *            oldMeta: object|null, meta: object, wrote: boolean}}
 */
export function refreshSeed({
  seedPath = DEFAULT_SEED,
  metaPath = DEFAULT_META,
  sourcePath = DEFAULT_SOURCE,
  source,
  dryRun = false,
  log = () => {},
} = {}) {
  if (!existsSync(seedPath)) throw new Error(`нет seed-компилятора: ${seedPath}`);
  const oldSeed = readFileSync(seedPath);
  const oldMeta = readMeta(metaPath);
  const sourceBytes = Buffer.from(source !== undefined ? source : readFileSync(sourcePath, "utf8"), "utf8");
  const sourceText = sourceBytes.toString("utf8");

  const { stage2, stage3, fixed } = bootstrapWithoutRust({ seedBytes: oldSeed, source: sourceText });
  if (!fixed) {
    throw new Error(
      "фиксированная точка не достигнута (stage2' !== stage3'); seed не обновлён. " +
      "Проверьте shc.lat: такой компилятор не воспроизводит себя.",
    );
  }

  // Новый seed обязан компилировать shc.lat в себя (он и есть stage2').
  const self = compileStage(stage2, sourceText, "stage-sh-2");
  if (!bytesEqual(self, stage2)) {
    throw new Error("stage-sh-2 не воспроизводит себя побайтово; seed не обновлён");
  }

  const changed = !bytesEqual(oldSeed, stage2);
  const diffOffset = firstDiffIndex(oldSeed, stage2);
  const diffBytes = countDiffBytes(oldSeed, stage2);

  const revision = oldMeta && oldMeta.seedSha256 === sha256(stage2)
    ? (oldMeta.seedRevision || 1)
    : ((oldMeta && oldMeta.seedRevision) || 0) + 1;

  const meta = {
    purpose: META_PURPOSE,
    origin: META_ORIGIN,
    howToUpdate: META_HOW_TO_UPDATE,
    schemaVersion: 2,
    compilerVersion: (oldMeta && oldMeta.compilerVersion) || "0.1.0",
    seedRevision: revision,
    seedBytes: stage2.length,
    seedSha256: sha256(stage2),
    shcBytes: sourceBytes.length,
    shcSha256: sha256(sourceBytes),
    fixedPoint: true,
    updatedAt: new Date().toISOString(),
    verifiedAt: today(),
    note: META_NOTE,
  };

  let wrote = false;
  if (!dryRun) {
    writeFileSync(seedPath, stage2);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    wrote = true;
  }

  log(`stage2' = ${stage2.length} байт, stage3' = ${stage3.length} байт: ` +
    "FIXED POINT (stage2' === stage3')");
  log(`diff seed: ${oldSeed.length} -> ${stage2.length} байт; ` +
    `sha256 ${sha256(oldSeed)} -> ${sha256(stage2)}; ` +
    (changed
      ? `отличий ${diffBytes} байт, первое по смещению ${diffOffset}`
      : "байтовых отличий нет"));
  if (oldMeta && oldMeta.shcSha256 && oldMeta.shcSha256 !== meta.shcSha256) {
    log(`diff shc.lat: sha256 ${oldMeta.shcSha256} -> ${meta.shcSha256}`);
  }
  log(wrote
    ? (changed ? `seed.wasm обновлён (seedRevision ${revision})` : "seed.wasm не изменился")
    : "dry-run: файлы не записаны");

  return {
    changed,
    oldSeed,
    newSeed: stage2,
    stage2,
    stage3,
    diffOffset,
    diffBytes,
    oldMeta,
    meta,
    wrote,
  };
}

/** Печатает результат verifySeed и возвращает код выхода. */
function printVerify(result) {
  for (const check of result.checks) {
    console.log(`  ${check.ok ? "OK  " : "FAIL"} ${check.name}: ${check.detail}`);
  }
  return result.ok ? 0 : 1;
}

function printChain(stages, seedBytes) {
  const names = STAGE_NAMES;
  const sizes = [stages.stage1.length, stages.stage2.length, stages.stage3.length];
  const sources = ["seed", "stage-sh-1", "stage-sh-2"];
  for (let i = 0; i < names.length; i++) {
    console.log(`${names[i]}: ${sizes[i]} байт (${sources[i]} -> shc.lat, без Rust)`);
  }
  if (bytesEqual(stages.stage1, seedBytes)) {
    console.log("seed === stage-sh-1: seed собран из текущего shc.lat (актуален)");
  } else {
    console.log("seed !== stage-sh-1: shc.lat изменился после сборки seed " +
      "(проверьте фиксированную точку; для обновления — --refresh-seed)");
  }
  if (stages.fixed) {
    console.log("FIXED POINT (без Rust): stage-sh-2 === stage-sh-3 (stage2' === stage3')");
  } else {
    const off = firstDiffIndex(stages.stage2, stages.stage3);
    const diff = countDiffBytes(stages.stage2, stages.stage3);
    console.log(`stage-sh-2 !== stage-sh-3: отличий ${diff} байт, первое по смещению ${off}`);
    console.log("фиксированная точка не достигнута");
  }
}

const USAGE = `Rust-free bootstrap компилятора Latent (без cargo/latentc)

  node selfhost/bootstrap-wasm.mjs                 seed -> stage1' -> stage2' -> stage3', FIXED POINT
  node selfhost/bootstrap-wasm.mjs --refresh-seed  пересобрать seed.wasm + seed.json из shc.lat
  node selfhost/bootstrap-wasm.mjs --verify-seed   сверить seed.wasm с seed.json и shc.lat
  node selfhost/bootstrap-wasm.mjs --no-write      не писать stage-sh-*.wasm

Опции:
  --seed <path>     seed-компилятор (по умолчанию selfhost/seed.wasm)
  --meta <path>     метаданные seed (по умолчанию selfhost/seed.json)
  --source <path>   исходник компилятора (по умолчанию selfhost/shc.lat)
  --dry-run         с --refresh-seed: только показать diff, не писать файлы
  --no-verify       не проверять seed.json на старте
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const seedPath = resolve(flagValue("--seed") || process.env.LATENT_SEED || process.env.SEED || DEFAULT_SEED);
  const metaPath = resolve(flagValue("--meta") || DEFAULT_META);
  const sourcePath = resolve(flagValue("--source") || DEFAULT_SOURCE);
  const dryRun = argv.includes("--dry-run");
  const noWrite = argv.includes("--no-write") || dryRun;
  const noVerify = argv.includes("--no-verify");

  try {
    if (argv.includes("--verify-seed")) {
      console.log(`seed: ${display(seedPath)}`);
      process.exit(printVerify(verifySeed({ seedPath, metaPath, sourcePath })));
    }

    if (!existsSync(seedPath)) {
      console.error(`нет seed-компилятора: ${seedPath}`);
      console.error("seed.wasm + seed.json лежат в selfhost/ (коммитятся). " +
        "Собрать заново без Rust нельзя — нужен доверенный seed; " +
        "разовый путь с Rust: node selfhost/bootstrap.mjs --update-seed");
      process.exit(2);
    }

    const seedBytes = readFileSync(seedPath);
    if (!WebAssembly.validate(seedBytes)) {
      console.error(`seed.wasm невалиден: ${seedPath}`);
      process.exit(2);
    }

    if (!noVerify) {
      const meta = readMeta(metaPath);
      if (!meta) {
        console.warn(`предупреждение: ${display(metaPath)} не найден — целостность seed не проверена`);
      } else if (meta.seedSha256 !== sha256(seedBytes) || meta.seedBytes !== seedBytes.length) {
        console.error(`seed.json не совпадает с seed.wasm (${display(seedPath)}): ` +
          `в метаданных ${meta.seedBytes} байт / ${meta.seedSha256}, ` +
          `фактически ${seedBytes.length} байт / ${sha256(seedBytes)}`);
        if (!argv.includes("--refresh-seed")) {
          console.error("восстановите seed из git или пересоберите доверенным компилятором " +
            "(--refresh-seed перезапишет seed и метаданные).");
          process.exit(2);
        }
        console.warn("--refresh-seed: продолжаю, новый seed будет зафиксирован поверх текущего");
      } else if (existsSync(sourcePath)) {
        const srcHash = sha256(readFileSync(sourcePath));
        if (meta.shcSha256 && meta.shcSha256 !== srcHash) {
          console.log(`shc.lat изменился после сборки seed (sha256 ${srcHash}); ` +
            "цепочка проверит новую фиксированную точку");
        }
      }
    }

    if (argv.includes("--refresh-seed")) {
      refreshSeed({ seedPath, metaPath, sourcePath, dryRun, log: console.log });
      process.exit(0);
    }

    const source = readFileSync(sourcePath, "utf8");
    console.log(`seed.wasm: ${seedBytes.length} байт, sha256 ${sha256(seedBytes)} "${display(seedPath)}"`);
    const stages = bootstrapWithoutRust({ seedBytes, source });
    printChain(stages, seedBytes);

    if (!noWrite) {
      const out = [stages.stage1, stages.stage2, stages.stage3];
      for (let i = 0; i < STAGE_NAMES.length; i++) {
        writeFileSync(join(dirname(seedPath), STAGE_NAMES[i]), out[i]);
      }
      console.log(`записаны ${STAGE_NAMES.join(", ")} в ${display(dirname(seedPath))} ` +
        "(gitignore: selfhost/stage*.wasm)");
    }

    if (!stages.fixed) process.exit(1);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}
