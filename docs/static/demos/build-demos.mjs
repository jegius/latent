#!/usr/bin/env node
// build-demos.mjs — compile every docs/static/demos/**/*.lat with the real
// Latent compiler (web-ide/compiler.wasm) and write a sibling *.wasm.
//
// Usage:
//   node docs/static/demos/build-demos.mjs            # compile + smoke-run
//   node docs/static/demos/build-demos.mjs --no-verify
//   LATENT_COMPILER_WASM=/abs/path/compiler.wasm node .../build-demos.mjs
//
// The compiler is loaded through its C ABI:
//   latent_alloc(size) -> ptr; latent_compile(ptr, len) -> [status][len][payload]
// A module compiles to status=1 + wasm bytes, or status=0 + UTF-8 diagnostics.
//
// Smoke-run args are chosen so every demo does real work once; the pages pass
// their own arguments at runtime. Nothing here is bundled into the browser.

import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const compilerPath =
  process.env.LATENT_COMPILER_WASM || join(ROOT, 'web-ide', 'compiler.wasm');
const verify = !process.argv.includes('--no-verify');

if (!existsSync(compilerPath)) {
  console.error(`[build-demos] compiler not found: ${compilerPath}`);
  console.error('  build it with scripts/build-wasm.sh or set LATENT_COMPILER_WASM');
  process.exit(1);
}

function walkLatent(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'assets') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkLatent(full));
    else if (entry.endsWith('.lat')) out.push(full);
  }
  return out;
}

async function loadCompiler() {
  const bytes = readFileSync(compilerPath);
  const {instance} = await WebAssembly.instantiate(bytes, {env: {print() {}}});
  const ex = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function compile(source) {
    const src = encoder.encode(source);
    const ptr = ex.latent_alloc(Math.max(src.length, 1));
    new Uint8Array(ex.memory.buffer).set(src, ptr);
    const res = ex.latent_compile(ptr, src.length);
    const view = new DataView(ex.memory.buffer);
    const status = view.getUint32(res, true);
    const len = view.getUint32(res + 4, true);
    const payload = new Uint8Array(ex.memory.buffer, res + 8, len).slice();
    ex.latent_free(ptr, Math.max(src.length, 1));
    ex.latent_free(res, 8 + len);
    if (status !== 1) throw new Error(decoder.decode(payload));
    return payload;
  }
  return {compile};
}

// One call per demo that exercises the hot path. Runs in Node too, which makes
// the same .wasm files usable in tests, benchmarks and CI.
const SMOKE = {
  'bench/hash.wasm': [1 << 20, 1],
  'bench/sieve.wasm': [2_000_000],
  'bench/matmul.wasm': [64],
  'bench/sort.wasm': [10_000],
  'bench/utf8.wasm': [1000],
  'image/filter.wasm': [
    [0, 480, 360, 0, 0],
    [1, 480, 360, 0, 0],
    [2, 480, 360, 4, 0],
    [3, 480, 360, 0, 0],
    [4, 480, 360, 0, 140],
  ],
  'physics/particles.wasm': [
    [0, 5000, 40, 960, 600],
    [1, 5000, 40, 960, 600],
    [1, 5000, 40, 960, 600],
  ],
};

async function smokeRun(wasmBytes, spec) {
  const calls = Array.isArray(spec[0]) ? spec : [spec];
  let printed = 0;
  const {instance} = await WebAssembly.instantiate(wasmBytes, {
    env: {print: () => { printed += 1; }},
  });
  const ex = instance.exports;
  if (!WebAssembly.validate(wasmBytes)) throw new Error('invalid wasm');
  if (typeof ex.main !== 'function') throw new Error('no main export');
  let result;
  for (const args of calls) {
    const t0 = performance.now();
    result = ex.main(...args);
    const ms = performance.now() - t0;
    if (!Number.isFinite(result)) throw new Error(`main() -> ${result}`);
    if (ms > 0.001) result = `${result} (${ms.toFixed(2)} ms)`;
  }
  return {result, printed};
}

const compiled = [];
const failures = [];
const compiler = await loadCompiler();
console.log(`[build-demos] compiler: ${relative(ROOT, compilerPath)}`);

for (const file of walkLatent(HERE)) {
  const rel = relative(HERE, file).replaceAll('\\', '/');
  const out = file.replace(/\.lat$/, '.wasm');
  try {
    const source = readFileSync(file, 'utf8');
    const t0 = performance.now();
    const wasm = compiler.compile(source);
    const compileMs = performance.now() - t0;
    writeFileSync(out, wasm);
    const outRel = rel.replace(/\.lat$/, '.wasm');
    const info = {rel, outRel, bytes: wasm.length, compileMs};
    if (verify) {
      const calls = SMOKE[outRel] || [0];
      const run = await smokeRun(wasm, calls);
      info.result = run.result;
    }
    compiled.push(info);
    console.log(
      `  ✓ ${rel.padEnd(28)} → ${outRel.padEnd(28)} ` +
        `${String(wasm.length).padStart(6)} B  compile ${compileMs.toFixed(1)} ms` +
        (info.result !== undefined ? `  smoke=${info.result}` : ''),
    );
  } catch (err) {
    failures.push({rel, error: String(err.message || err)});
    console.error(`  ✗ ${rel}: ${err.message || err}`);
  }
}

const total = compiled.reduce((n, info) => n + info.bytes, 0);
console.log(
  `[build-demos] ${compiled.length} module(s), ${(total / 1024).toFixed(1)} KiB total`,
);
if (failures.length) {
  console.error(`[build-demos] ${failures.length} failure(s)`);
  process.exit(1);
}
