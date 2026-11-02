// Долгоживущий worker: гоняет компилятор по запросам основного процесса.
//
// Нужен, чтобы (а) не платить за старт потока на каждый кейс корпуса и
// (б) уметь принудительно завершить зависший прогон: основной процесс убивает
// worker по таймауту и создаёт новый. Selfhost исторически зависает на
// структурных аннотациях (`fn f(a: [int])`), и корпус не должен вешать
// весь сбор покрытия.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { runCompiler } from "./compiler.mjs";

const { counterBase, counterWords } = workerData;
let cachedPath = null;
let cachedBytes = null;

parentPort.on("message", (msg) => {
  try {
    if (msg.compilerPath !== cachedPath) {
      cachedBytes = readFileSync(msg.compilerPath);
      cachedPath = msg.compilerPath;
    }
    const r = runCompiler(cachedBytes, msg.source, msg.abi ?? {});
    const buffer = r.memory.buffer;
    const words = Math.min(counterWords, Math.floor((buffer.byteLength - counterBase) / 4));
    const counters = new Uint8Array(counterWords * 4);
    if (words > 0) counters.set(new Uint8Array(buffer, counterBase, words * 4), 0);
    const text = new TextDecoder().decode(r.wasm);
    parentPort.postMessage(
      {
        id: msg.id,
        ret: r.ret,
        trapped: r.trapped,
        error: r.error,
        wasmLen: r.wasm.length,
        wasmHash: createHash("sha256").update(r.wasm).digest("hex"),
        errorText: r.ret < 0 ? text.slice(0, 240) : undefined,
        counters,
      },
      [counters.buffer],
    );
  } catch (e) {
    const counters = new Uint8Array(counterWords * 4);
    parentPort.postMessage(
      {
        id: msg.id,
        ret: -1,
        trapped: true,
        error: String(e && e.stack ? e.stack : e),
        wasmLen: 0,
        wasmHash: "",
        counters,
      },
      [counters.buffer],
    );
  }
});
