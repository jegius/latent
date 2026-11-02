// Bootstrap-харнесс самохостящегося компилятора Latent (Rust-путь).
//
//   stage1 = latentc (Rust) компилирует selfhost/shc.lat
//   stage2 = stage1 компилирует selfhost/shc.lat   (self-compiled)
//   stage3 = stage2 компилирует selfhost/shc.lat
//
// Фиксированная точка: stage2 === stage3.
//
// Rust нужен ТОЛЬКО для сборки stage1 из исходника. Дальше компилятор
// воспроизводит себя сам; для сборки без Rust используйте bootstrap-wasm.mjs
// (seed.wasm -> stage2 -> stage3).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { compileWith, bytesEqual } from "./wasm-compiler.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CLI = process.env.LATENTC || join(root, "target/debug/latentc");
const SRC = join(here, "shc.lat");

/** Обновляет seed.wasm (Rust-free bootstrap) и selfhost/seed.json. */
export function updateSeed(stage2, source) {
  writeFileSync(join(here, "seed.wasm"), stage2);
  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  const meta = {
    purpose: "seed-компилятор для Rust-free bootstrap (selfhost/bootstrap-wasm.mjs)",
    origin: "собран latentc (Rust) из selfhost/shc.lat по цепочке bootstrap.mjs (stage1 -> stage2)",
    howToUpdate: "node selfhost/bootstrap.mjs --update-seed",
    seedBytes: stage2.length,
    seedSha256: sha(stage2),
    shcSha256: sha(Buffer.from(source, "utf8")),
    verifiedAt: new Date().toISOString().slice(0, 10),
    note: "После появления seed.wasm Rust для сборки компилятора не требуется: seed -> stage2 -> stage3.",
  };
  writeFileSync(join(here, "seed.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`seed.wasm обновлён: ${stage2.length} байт (sha256 ${meta.seedSha256.slice(0, 16)}…)`);
}

export function bootstrapWithRust({ cli = CLI, src = SRC, selfhostDir = here } = {}) {
  const source = readFileSync(src, "utf8");
  const stage1Path = join(selfhostDir, "stage1.wasm");
  execFileSync(cli, ["compile", src, stage1Path], { stdio: "inherit" });
  const stage1 = readFileSync(stage1Path);
  if (!WebAssembly.validate(stage1)) throw new Error("stage1 невалиден");
  console.log(`stage1.wasm: ${stage1.length} байт (собран latentc)`);

  const stage2 = compileWith(stage1, source).wasm;
  writeFileSync(join(selfhostDir, "stage2.wasm"), stage2);
  console.log(`stage2.wasm: ${stage2.length} байт (self-compiled)`);
  if (!WebAssembly.validate(stage2)) {
    throw new Error("stage2 невалиден — компилятор неверно компилирует сам себя");
  }

  const stage3 = compileWith(stage2, source).wasm;
  writeFileSync(join(selfhostDir, "stage3.wasm"), stage3);
  console.log(`stage3.wasm: ${stage3.length} байт`);

  const fixed = bytesEqual(stage2, stage3);
  console.log(fixed
    ? "FIXED POINT: stage2 === stage3"
    : "stage2 !== stage3 (фиксированная точка не достигнута)");
  return { stage1, stage2, stage3, fixed };
}

// Точка входа: сравниваем URL-формы путей (Windows-совместимо), чтобы модуль
// можно было импортировать из тестов без побочной сборки.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { stage2, fixed } = bootstrapWithRust();
  if (process.argv.includes("--update-seed")) updateSeed(stage2, readFileSync(SRC, "utf8"));
  if (!fixed) process.exitCode = 1;
}
