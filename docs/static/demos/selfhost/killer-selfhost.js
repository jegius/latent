// killer-selfhost.js — "the compiler compiles itself", in the browser.
//
// seed.wasm (self-hosted Latent compiler, 41.5 KiB) is fetched, its sha256 is
// checked against selfhost/seed.json, then it compiles selfhost/shc.lat (164 KiB)
// twice more. Every stage runs in a Web Worker with the documented ABI:
//   INPUT_ADDR  = 3145728 : [len u32 LE][utf8 source]
//   OUTPUT_ADDR = 65536   : [len u32 LE][wasm | utf8 error]
// The worker also compiles and runs the sample programs. Hashes use SubtleCrypto.

import {
  $, $$, esc, fmtInt, fmtMs, fmtBytes, prefersReducedMotion, initEmbed, initNav,
  sleep, CodeViewer, setupCanvas, rafLoop, setStatus, shortHash, sha256Hex,
} from '../assets/killer.js';

initEmbed();
initNav();

const INPUT_ADDR = 3145728;
const OUTPUT_ADDR = 65536;
const MAX_OUTPUT = 8 * 1024 * 1024;

const SAMPLES = [
  {
    id: 'hello',
    name: 'hello.lat',
    desc: 'print + возврат из main',
    code: `fn main() -> int {
    print("hello from seed.wasm");
    return 42;
}`,
  },
  {
    id: 'fib',
    name: 'fib.lat',
    desc: 'рекурсия и печать',
    code: `fn fib(n: int) -> int {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

fn main() -> int {
    print("fib(10) =", fib(10));
    return fib(10);
}`,
  },
  {
    id: 'arrays',
    name: 'arrays.lat',
    desc: 'массивы и for-in',
    code: `fn main() -> int {
    let xs = [1, 2, 3, 4, 5];
    let sum = 0;
    for (let x in xs) {
        sum = sum + x;
    }
    print("sum =", sum);
    return sum;
}`,
  },
  {
    id: 'loops',
    name: 'loops.lat',
    desc: 'while и целочисленная арифметика',
    code: `fn main() -> int {
    let sum = 0;
    let i = 0;
    while (i < 100) {
        sum = sum + i;
        i = i + 1;
    }
    print("sum 0..99 =", sum);
    return sum;
}`,
  },
  {
    id: 'strings',
    name: 'strings.lat',
    desc: 'конкатенация и len',
    code: `fn main() -> int {
    let a = "hello";
    let b = "seed";
    print(a + " " + b);
    return len(a + b);
}`,
  },
];

const WORKER_SRC = `
const INPUT_ADDR = 3145728;
const OUTPUT_ADDR = 65536;
const MAX_OUTPUT = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function instantiate(bytes) {
  const module = new WebAssembly.Module(bytes);
  return new WebAssembly.Instance(module, { env: { print() {} } });
}

function compileWith(compilerBytes, source) {
  const instance = instantiate(compilerBytes);
  const memory = instance.exports.memory;
  const encoded = encoder.encode(source);
  const need = Math.ceil((INPUT_ADDR + 4 + encoded.length) / 65536);
  const have = memory.buffer.byteLength / 65536;
  if (need > have) memory.grow(need - have);
  let buffer = memory.buffer;
  new DataView(buffer).setUint32(INPUT_ADDR, encoded.length, true);
  new Uint8Array(buffer).set(encoded, INPUT_ADDR + 4);
  const t0 = performance.now();
  const ret = instance.exports.main();
  const ms = performance.now() - t0;
  buffer = memory.buffer;
  const view = new DataView(buffer);
  const length = view.getUint32(OUTPUT_ADDR, true);
  const safe = Math.min(length, Math.max(0, buffer.byteLength - OUTPUT_ADDR - 4), MAX_OUTPUT);
  const wasm = new Uint8Array(buffer).slice(OUTPUT_ADDR + 4, OUTPUT_ADDR + 4 + safe);
  return { ret, ms, wasm };
}

function runWasm(wasmBytes) {
  const instanceRef = { instance: null };
  const imports = {
    env: {
      print(ptr) {
        const buffer = instanceRef.instance.exports.memory.buffer;
        const view = new DataView(buffer);
        const length = view.getUint32(ptr, true);
        const text = decoder.decode(new Uint8Array(buffer, ptr + 4, length));
        self.postMessage({ type: 'sample-print', text });
      },
    },
  };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), imports);
  instanceRef.instance = instance;
  const t0 = performance.now();
  const result = instance.exports.main();
  const runMs = performance.now() - t0;
  return { result, runMs, memory: instance.exports.memory.buffer.byteLength };
}

async function sha256(bytes) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 1) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return 'fnv:' + (h >>> 0).toString(16).padStart(8, '0');
  }
}

function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

self.onmessage = async (event) => {
  const data = event.data || {};
  try {
    if (data.cmd === 'chain') {
      const seed = new Uint8Array(data.seed);
      let compiler = seed;
      let previous = seed;
      const stages = [];
      for (let stage = 1; stage <= 3; stage += 1) {
        self.postMessage({ type: 'stage-start', stage });
        const result = compileWith(compiler, data.shc);
        if (result.ret < 0) {
          self.postMessage({ type: 'error', stage, message: decoder.decode(result.wasm) });
          return;
        }
        const hash = await sha256(result.wasm);
        const entry = {
          stage,
          ms: result.ms,
          bytes: result.wasm.length,
          hash,
          equalPrevious: equal(previous, result.wasm),
          equalSeed: equal(seed, result.wasm),
        };
        stages.push(entry);
        self.postMessage({ type: 'stage-done', ...entry });
        compiler = result.wasm;
        previous = result.wasm;
        await wait(data.delay || 0);
      }
      const fixed = stages.length >= 3 && stages[2].equalPrevious;
      self.postMessage({
        type: 'chain-done',
        stages,
        fixed,
        allEqual: stages.every((s) => s.equalSeed),
      });
      return;
    }
    if (data.cmd === 'sample') {
      const seed = new Uint8Array(data.seed);
      const compiled = compileWith(seed, data.source);
      if (compiled.ret < 0) {
        self.postMessage({ type: 'sample-error', message: decoder.decode(compiled.wasm) });
        return;
      }
      const hash = await sha256(compiled.wasm);
      let run;
      try {
        run = runWasm(compiled.wasm);
      } catch (error) {
        self.postMessage({ type: 'sample-run-error', message: String(error && error.message || error) });
        return;
      }
      self.postMessage({
        type: 'sample-done',
        bytes: compiled.wasm.length,
        compileMs: compiled.ms,
        runMs: run.runMs,
        result: run.result,
        memory: run.memory,
        hash,
      });
      return;
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.message || error) });
  }
};
`;

const chain = {
  running: false,
  stages: [],
  fixed: false,
  allEqual: false,
  started: 0,
  totalMs: 0,
  worker: null,
  timeout: 0,
};

const samples = {
  running: false,
  current: 0,
  worker: null,
  timeout: 0,
  last: null,
};

const forge = { pulse: 0, stage: 0 };

/* -------------------------------------------------------------------- forge */

function initForge() {
  const canvas = $('#forge');
  if (!canvas) return;
  const ctrl = setupCanvas(canvas);
  const particles = Array.from({length: 46}, (_, i) => ({
    angle: (i / 46) * Math.PI * 2,
    radius: 40 + ((i * 37) % 70),
    speed: 0.15 + ((i * 13) % 40) / 100,
    size: 1 + ((i * 7) % 3) * 0.4,
  }));
  const reduced = prefersReducedMotion();
  rafLoop((dt) => {
    const {ctx, w, h} = ctrl.state;
    if (w < 20 || h < 20) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const pulse = forge.pulse;
    // rings
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 32 + ring * 26 + Math.sin((forge.time || 0) * 0.9 + ring) * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(94, 234, 212, ${0.06 + ring * 0.03 + pulse * 0.1})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // particles
    if (!reduced) {
      for (const p of particles) {
        p.angle += p.speed * dt * 0.6;
        const r = p.radius + Math.sin((forge.time || 0) * 0.6 + p.angle) * 6;
        const x = cx + Math.cos(p.angle) * r;
        const y = cy + Math.sin(p.angle) * r * 0.72;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${94 + p.size * 20}, 234, 212, ${0.18 + pulse * 0.4})`;
        ctx.fill();
      }
    }
    // glyph
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 34px ui-monospace, monospace';
    ctx.shadowColor = 'rgba(94, 234, 212, 0.8)';
    ctx.shadowBlur = 20 + pulse * 24;
    ctx.fillStyle = 'rgba(94, 234, 212, 0.92)';
    ctx.fillText('λ', cx, cy - 2);
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(154, 169, 199, 0.8)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(forge.label || 'seed → stage1′ → stage2′ → stage3′', cx, cy + 40);
    ctx.restore();
    forge.time = (forge.time || 0) + dt;
    forge.pulse = Math.max(0, pulse - dt * 1.2);
  });
}

/* --------------------------------------------------------------------- dom */

function stageNode(stage) {
  return $(`#stage-${stage}`);
}

function setNode(stage, status, data = {}) {
  const node = stageNode(stage);
  if (!node) return;
  node.classList.remove('is-running', 'is-done', 'is-error');
  if (status) node.classList.add(`is-${status}`);
  const meta = $('[data-role="meta"]', node);
  const hash = $('[data-role="hash"]', node);
  if (data.bytes != null && meta) {
    meta.textContent = `${fmtBytes(data.bytes)} · ${fmtMs(data.ms)}` +
      (data.equalSeed ? ' · = seed' : data.equalPrevious ? ' · = prev' : '');
  }
  if (data.hash && hash) {
    hash.textContent = shortHash(data.hash, 10, 6);
    node.title = `sha256 ${data.hash}`;
  }
  if (data.title) node.title = data.title;
}

function resetChainUI() {
  chain.stages = [];
  chain.fixed = false;
  chain.allEqual = false;
  chain.running = false;
  for (let stage = 1; stage <= 3; stage += 1) {
    const node = stageNode(stage);
    if (!node) continue;
    node.classList.remove('is-running', 'is-done', 'is-error');
    const meta = $('[data-role="meta"]', node);
    const hash = $('[data-role="hash"]', node);
    if (meta) meta.textContent = 'ожидание';
    if (hash) hash.textContent = '—';
  }
  $('#fixed-banner')?.classList.add('k-hide');
  $('#chain-progress').style.width = '0%';
  setStatus($('#chain-status'), 'готово к запуску');
}

function updateChainProgress(stage) {
  const bar = $('#chain-progress');
  if (bar) bar.style.width = `${(stage / 3) * 100}%`;
}

function startChain() {
  if (chain.running) return;
  if (!state.seed) {
    setStatus($('#chain-status'), 'seed.wasm ещё не загружен', 'err');
    return;
  }
  resetChainUI();
  chain.running = true;
  chain.started = performance.now();
  $('#run-chain').disabled = true;
  setStatus($('#chain-status'), 'seed.wasm компилирует shc.lat…', 'ok');
  forge.label = 'запуск цепочки…';
  const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], {type: 'text/javascript'})));
  chain.worker = worker;
  const timeout = setTimeout(() => {
    worker.terminate();
    chain.running = false;
    chain.worker = null;
    $('#run-chain').disabled = false;
    setStatus($('#chain-status'), 'таймаут: компилятор не уложился в 30 с', 'err');
    const running = $$('.k-chain-node.is-running');
    running.forEach((node) => node.classList.add('is-error'));
  }, 30000);
  chain.timeout = timeout;

  worker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'stage-start') {
      setNode(data.stage, 'running', {});
      forge.pulse = 1;
      forge.stage = data.stage;
      forge.label = `stage${data.stage}′: seed компилирует shc.lat…`;
      setStatus($('#chain-status'), `стадия ${data.stage}: компиляция shc.lat (164 KiB)…`);
    } else if (data.type === 'stage-done') {
      chain.stages.push(data);
      setNode(data.stage, 'done', data);
      updateChainProgress(data.stage);
      forge.pulse = 1;
      setText('#m-stage-bytes', fmtBytes(data.bytes));
      setText('#m-compile', fmtMs(data.ms));
      setStatus($('#chain-status'),
        `стадия ${data.stage}: ${fmtBytes(data.bytes)} за ${fmtMs(data.ms)}` +
        (data.equalSeed ? ' · побайтово равно seed' : data.equalPrevious ? ' · равно предыдущей' : ''));
    } else if (data.type === 'chain-done') {
      clearTimeout(timeout);
      worker.terminate();
      chain.worker = null;
      chain.running = false;
      chain.totalMs = performance.now() - chain.started;
      chain.compileMs = data.stages.reduce((sum, stage) => sum + stage.ms, 0);
      chain.fixed = data.fixed;
      chain.allEqual = data.allEqual;
      $('#run-chain').disabled = false;
      forge.pulse = 1;
      forge.label = data.allEqual ? 'FIXED POINT: seed = stage1′ = stage2′ = stage3′' : 'FIXED POINT: stage2′ = stage3′';
      $('#fixed-banner').classList.remove('k-hide');
      setText('#fixed-title', data.allEqual
        ? 'FIXED POINT: seed = stage1′ = stage2′ = stage3′'
        : 'FIXED POINT: stage2′ = stage3′');
      setText('#fixed-text', data.allEqual
        ? 'Каждая стадия побайтово равна seed: компилятор воспроизводит себя с первого шага.'
        : 'Вторая и третья стадии побайтово равны — компилятор достиг неподвижной точки.');
      setText('#m-chain-time', fmtMs(chain.compileMs));
      setStatus($('#chain-status'),
        `цепочка завершена: ${fmtMs(chain.compileMs)} компиляции · fixed point ${data.fixed ? 'да' : 'нет'}`, 'ok');
      window.__killerSelfhost.chain = {
        fixed: data.fixed,
        allEqual: data.allEqual,
        stages: data.stages,
        compileMs: chain.compileMs,
        totalMs: chain.totalMs,
      };
      document.documentElement.dataset.killerReady = '1';
      runSample(samples.current, {auto: true});
    } else if (data.type === 'error') {
      clearTimeout(timeout);
      worker.terminate();
      chain.worker = null;
      chain.running = false;
      $('#run-chain').disabled = false;
      if (data.stage) setNode(data.stage, 'error', {});
      setStatus($('#chain-status'), `ошибка: ${data.message}`, 'err');
    }
  });
  worker.addEventListener('error', (event) => {
    clearTimeout(timeout);
    worker.terminate();
    chain.running = false;
    $('#run-chain').disabled = false;
    setStatus($('#chain-status'), `worker error: ${event.message}`, 'err');
  });
  worker.postMessage({
    cmd: 'chain',
    seed: state.seed.slice().buffer,
    shc: state.shc,
    delay: prefersReducedMotion() ? 0 : 550,
  });
}

/* ------------------------------------------------------------------ sample */

function selectSample(index) {
  samples.current = index;
  $$('[data-sample]').forEach((btn, i) => btn.classList.toggle('is-active', i === index));
  const sample = SAMPLES[index];
  codeViewer.setFiles([{name: sample.name, code: sample.code}]);
  setText('#sample-name', sample.name);
  setText('#sample-desc', sample.desc);
  $('#sample-console').innerHTML = '<div class="k-console-line k-console-line--sys"><span class="k-out">нажмите «Скомпилировать и запустить»</span></div>';
  setStatus($('#sample-status'), 'готово');
}

function runSample(index, {auto = false} = {}) {
  if (samples.running || !state.seed) return;
  const sample = SAMPLES[index];
  samples.current = index;
  samples.running = true;
  $('#run-sample').disabled = true;
  setStatus($('#sample-status'), auto ? 'компилируем sample…' : 'seed.wasm компилирует sample…', 'ok');
  const consoleEl = $('#sample-console');
  consoleEl.innerHTML = '';
  const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], {type: 'text/javascript'})));
  samples.worker = worker;
  const timeout = setTimeout(() => {
    worker.terminate();
    samples.worker = null;
    samples.running = false;
    $('#run-sample').disabled = false;
    setStatus($('#sample-status'), 'таймаут 12 с: sample остановлен (seed не завершил компиляцию)', 'err');
  }, 12000);
  samples.timeout = timeout;
  worker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'sample-print') {
      appendConsole(data.text);
    } else if (data.type === 'sample-done') {
      clearTimeout(timeout);
      worker.terminate();
      samples.worker = null;
      samples.running = false;
      $('#run-sample').disabled = false;
      setText('#m-run', fmtMs(data.runMs));
      setText('#m-sample-bytes', fmtBytes(data.bytes));
      setText('#m-sample-compile', fmtMs(data.compileMs));
      setText('#m-sample-memory', fmtBytes(data.memory));
      setStatus($('#sample-status'),
        `${sample.name}: ${fmtBytes(data.bytes)} · compile ${fmtMs(data.compileMs)} · run ${fmtMs(data.runMs)} · main() = ${data.result}`,
        'ok');
      appendConsole(`main() = ${data.result}`, 'ok');
      samples.last = {...data, sample: sample.id};
      window.__killerSelfhost.sample = {...samples.last, output: []};
      document.documentElement.dataset.killerReady = '1';
    } else if (data.type === 'sample-error') {
      clearTimeout(timeout);
      worker.terminate();
      samples.running = false;
      $('#run-sample').disabled = false;
      setStatus($('#sample-status'), `ошибка компиляции: ${data.message}`, 'err');
      appendConsole(data.message, 'err');
    } else if (data.type === 'sample-run-error') {
      clearTimeout(timeout);
      worker.terminate();
      samples.running = false;
      $('#run-sample').disabled = false;
      setStatus($('#sample-status'), `ошибка исполнения: ${data.message}`, 'err');
      appendConsole(data.message, 'err');
    } else if (data.type === 'error') {
      clearTimeout(timeout);
      worker.terminate();
      samples.running = false;
      $('#run-sample').disabled = false;
      setStatus($('#sample-status'), `worker error: ${data.message}`, 'err');
    }
  });
  worker.addEventListener('error', (event) => {
    clearTimeout(timeout);
    worker.terminate();
    samples.running = false;
    $('#run-sample').disabled = false;
    setStatus($('#sample-status'), `worker error: ${event.message}`, 'err');
  });
  worker.postMessage({cmd: 'sample', seed: state.seed.slice().buffer, source: sample.code});
}

function appendConsole(text, kind = 'out') {
  const host = $('#sample-console');
  const row = document.createElement('div');
  row.className = `k-console-line k-console-line--${kind}`;
  row.innerHTML = `<span class="k-out">${esc(text)}</span>`;
  host.append(row);
  host.scrollTop = host.scrollHeight;
}

/* -------------------------------------------------------------------- setup */

const state = {seed: null, shc: '', meta: null};

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

let codeViewer = null;

async function loadAssets() {
  const [seedRes, shcRes, metaRes] = await Promise.all([
    fetch('./seed.wasm', {cache: 'no-cache'}),
    fetch('./shc.lat', {cache: 'no-cache'}),
    fetch('./seed.json', {cache: 'no-cache'}),
  ]);
  if (!seedRes.ok) throw new Error(`seed.wasm: HTTP ${seedRes.status} — запустите node docs/static/demos/build-demos.mjs`);
  state.seed = new Uint8Array(await seedRes.arrayBuffer());
  state.shc = await shcRes.text();
  state.shcBytes = new TextEncoder().encode(state.shc).length;
  state.meta = metaRes.ok ? await metaRes.json() : null;
  const seedHash = await sha256Hex(state.seed);
  const verified = state.meta && state.meta.seedSha256 === seedHash;
  setText('#m-seed-size', fmtBytes(state.seed.length));
  setText('#m-seed-size-2', fmtBytes(state.seed.length));
  setText('#m-seed-sha', shortHash(seedHash, 10, 6));
  setText('#seed-sha-full', seedHash);
  setText('#seed-version', state.meta ? `${state.meta.compilerVersion} · rev ${state.meta.seedRevision}` : '—');
  setText('#m-shc', fmtBytes(state.shcBytes));
  setText('#m-shc-2', fmtBytes(state.shcBytes));
  const badge = $('#provenance-badge');
  if (badge) {
    badge.textContent = verified ? 'seed.json ✓' : 'provenance не совпал';
    badge.className = `k-badge ${verified ? 'k-badge--green' : 'k-badge--red'}`;
  }
  setNode(0, 'done', {bytes: state.seed.length, hash: seedHash});
  setStatus($('#chain-status'), verified
    ? 'seed и shc.lat загружены, sha256 совпал с seed.json'
    : 'seed загружен, но sha256 не совпал с seed.json', verified ? 'ok' : 'warn');
}

async function boot() {
  try {
    await loadAssets();
    startChain();
  } catch (error) {
    setStatus($('#chain-status'), `не удалось загрузить артефакты: ${error.message}`, 'err');
    document.documentElement.dataset.killerReady = '1';
  }
}

function buildSamples() {
  const host = $('#samples');
  host.innerHTML = SAMPLES.map((sample, index) => `
    <button class="k-sample${index === 0 ? ' is-active' : ''}" type="button" data-sample="${sample.id}">
      <span>
        <span class="k-mono">${esc(sample.name)}</span>
        <small style="display:block;color:var(--k-dim);font-family:var(--k-sans)">${esc(sample.desc)}</small>
      </span>
      <span class="k-badge k-badge--muted">${index + 1}</span>
    </button>
  `).join('');
}

function wire() {
  $('#run-chain').addEventListener('click', startChain);
  $('#run-sample').addEventListener('click', () => runSample(samples.current));
  $$('[data-sample]').forEach((btn, index) => {
    btn.addEventListener('click', () => selectSample(index));
  });
}

window.__killerSelfhost = {
  chain: null,
  sample: null,
  runChain: startChain,
  runSample: (id) => {
    const index = SAMPLES.findIndex((s) => s.id === id);
    if (index >= 0) runSample(index);
    return index;
  },
  state: () => ({
    seed: state.seed ? state.seed.length : 0,
    shc: state.shc.length,
    chain: window.__killerSelfhost.chain,
    sample: window.__killerSelfhost.sample,
    fixed: chain.fixed,
    allEqual: chain.allEqual,
  }),
};

initForge();
buildSamples();
wire();
codeViewer = new CodeViewer($('#sample-code'), {
  files: [{name: SAMPLES[0].name, code: SAMPLES[0].code}],
  height: 'tall',
});
new CodeViewer($('#abi-code'), {
  files: [{
    name: 'abi.js',
    lang: 'js',
    code: `// ABI, который реализует эта страница (как в selfhost/wasm-compiler.mjs)
const INPUT_ADDR = 3145728; // [len u32 LE][utf8 source]
const OUTPUT_ADDR = 65536;  // [len u32 LE][wasm | utf8 error]

const memory = instance.exports.memory;      // линейная память компилятора
const src = new TextEncoder().encode(shc);   // 164 KiB исходника
memory.grow(Math.ceil((INPUT_ADDR + 4 + src.length) / 65536) - memory.buffer.byteLength / 65536);
new DataView(memory.buffer).setUint32(INPUT_ADDR, src.length, true);
new Uint8Array(memory.buffer).set(src, INPUT_ADDR + 4);

const ret = instance.exports.main();          // < 0 — ошибка компиляции
const len = new DataView(memory.buffer).getUint32(OUTPUT_ADDR, true);
const wasm = new Uint8Array(memory.buffer, OUTPUT_ADDR + 4, len).slice();

// полученный wasm снова компилирует shc.lat — и так до fixed point`,
  }],
  height: 'tall',
});
// CodeViewer has no setFiles API: emulate it for the sample gallery.
codeViewer.setFiles = function setFiles(files) {
  this.files = files;
  this.current = 0;
  this.render();
};
selectSample(0);
boot();
