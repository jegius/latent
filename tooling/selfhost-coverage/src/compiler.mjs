// Сборка инструментированного компилятора и запуск WASM-компилятора на
// исходнике Latent. Zero deps: только node:child_process/node:fs.
//
// ABI компилятора (см. selfhost/bootstrap.mjs):
//   вход  — [len u32 LE][utf8] по адресу INPUT_ADDR;
//   выход — [len u32 LE][bytes] по адресу OUTPUT_ADDR;
//   main() возвращает длину выходного WASM, отрицательную — при ошибке.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const INPUT_ADDR = 3145728;
export const OUTPUT_ADDR = 65536;
const PAGE = 65536;

/** Ищет latentc: явный путь, env LATENTC, затем target/debug/latentc[.exe]. */
export function findLatentc(explicit, repoRoot) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.LATENTC) candidates.push(process.env.LATENTC);
  candidates.push(join(repoRoot, "target", "debug", "latentc.exe"));
  candidates.push(join(repoRoot, "target", "debug", "latentc"));
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Компилирует файл .lat нативным latentc и возвращает байты WASM. */
export function compileWithLatentc(latentc, srcPath, outPath) {
  execFileSync(latentc, ["compile", srcPath, outPath], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return readFileSync(outPath);
}

function growFor(memory, endAddr) {
  const need = Math.ceil(endAddr / PAGE);
  const have = memory.buffer.byteLength / PAGE;
  if (need > have) memory.grow(need - have);
}

/**
 * Запускает компилятор (WASM-байты) на исходнике.
 * Не бросает на ошибке компиляции: возвращает ret < 0 и wasm = текст ошибки.
 * Если компилятор трапит, возвращает { trapped: true, error, memory } —
 * счётчики к этому моменту уже увеличены и остаются читаемыми.
 *
 * @param {Uint8Array} compilerBytes
 * @param {string} source
 * @param {{inputAddr?:number, outputAddr?:number}} [abi]
 */
export function runCompiler(compilerBytes, source, abi = {}) {
  const inputAddr = abi.inputAddr ?? INPUT_ADDR;
  const outputAddr = abi.outputAddr ?? OUTPUT_ADDR;
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compilerBytes), {
    env: { print: () => {} },
  });
  const enc = new TextEncoder().encode(source);
  growFor(inst.exports.memory, inputAddr + 4 + enc.length);
  let mem = inst.exports.memory.buffer;
  new DataView(mem).setUint32(inputAddr, enc.length, true);
  new Uint8Array(mem).set(enc, inputAddr + 4);

  let ret;
  let trapped = false;
  let error = null;
  try {
    ret = inst.exports.main();
  } catch (e) {
    trapped = true;
    error = String(e && e.message ? e.message : e);
    ret = -2147483648;
  }

  mem = inst.exports.memory.buffer;
  const dv = new DataView(mem);
  let len = dv.getUint32(outputAddr, true);
  if (len > mem.byteLength - outputAddr - 4) len = 0; // защита от мусора после трапа
  const wasm = new Uint8Array(mem).slice(outputAddr + 4, outputAddr + 4 + len);
  return { ret, wasm, memory: dv, trapped, error };
}

/** Свежесть stage1.wasm относительно shc.lat и частей. */
export function stage1Freshness(stage1Path, sources) {
  if (!existsSync(stage1Path)) return { exists: false, stale: true, reason: "stage1.wasm отсутствует" };
  const stage1Time = statSync(stage1Path).mtimeMs;
  let newest = 0;
  let newestName = null;
  for (const p of sources) {
    if (!existsSync(p)) continue;
    const t = statSync(p).mtimeMs;
    if (t > newest) { newest = t; newestName = p; }
  }
  if (newest > stage1Time) {
    return {
      exists: true,
      stale: true,
      reason: `stage1.wasm старше ${newestName}; пересоберите node selfhost/bootstrap.mjs`,
    };
  }
  return { exists: true, stale: false, reason: "stage1.wasm свежее исходников" };
}
