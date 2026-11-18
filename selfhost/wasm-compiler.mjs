// Запуск wasm-компилятора Latent через ABI компилятора + CLI без Rust.
//
// ABI (см. selfhost/README.md): хост пишет исходник как [len u32 LE][utf8] по
// адресу INPUT_ADDR, вызывает main(); готовый WASM лежит как [len u32 LE][bytes]
// по адресу OUTPUT_ADDR. Отрицательный результат — ошибка: по OUTPUT_ADDR
// лежит [len u32 LE][utf8-текст ошибки].
//
// Модуль используется:
//   * Rust-путём (bootstrap.mjs: stage1 собран latentc);
//   * Rust-free путём (bootstrap-wasm.mjs: seed.wasm — уже собранный компилятор);
//   * как CLI (compile/check/run/version), которому Rust не нужен вообще:
//
//       node selfhost/wasm-compiler.mjs compile hello.lat [hello.wasm]
//       node selfhost/wasm-compiler.mjs check hello.lat
//       node selfhost/wasm-compiler.mjs run hello.lat
//       node selfhost/wasm-compiler.mjs version [--compiler stage-sh-2.wasm]
//
// По умолчанию компилятор — selfhost/seed.wasm; переопределяется
// --compiler <path> или переменной LATENT_COMPILER.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Адрес входного исходника: [len u32 LE][utf8]. */
export const INPUT_ADDR = 3145728;
/** Адрес выхода: [len u32 LE][wasm | текст ошибки]. */
export const OUTPUT_ADDR = 65536;
/** Компилятор по умолчанию — доверенный seed рядом с модулем. */
export const DEFAULT_COMPILER = join(dirname(fileURLToPath(import.meta.url)), "seed.wasm");

// Защита от порченого заголовка длины: реальный выход компилятора ~1–200 KB.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function instantiate(compilerBytes) {
  const module = new WebAssembly.Module(compilerBytes);
  return new WebAssembly.Instance(module, { env: { print: () => {} } });
}

/**
 * Компилирует source компилятором-байтами.
 * @returns {{wasm: Uint8Array, ret: number, ok: boolean, memory: DataView}}
 */
export function compileWith(compilerBytes, source) {
  const inst = instantiate(compilerBytes);
  const memory = inst.exports.memory;
  const enc = new TextEncoder().encode(source);

  // Входной исходник лежит выше рабочих областей компилятора, поэтому память
  // нужно нарастить до записи: компилятор растит её только внутри main().
  const need = Math.ceil((INPUT_ADDR + 4 + enc.length) / 65536);
  const have = memory.buffer.byteLength / 65536;
  if (need > have) { memory.grow(need - have); }

  let buf = memory.buffer;
  new DataView(buf).setUint32(INPUT_ADDR, enc.length, true);
  new Uint8Array(buf).set(enc, INPUT_ADDR + 4);

  const ret = inst.exports.main();
  buf = memory.buffer; // main() мог вырастить память — берём актуальный buffer
  const dv = new DataView(buf);
  const len = dv.getUint32(OUTPUT_ADDR, true);
  const safeLen = Math.min(len, Math.max(0, buf.byteLength - OUTPUT_ADDR - 4), MAX_OUTPUT_BYTES);
  const wasm = new Uint8Array(buf).slice(OUTPUT_ADDR + 4, OUTPUT_ADDR + 4 + safeLen);
  return { wasm, ret, ok: ret >= 0, memory: dv };
}

/** Побайтовое равенство Uint8Array. */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Индекс первого различающегося байта (-1 — массивы равны). */
export function firstDiffIndex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** Число различающихся байт (с учётом разной длины). */
export function countDiffBytes(a, b) {
  const n = Math.min(a.length, b.length);
  let count = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) count++;
  return count;
}

/** Текст ошибки компиляции из результата compileWith (если ret < 0). */
export function errorText(result) {
  return result.ret < 0 ? new TextDecoder().decode(result.wasm) : "";
}

/** Читает байты компилятора с диска (seed/stage). */
export function loadCompiler(path = DEFAULT_COMPILER) {
  return readFileSync(path);
}

/** sha256 в hex. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Метаданные файла компилятора. */
export function compilerInfo(path = DEFAULT_COMPILER) {
  const bytes = readFileSync(path);
  return { path, bytes, size: bytes.length, sha256: sha256(bytes) };
}

/**
 * Валидирует и запускает main() программы, собранной компилятором.
 * Программа импортирует только env.print(ptr), где ptr — [len u32][utf8].
 *
 * @returns {{result: number, output: string[]}}
 */
export function runWasm(wasmBytes) {
  if (!WebAssembly.validate(wasmBytes)) {
    throw new Error("WebAssembly.validate() failed: компилятор вернул невалидный WASM");
  }
  const output = [];
  let inst;
  const env = {
    print: (ptr) => {
      const dv = new DataView(inst.exports.memory.buffer);
      const len = dv.getUint32(ptr, true);
      const bytes = new Uint8Array(inst.exports.memory.buffer);
      output.push(new TextDecoder().decode(bytes.subarray(ptr + 4, ptr + 4 + len)));
    },
  };
  inst = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), { env });
  if (typeof inst.exports.main !== "function") {
    throw new Error("WASM не экспортирует main()");
  }
  return { result: inst.exports.main(), output };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `latent self-hosted WASM compiler (без Rust)

Использование:
  node selfhost/wasm-compiler.mjs compile <in.lat> [out.wasm] [--compiler <path>]
  node selfhost/wasm-compiler.mjs check   <in.lat>            [--compiler <path>]
  node selfhost/wasm-compiler.mjs run     <in.lat>            [--compiler <path>]
  node selfhost/wasm-compiler.mjs version                     [--compiler <path>]

Команды:
  compile  скомпилировать .lat в .wasm (по умолчанию рядом с исходником)
  check    только проверить компиляцию; при ошибке печатает текст и код 1
  run      скомпилировать и исполнить main(); код выхода = main() & 0xFF
  version  версия/происхождение компилятора, сверка с seed.json, фиксированная точка

Компилятор по умолчанию: selfhost/seed.wasm (доверенный seed).
Переопределение: --compiler <path> или LATENT_COMPILER=<path>.
`;

/** Разбирает argv: позиционные аргументы + --flag [value]. */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** Путь для сообщений: относительно cwd, если это короче. */
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

function defaultOutPath(inputPath) {
  return inputPath.replace(/\.[^./\\]+$/, "") + ".wasm";
}

function resolveCompiler(flags) {
  return resolve(flags.compiler || process.env.LATENT_COMPILER || DEFAULT_COMPILER);
}

function readCompilerOrExplain(path) {
  try {
    return readFileSync(path);
  } catch (e) {
    console.error(`не найден компилятор: ${path}`);
    console.error("seed.wasm лежит в selfhost/; соберите его один раз Rust-путём " +
      "(node selfhost/bootstrap.mjs --update-seed) или укажите --compiler <path>.");
    throw e;
  }
}

function readSourceOrExplain(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    console.error(`не найден исходник: ${path}`);
    throw e;
  }
}

function cmdVersion(compilerPath, flags) {
  let info;
  try {
    info = compilerInfo(compilerPath);
  } catch {
    console.error(`не найден компилятор: ${compilerPath}`);
    return 2;
  }
  const metaPath = resolve(flags.meta || join(dirname(compilerPath), "seed.json"));
  const meta = readMeta(metaPath);
  const dir = dirname(compilerPath);
  const rel = display(compilerPath);

  console.log("latent self-hosted WASM compiler");
  console.log(`  compiler    : ${rel} (${info.size} байт)`);
  console.log(`  sha256      : ${info.sha256}`);

  if (meta && typeof meta.compilerVersion === "string") {
    const rev = meta.seedRevision ? `, seed revision ${meta.seedRevision}` : "";
    console.log(`  version     : ${meta.compilerVersion}${rev}`);
  } else if (meta) {
    console.log("  version     : не указана в seed.json старого формата " +
      "(обновите: node selfhost/bootstrap-wasm.mjs --refresh-seed)");
  } else {
    console.log("  version     : неизвестна (seed.json не найден)");
  }

  if (meta) {
    const sameSize = meta.seedBytes === info.size;
    const sameHash = meta.seedSha256 === info.sha256;
    console.log(`  seed.json   : ${sameSize && sameHash
      ? `совпадает (${display(metaPath)})`
      : `НЕ совпадает (${display(metaPath)}): ожидалось ${meta.seedBytes} байт / ${meta.seedSha256}`}`);
  } else {
    console.log(`  seed.json   : не найден (${display(metaPath)}) — происхождение не проверено`);
  }

  const sourcePath = join(dir, "shc.lat");
  try {
    const source = readFileSync(sourcePath);
    const sourceHash = sha256(source);
    if (meta && typeof meta.shcSha256 === "string") {
      console.log(`  source      : ${display(sourcePath)} sha256 ${sourceHash} ` +
        `(${sourceHash === meta.shcSha256 ? "совпадает с seed.json" : "изменился после сборки seed — нужен --refresh-seed"})`);
    } else {
      console.log(`  source      : ${display(sourcePath)} sha256 ${sourceHash}`);
    }
  } catch {
    console.log(`  source      : ${display(sourcePath)} не найден`);
  }

  const stage2 = join(dir, "stage-sh-2.wasm");
  const stage3 = join(dir, "stage-sh-3.wasm");
  try {
    const s2 = readFileSync(stage2);
    const s3 = readFileSync(stage3);
    console.log(`  fixed point : ${bytesEqual(s2, s3)
      ? `stage-sh-2 === stage-sh-3 (${s2.length} байт, sha256 ${sha256(s2)})`
      : "stage-sh-2 !== stage-sh-3"}`);
  } catch {
    console.log("  fixed point : stage-sh-2.wasm / stage-sh-3.wasm не найдены " +
      "(запустите node selfhost/bootstrap-wasm.mjs)");
  }
  return 0;
}

function cmdCompile(input, outPathArg, flags) {
  const compilerPath = resolveCompiler(flags);
  let compiler, source;
  try {
    compiler = readCompilerOrExplain(compilerPath);
    source = readSourceOrExplain(input);
  } catch {
    return 2;
  }
  const result = compileWith(compiler, source);
  if (result.ret < 0) {
    console.error(errorText(result) || "error: compilation failed");
    return 1;
  }
  if (!WebAssembly.validate(result.wasm)) {
    console.error("error: компилятор вернул невалидный WASM");
    return 1;
  }
  const outPath = resolve(outPathArg || defaultOutPath(input));
  writeFileSync(outPath, result.wasm);
  console.log(`${display(outPath)}: ${result.wasm.length} байт WASM`);
  return 0;
}

function cmdCheck(input, flags) {
  const compilerPath = resolveCompiler(flags);
  let compiler, source;
  try {
    compiler = readCompilerOrExplain(compilerPath);
    source = readSourceOrExplain(input);
  } catch {
    return 2;
  }
  const result = compileWith(compiler, source);
  if (result.ret < 0) {
    console.error(errorText(result) || "error: compilation failed");
    return 1;
  }
  if (!WebAssembly.validate(result.wasm)) {
    console.error("error: компилятор вернул невалидный WASM");
    return 1;
  }
  console.log(`OK: ${input} компилируется (${result.wasm.length} байт WASM)`);
  return 0;
}

function cmdRun(input, flags) {
  const compilerPath = resolveCompiler(flags);
  let compiler, source;
  try {
    compiler = readCompilerOrExplain(compilerPath);
    source = readSourceOrExplain(input);
  } catch {
    return 2;
  }
  const result = compileWith(compiler, source);
  if (result.ret < 0) {
    console.error(errorText(result) || "error: compilation failed");
    return 1;
  }
  const run = runWasm(result.wasm);
  for (const line of run.output) console.log(line);
  console.log(`main() = ${run.result}`);
  // Код выхода — младший байт результата (как у обычной main).
  process.exitCode = ((run.result % 256) + 256) % 256;
  return 0;
}

/** Точка входа CLI. Возвращает код выхода. */
export function runCli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] || (flags.help ? "help" : "");
  if (!command || command === "help" || flags.help) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  switch (command) {
    case "version":
      return cmdVersion(resolveCompiler(flags), flags);
    case "compile": {
      if (!positional[1]) { console.error("compile: нужен <in.lat>"); console.error(USAGE); return 2; }
      return cmdCompile(positional[1], positional[2], flags);
    }
    case "check": {
      if (!positional[1]) { console.error("check: нужен <in.lat>"); console.error(USAGE); return 2; }
      return cmdCheck(positional[1], flags);
    }
    case "run": {
      if (!positional[1]) { console.error("run: нужен <in.lat>"); console.error(USAGE); return 2; }
      return cmdRun(positional[1], flags);
    }
    default:
      console.error(`неизвестная команда: ${command}`);
      console.error(USAGE);
      return 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const code = runCli();
  if (code !== 0) process.exitCode = code;
}
