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

import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
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

// ---------------------------------------------------------------------------
// Vendor assets for the killer demos (generated, not hand-edited).
//
//  * vendor/compiler/** — engine #1 (ESM JS interpreter) copied verbatim so the
//    concurrency/AI/modules demos execute real Latent code offline with
//    relative imports and no bundler.
//  * selfhost/seed.wasm — trusted self-hosted compiler used by the selfhost
//    demo; selfhost/shc.lat is its 164 KiB source (compiled in the browser).
//  * selfhost/seed.json — provenance (version, sha256) checked at runtime.
// ---------------------------------------------------------------------------

function copyEngine1() {
  const from = join(ROOT, 'web-ide', 'compiler');
  const to = join(HERE, 'vendor', 'compiler');
  if (!existsSync(from)) return null;
  rmSync(to, {recursive: true, force: true});
  mkdirSync(to, {recursive: true});
  let files = 0;
  for (const entry of readdirSync(from)) {
    if (!entry.endsWith('.js')) continue;
    cpSync(join(from, entry), join(to, entry));
    files += 1;
  }
  return {from, to, files};
}

function copySelfhostAssets() {
  const pairs = [
    ['seed.wasm', join(ROOT, 'selfhost', 'seed.wasm')],
    ['seed.json', join(ROOT, 'selfhost', 'seed.json')],
    ['shc.lat', join(ROOT, 'selfhost', 'shc.lat')],
  ];
  const copied = [];
  for (const [name, src] of pairs) {
    if (!existsSync(src)) {
      console.warn(`[build-demos] selfhost asset missing: ${src}`);
      continue;
    }
    const dst = join(HERE, 'selfhost', name);
    mkdirSync(dirname(dst), {recursive: true});
    cpSync(src, dst);
    copied.push({name, bytes: statSync(dst).size});
  }
  return copied;
}

const engine1 = copyEngine1();
if (engine1) {
  console.log(
    `[build-demos] engine #1 vendor: ${engine1.files} module(s) → ` +
    `${relative(ROOT, engine1.to).replaceAll('\\', '/')}`,
  );
} else {
  console.warn('[build-demos] web-ide/compiler not found — vendored engine #1 skipped');
}
const selfhostAssets = copySelfhostAssets();
for (const asset of selfhostAssets) {
  console.log(
    `[build-demos] selfhost asset: ${asset.name} (${(asset.bytes / 1024).toFixed(1)} KiB)`,
  );
}

// Keep demos/compiler.wasm in sync with the compiler build-demos just used:
// sandbox and modules load it directly from the demos root, so a stale copy
// would silently hide the modular C ABI (latent_compile_files).
try {
  cpSync(compilerPath, join(HERE, 'compiler.wasm'));
  console.log(
    `[build-demos] compiler copy: compiler.wasm ← ${relative(ROOT, compilerPath).replaceAll('\\', '/')}`,
  );
} catch (error) {
  console.warn(`[build-demos] could not refresh compiler.wasm: ${error.message}`);
}

// Sources under these paths are compiled in the browser (by seed.wasm), not by
// build-demos: shc.lat is the 164 KiB self-hosted compiler source, and a
// precompiled copy would be both huge and misleading (the demo shows the chain).
const SKIP_COMPILE = new Set(['selfhost/shc.lat']);

function walkLatent(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'assets' || entry === 'vendor') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkLatent(full));
    else if (entry.endsWith('.lat')) {
      const rel = relative(HERE, full).replaceAll('\\', '/');
      if (!SKIP_COMPILE.has(rel)) out.push(full);
    }
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
