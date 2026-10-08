// Общий харнесс для тестов self-hosted компилятора Latent.
//
// ABI компилятора (см. selfhost/README.md и bootstrap.mjs):
//   вход  — исходник как [len u32 LE][utf8] по адресу INPUT_ADDR (32768);
//   выход — байты WASM как [len u32 LE][bytes] по адресу OUTPUT_ADDR (65536);
//   main() компилятора возвращает длину выходного WASM.
//
// Роли компиляторов (лестница Лиспа):
//   oracle  — Rust latentc (эталонная реализация);
//   stage1  — результат сборки shc.lat эталоном (Rust);
//   stage2  — shc.lat, собранный stage1 (self-compiled).
//
// Фиксированная точка: stage2 === stage3 (stage3 = stage2 компилирует shc.lat).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const INPUT_ADDR = 32768;
export const OUTPUT_ADDR = 65536;

// Слоты состояния компилятора ST (shc.lat:22): 0=PC 1=NT 2=NF 3=NL 4=status
// 5=produces 6=NS. Каждый слот — i32, база перечислена в shc.lat.
export const ST = 2260992;
export const KIND = 1245184;
export const TVAL = 1507328;
export const TLEN = 1769472;

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const SELFHOST = join(HERE, "..");
export const SHC_SRC = join(SELFHOST, "shc.lat");
export const CLI = process.env.LATENTC || join(ROOT, "target", "debug", "latentc");

/** Собирает shc.lat эталонным Rust-компилятором в указанный файл. */
export function buildStage1(outPath = join(SELFHOST, "stage1.wasm")) {
  if (!existsSync(CLI)) {
    throw new Error(`latentc не найден: ${CLI}. Соберите: cargo build --bin latentc`);
  }
  execFileSync(CLI, ["compile", SHC_SRC, outPath], { stdio: "pipe" });
  return readFileSync(outPath);
}

/** Запускает компилятор (WASM-байты) на исходнике, возвращает { wasm, ret }. */
export function compileWith(compilerBytes, source) {
  const inst = instantiate(compilerBytes);
  const mem = inst.exports.memory.buffer;
  const enc = new TextEncoder().encode(source);
  new DataView(mem).setUint32(INPUT_ADDR, enc.length, true);
  new Uint8Array(mem).set(enc, INPUT_ADDR + 4);
  const ret = inst.exports.main();
  const dv = new DataView(inst.exports.memory.buffer);
  const len = dv.getUint32(OUTPUT_ADDR, true);
  const wasm = new Uint8Array(dv.buffer).slice(OUTPUT_ADDR + 4, OUTPUT_ADDR + 4 + len);
  return { wasm, ret, memory: dv };
}

function instantiate(bytes) {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { print: () => {} } });
}

/** Валидирует и запускает main() программы, собранной в WASM. */
export function runProgram(wasmBytes, imports = {}) {
  if (!WebAssembly.validate(wasmBytes)) throw new Error("WebAssembly.validate() failed");
  const output = [];
  let inst;
  const env = {
    print: (ptr) => {
      if (!inst) return;
      const dv = new DataView(inst.exports.memory.buffer);
      const len = dv.getUint32(ptr, true);
      const view = new Uint8Array(inst.exports.memory.buffer);
      output.push(new TextDecoder().decode(view.subarray(ptr + 4, ptr + 4 + len)));
    },
    ...imports,
  };
  inst = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), { env });
  const result = inst.exports.main();
  return { result, output };
}

/** Компилирует программу Rust-эталоном и возвращает её { result, output }. */
export function oracleRun(source) {
  const dir = mkdtempSync(join(tmpdir(), "latent-oracle-"));
  const src = join(dir, "p.lat");
  const wasm = join(dir, "p.wasm");
  writeFileSync(src, source, "utf8");
  execFileSync(CLI, ["compile", src, wasm], { stdio: "pipe" });
  return runProgram(readFileSync(wasm));
}

/** Возвращает снимок внутреннего состояния компилятора после прогона. */
export function compileState(compilerBytes, source) {
  const { ret, memory } = compileWith(compilerBytes, source);
  return {
    ret,
    pc: memory.getUint32(ST + 0, true),
    nt: memory.getUint32(ST + 4, true),
    nf: memory.getUint32(ST + 8, true),
    nl: memory.getUint32(ST + 12, true),
    status: memory.getUint32(ST + 16, true),
    produces: memory.getUint32(ST + 20, true),
    ns: memory.getUint32(ST + 24, true),
  };
}

/** Читает массивы токенов (KIND/TVAL/TLEN), заполненные tokenize(). */
export function readTokens(compilerBytes, source) {
  const { memory } = compileWith(compilerBytes, source);
  const nt = memory.getUint32(ST + 4, true);
  const kinds = [];
  const vals = [];
  const lens = [];
  for (let i = 0; i < nt; i++) {
    kinds.push(memory.getUint32(KIND + i * 4, true));
    vals.push(memory.getUint32(TVAL + i * 4, true));
    lens.push(memory.getUint32(TLEN + i * 4, true));
  }
  return { nt, kinds, vals, lens };
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function firstDiffIndex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

export function hex(bytes, from = 0, to = bytes.length) {
  return Array.from(bytes.slice(from, to))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}