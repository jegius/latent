// Bootstrap-харнесс самохостящегося компилятора Latent.
//
//   stage1 = latentc (Rust) компилирует selfhost/shc.lat
//   stage2 = stage1 компилирует selfhost/shc.lat   (self-compiled)
//   stage3 = stage2 компилирует selfhost/shc.lat
//
// Фиксированная точка: stage2 === stage3.
//
// ABI компилятора: хост пишет исходник как [len u32 LE][utf8] по адресу
// INPUT_ADDR (вынесен в 128K-область выше рабочих буферов), вызывает main();
// готовый WASM лежит как [len u32 LE][bytes] по адресу 65536.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CLI = process.env.LATENTC || join(root, "target/debug/latentc");
const SRC = join(here, "shc.lat");
const INPUT_ADDR = 3145728;
const OUTPUT_ADDR = 65536;

// Компилирует исходник уже собранным компилятором (wasm) и возвращает байты.
function selfCompile(wasmBytes, source) {
  let inst;
  const mod = new WebAssembly.Module(wasmBytes);
  inst = new WebAssembly.Instance(mod, { env: { print: () => {} } });
  const enc = new TextEncoder().encode(source);
  // Вход лежит выше рабочих областей: наращиваем память до записи.
  const need = Math.ceil((INPUT_ADDR + 4 + enc.length) / 65536);
  const have = inst.exports.memory.buffer.byteLength / 65536;
  if (need > have) { inst.exports.memory.grow(need - have); }
  new DataView(inst.exports.memory.buffer).setUint32(INPUT_ADDR, enc.length, true);
  new Uint8Array(inst.exports.memory.buffer).set(enc, INPUT_ADDR + 4);
  const ret = inst.exports.main();
  const dv = new DataView(inst.exports.memory.buffer);
  const len = dv.getUint32(OUTPUT_ADDR, true);
  const bytes = new Uint8Array(dv.buffer).slice(OUTPUT_ADDR + 4, OUTPUT_ADDR + 4 + len);
  // Отрицательный результат — ошибка компиляции: байты это текст сообщения.
  if (ret < 0) {
    throw new Error(`compile error: ${new TextDecoder().decode(bytes)}`);
  }
  return bytes;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const source = readFileSync(SRC, "utf8");

execFileSync(CLI, ["compile", SRC, join(here, "stage1.wasm")], { stdio: "inherit" });
const stage1 = readFileSync(join(here, "stage1.wasm"));
if (!WebAssembly.validate(stage1)) throw new Error("stage1 невалиден");
console.log(`stage1.wasm: ${stage1.length} байт (собран latentc)`);

const stage2 = selfCompile(stage1, source);
writeFileSync(join(here, "stage2.wasm"), stage2);
console.log(`stage2.wasm: ${stage2.length} байт (self-compiled)`);
if (!WebAssembly.validate(stage2)) {
  throw new Error("stage2 невалиден — компилятор неверно компилирует сам себя");
}

const stage3 = selfCompile(stage2, source);
writeFileSync(join(here, "stage3.wasm"), stage3);
console.log(`stage3.wasm: ${stage3.length} байт`);

console.log(bytesEqual(stage2, stage3)
  ? "FIXED POINT: stage2 === stage3"
  : "stage2 !== stage3 (фиксированная точка не достигнута)");