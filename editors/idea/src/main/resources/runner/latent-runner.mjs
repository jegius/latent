#!/usr/bin/env node
// Runner Latent: запускает скомпилированный WASM-модуль или компилирует .lat через
// web-ide/compiler.wasm (C-ABI: latent_alloc / latent_compile / memory).
//
// Использование:
//   node latent-runner.mjs run <program.wasm>
//   node latent-runner.mjs compile <compiler.wasm> <source.lat> <out.wasm>
//
// Формат строки Latent в линейной памяти: [len u32 LE][utf8 bytes].

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const USAGE = `latent-runner.mjs — запуск и компиляция программ Latent

  node latent-runner.mjs run <program.wasm>
  node latent-runner.mjs compile <compiler.wasm> <source.lat> <out.wasm>
`;

const decoder = new TextDecoder('utf-8', { fatal: false });

/** Печатает строку Latent по указателю (ptr -> [len u32][utf8]). */
function printLatentString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
  process.stdout.write(decoder.decode(bytes) + '\n');
}

async function runWasm(wasmPath) {
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`wasm-файл не найден: ${wasmPath}`);
  }
  let memory = null;
  const imports = {
    env: {
      print(ptr) {
        if (memory) {
          printLatentString(memory, ptr);
        }
      },
    },
  };
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  memory = instance.exports.memory;
  if (!memory) {
    throw new Error('WASM-модуль не экспортирует memory');
  }
  const main = instance.exports.main;
  if (typeof main !== 'function') {
    return 0;
  }
  const result = main();
  if (typeof result === 'number' && Number.isFinite(result)) {
    return result | 0;
  }
  return 0;
}

async function compileWithWasm(compilerPath, sourcePath, outPath) {
  if (!fs.existsSync(compilerPath)) {
    throw new Error(`compiler.wasm не найден: ${compilerPath}`);
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`исходник не найден: ${sourcePath}`);
  }
  const bytes = fs.readFileSync(compilerPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports;
  if (typeof exports.latent_alloc !== 'function' || typeof exports.latent_compile !== 'function') {
    throw new Error('compiler.wasm не экспортирует latent_alloc/latent_compile');
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceBytes = Buffer.from(source, 'utf8');
  const srcPtr = exports.latent_alloc(sourceBytes.length);
  if (!srcPtr) {
    throw new Error('latent_alloc вернул 0');
  }
  new Uint8Array(exports.memory.buffer).set(sourceBytes, srcPtr);
  const resultPtr = exports.latent_compile(srcPtr, sourceBytes.length);
  if (!resultPtr) {
    throw new Error('latent_compile вернул 0');
  }
  // Память могла вырасти: перечитываем buffer.
  const view = new DataView(exports.memory.buffer);
  const status = view.getUint32(resultPtr, true);
  const length = view.getUint32(resultPtr + 4, true);
  const payload = Buffer.from(new Uint8Array(exports.memory.buffer, resultPtr + 8, length));
  if (status === 1) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, payload);
    process.stdout.write(`${sourcePath} -> ${outPath} (${payload.length} bytes)\n`);
    return 0;
  }
  process.stderr.write(payload.toString('utf8').replace(/\s*$/, '') + '\n');
  return 1;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === 'run') {
      if (rest.length < 1) {
        process.stderr.write(USAGE);
        return 2;
      }
      return await runWasm(rest[0]);
    }
    if (mode === 'compile') {
      if (rest.length < 3) {
        process.stderr.write(USAGE);
        return 2;
      }
      return await compileWithWasm(rest[0], rest[1], rest[2]);
    }
    process.stderr.write(USAGE);
    return 2;
  } catch (error) {
    process.stderr.write(`latent-runner: ${error && error.message ? error.message : error}\n`);
    return 1;
  }
}

process.exitCode = await main();
