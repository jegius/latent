// verify-wasm.mjs — валидация и запуск WASM, скомпилированного Latent-компилятором.
//
// Использование:
//   node scripts/verify-wasm.mjs <file.wasm> [--run] [--expect=<int>]
//
// Без --run: только WebAssembly.validate + instantiate (структурная корректность).
// С --run: вызывает экспортированный main(), печатает вывод print и return-код.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const run = args.includes("--run");
const expectArg = args.find((a) => a.startsWith("--expect="));
const expect = expectArg ? Number(expectArg.split("=")[1]) : undefined;

if (!file) {
  console.error("usage: node scripts/verify-wasm.mjs <file.wasm> [--run] [--expect=N]");
  process.exit(2);
}

const bytes = readFileSync(file);

if (!WebAssembly.validate(bytes)) {
  console.error("INVALID: WebAssembly.validate() returned false");
  process.exit(1);
}
console.log("validate: ok");

let instance;
const output = [];
try {
  const module = new WebAssembly.Module(bytes);
  const imports = {
    env: {
      print: (ptr) => {
        // Строковый литерал Latent: [len u32 LE][utf8].
        if (!instance) return;
        const mem = new DataView(instance.exports.memory.buffer);
        const len = mem.getUint32(ptr, true);
        const view = new Uint8Array(instance.exports.memory.buffer);
        const text = new TextDecoder().decode(view.subarray(ptr + 4, ptr + 4 + len));
        output.push(text);
        if (run) console.log(text);
      },
      print_i32: (n) => { if (run) console.log(n); },
      print_f64: (n) => { if (run) console.log(n); },
    },
  };
  instance = new WebAssembly.Instance(module, imports);
} catch (e) {
  console.error("INSTANTIATE FAILED:", e.message);
  process.exit(1);
}
console.log("instantiate: ok");

if (run) {
  if (typeof instance.exports.main !== "function") {
    console.error("no exported main()");
    process.exit(1);
  }
  let result;
  try {
    result = instance.exports.main();
  } catch (e) {
    console.error("main() TRAPPED:", e.message);
    process.exit(1);
  }
  console.log("main() =", result);
  if (expect !== undefined && result !== expect) {
    console.error(`EXPECTED ${expect}, got ${result}`);
    process.exit(1);
  }
}
process.exit(0);