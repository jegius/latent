// killer-sandbox.js — untrusted Latent code, compiled by compiler.wasm and run
// in a Web Worker with exactly one import: env.print(ptr).
//
// The page proves the capability boundary twice: WebAssembly.Module.imports()
// reports the real import list, and the worker instantiates the module with an
// import object that contains only env.print. Attacks are real: an infinite
// loop is terminated by the host, out-of-bounds memory traps, and an unknown
// host API is rejected by the compiler (undefined variable).

import {
  $, $$, esc, fmtMs, fmtBytes, fmtInt, sleep, initEmbed, initNav,
  EnhancedEditor, loadCompilerWasm, setStatus,
} from '../assets/killer.js';

initEmbed();
initNav();

const PRESETS = [
  {
    id: 'hello', name: 'hello', kind: 'safe', desc: 'Обычная программа: print и main()',
    code: `fn main() -> int {
    print("hello from the sandbox");
    return 42;
}`,
  },
  {
    id: 'loop', name: 'Бесконечный цикл', kind: 'attack', desc: 'while (true) → host терминирует worker',
    code: `fn main() -> int {
    let i = 0;
    while (true) {
        i = i + 1;
    }
    return i;
}`,
  },
  {
    id: 'oob', name: 'OOB-доступ', kind: 'attack', desc: 'Выход за границу массива → wasm trap',
    code: `fn main() -> int {
    let a = [1, 2, 3];
    let i = 1000000;
    print("before the trap");
    return a[i];
}`,
  },
  {
    id: 'grow', name: 'memory.grow', kind: 'attack', desc: 'Легально растит память на 64 MiB',
    code: `fn main() -> int {
    let size = 67108864;
    let p = alloc(size);
    store8(p, 7);
    print("allocated bytes:", size);
    return load8(p);
}`,
  },
  {
    id: 'balloon', name: 'Раздувание массива', kind: 'attack', desc: '2 000 000 элементов → trap/лимит',
    code: `fn main() -> int {
    let a = [];
    let i = 0;
    while (i < 2000000) {
        a.push(i);
        i = i + 1;
    }
    print("len", a.length);
    return a.length;
}`,
  },
  {
    id: 'dom', name: 'Доступ к DOM', kind: 'attack', desc: 'Компилятор не знает alert → ошибка',
    code: `fn main() -> int {
    alert("pwned");
    return 0;
}`,
  },
  {
    id: 'fetch', name: 'Сеть из wasm', kind: 'attack', desc: 'Нет импорта fetch → ошибка компиляции',
    code: `fn main() -> int {
    let body = fetch("https://example.com/secret");
    return 0;
}`,
  },
];

const CAPABILITIES = [
  {key: 'print', name: 'env.print', yes: true, note: 'единственный импорт'},
  {key: 'memory', name: 'memory (своя)', yes: true, note: 'экспорт модуля'},
  {key: 'main', name: 'main()', yes: true, note: 'экспорт модуля'},
  {key: 'dom', name: 'DOM / document', yes: false, note: 'нет импорта'},
  {key: 'fetch', name: 'fetch / сеть', yes: false, note: 'нет импорта'},
  {key: 'storage', name: 'cookies / localStorage', yes: false, note: 'нет импорта'},
  {key: 'fs', name: 'файловая система', yes: false, note: 'нет импорта'},
  {key: 'threads', name: 'потоки / shared memory', yes: false, note: 'нет импорта'},
];

const state = {
  compiler: null,
  compilerExports: null,
  source: PRESETS[0].code,
  editor: null,
  running: false,
  worker: null,
  timer: 0,
  lastMemory: 0,
  lastPages: 0,
  runId: 0,
};

/* ------------------------------------------------------------------ compile */

function compileWithCompiler(source) {
  const ex = state.compilerExports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const src = encoder.encode(source);
  const ptr = ex.latent_alloc(Math.max(src.length, 1));
  new Uint8Array(ex.memory.buffer).set(src, ptr);
  const res = ex.latent_compile(ptr, src.length);
  const view = new DataView(ex.memory.buffer);
  const status = view.getUint32(res, true);
  const length = view.getUint32(res + 4, true);
  const payload = new Uint8Array(ex.memory.buffer, res + 8, length).slice();
  try { ex.latent_free(ptr, Math.max(src.length, 1)); } catch {}
  try { ex.latent_free(res, 8 + length); } catch {}
  if (status !== 1) throw new Error(decoder.decode(payload));
  return payload;
}

const WORKER_SRC = `
let instance = null;
const decoder = new TextDecoder();

function memoryInfo() {
  try {
    const bytes = instance.exports.memory.buffer.byteLength;
    return { bytes, pages: bytes / 65536 };
  } catch {
    return { bytes: 0, pages: 0 };
  }
}

self.onmessage = (event) => {
  const bytes = new Uint8Array(event.data.bytes);
  const imports = {
    env: {
      print(ptr) {
        try {
          const buffer = instance.exports.memory.buffer;
          const len = new DataView(buffer).getUint32(ptr, true);
          const text = decoder.decode(new Uint8Array(buffer, ptr + 4, len));
          self.postMessage({ type: 'print', text });
        } catch (error) {
          self.postMessage({ type: 'print', text: '[print decode error]' });
        }
      },
    },
  };
  try {
    const module = new WebAssembly.Module(bytes);
    instance = new WebAssembly.Instance(module, imports);
    const memory = memoryInfo();
    self.postMessage({ type: 'ready', memory: memory.bytes, pages: memory.pages });
    if (typeof instance.exports.main !== 'function') {
      throw new Error('module has no main export');
    }
    const t0 = performance.now();
    const result = instance.exports.main();
    const ms = performance.now() - t0;
    const after = memoryInfo();
    self.postMessage({
      type: 'done', result, ms, memory: after.bytes, pages: after.pages,
    });
  } catch (error) {
    const after = memoryInfo();
    self.postMessage({
      type: 'error',
      message: String(error && error.message || error),
      memory: after.bytes,
      pages: after.pages,
    });
  }
};
`;

/* ---------------------------------------------------------------------- log */

function log(kind, text, level = 'info') {
  const host = $('#log');
  const row = document.createElement('div');
  row.className = `k-log-row k-log-row--${level}`;
  const time = new Date().toLocaleTimeString('ru-RU', {hour12: false});
  row.innerHTML = `<span class="k-log-time">${time}</span><span class="k-log-kind">${esc(kind.toUpperCase())}</span><span class="k-log-text">${esc(text)}</span>`;
  host.append(row);
  host.scrollTop = host.scrollHeight;
  while (host.children.length > 160) host.firstChild.remove();
}

/* ------------------------------------------------------------------- render */

function renderCapabilities(imports = [], exports = []) {
  const pending = imports == null || exports == null;
  const importNames = new Set((imports || []).map((imp) => `${imp.module}.${imp.name}`));
  const exportNames = new Set((exports || []).map((exp) => exp.name));
  const host = $('#caps');
  host.innerHTML = CAPABILITIES.map((cap) => {
    let available = cap.yes;
    if (cap.key === 'print') available = importNames.has('env.print');
    if (cap.key === 'memory') available = exportNames.has('memory');
    if (cap.key === 'main') available = exportNames.has('main');
    if (['dom', 'fetch', 'storage', 'fs', 'threads'].includes(cap.key)) available = false;
    if (pending) {
      return `<div class="k-cap k-cap--pending">
        <span class="k-cap-ico">?</span>
        <span class="k-cap-name">${esc(cap.name)}</span>
        <span class="k-cap-note">после компиляции</span>
      </div>`;
    }
    return `<div class="k-cap ${available ? 'k-cap--yes' : 'k-cap--no'}">
      <span class="k-cap-ico">${available ? '✓' : '✕'}</span>
      <span class="k-cap-name">${esc(cap.name)}</span>
      <span class="k-cap-note">${esc(available ? cap.note : 'недоступно')}</span>
    </div>`;
  }).join('');
  if (pending) {
    setText('#m-imports', '—');
    setText('#imports-list', 'скомпилируйте программу');
    const badge = $('#caps-badge');
    if (badge) badge.textContent = 'ожидание';
    return;
  }
  setText('#m-imports', String(imports.length));
  setText('#imports-list', imports.length
    ? imports.map((imp) => `${imp.module}.${imp.name}`).join(', ')
    : 'нет импортов');
  const ok = imports.length === 1 && imports[0].module === 'env' && imports[0].name === 'print';
  const badge = $('#caps-badge');
  if (badge) {
    badge.textContent = ok ? '1 импорт · env.print' : `${imports.length} импортов`;
    badge.className = `k-badge ${ok ? 'k-badge--green' : 'k-badge--amber'}`;
  }
  const diagram = $('#diagram-imports');
  if (diagram) diagram.textContent = ok ? 'env.print → [len][utf8]' : imports.map((i) => `${i.module}.${i.name}`).join(', ') || 'только memory/main';
}

function renderMemory(bytes, pages) {
  state.lastMemory = bytes || 0;
  state.lastPages = pages || 0;
  const limit = 64 * 1024 * 1024;
  const pct = Math.min(100, (state.lastMemory / limit) * 100);
  const gauge = $('#memory-gauge');
  if (gauge) gauge.style.width = `${pct.toFixed(1)}%`;
  setText('#m-memory', fmtBytes(state.lastMemory));
  setText('#m-pages', fmtInt(state.lastPages));
  setText('#memory-label', `${fmtBytes(state.lastMemory)} · ${fmtInt(state.lastPages)} стр. по 64 KiB`);
}

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

/* --------------------------------------------------------------------- run */

function stopWorker(reason = 'terminated') {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = 0;
  }
  state.running = false;
  $('#run-code').disabled = false;
}

async function runCode() {
  if (state.running || !state.compiler) return {status: 'busy'};
  state.runDone = new Promise((resolve) => { state.resolveRun = resolve; });
  const finish = (result) => {
    if (state.resolveRun) {
      state.resolveRun(result);
      state.resolveRun = null;
    }
  };
  const source = state.editor.value;
  state.source = source;
  const runId = ++state.runId;
  state.running = true;
  $('#run-code').disabled = true;
  const timeoutMs = Number($('#timeout').value);
  $('#log').innerHTML = '';
  renderMemory(0, 0);
  log('compile', `compiler.wasm · ${source.split('\n').length} строк исходника`);
  setStatus($('#run-status'), 'компиляция…');

  let wasm;
  const t0 = performance.now();
  try {
    wasm = compileWithCompiler(source);
  } catch (error) {
    const message = String(error.message || error);
    setStatus($('#run-status'), `ошибка компиляции: ${message}`, 'err');
    log('error', message, 'err');
    state.running = false;
    $('#run-code').disabled = false;
    finish({status: 'compile-error', message});
    return state.runDone;
  }
  const compileMs = performance.now() - t0;
  setText('#m-compile', fmtMs(compileMs));
  setText('#m-bytes', fmtBytes(wasm.length));
  log('compile', `OK: ${fmtBytes(wasm.length)} wasm за ${fmtMs(compileMs)}`, 'ok');

  let module;
  try {
    module = new WebAssembly.Module(wasm);
  } catch (error) {
    setStatus($('#run-status'), `невалидный wasm: ${error.message}`, 'err');
    log('error', `WebAssembly.Module: ${error.message}`, 'err');
    state.running = false;
    $('#run-code').disabled = false;
    finish({status: 'invalid-wasm', message: error.message});
    return state.runDone;
  }
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  state.imports = imports;
  state.exports = exports;
  renderCapabilities(imports, exports);
  const onlyPrint = imports.length === 1 && imports[0].module === 'env' && imports[0].name === 'print';
  log('cap', `imports: ${imports.map((i) => `${i.module}.${i.name}`).join(', ') || 'нет'} · exports: ${exports.map((e) => e.name).join(', ')}`,
    onlyPrint ? 'ok' : 'warn');
  const capacity = onlyPrint
    ? 'worker получает только env.print — DOM, сеть и storage недоступны'
    : `ВНИМАНИЕ: ${imports.length} импортов (ожидался один env.print)`;
  setStatus($('#caps-status'), capacity, onlyPrint ? 'ok' : 'warn');

  const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], {type: 'text/javascript'})));
  state.worker = worker;
  state.timer = setTimeout(() => {
    if (runId !== state.runId || !state.running) return;
    stopWorker();
    log('stop', `host terminated worker after ${timeoutMs} ms`, 'err');
    setStatus($('#run-status'),
      `остановлено по таймауту ${timeoutMs} ms — бесконечный цикл не заблокировал страницу`, 'warn');
    setText('#m-run', `>${timeoutMs} ms`);
    renderMemory(state.lastMemory, state.lastPages);
    finish({status: 'terminated', timeoutMs});
  }, timeoutMs);

  worker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (runId !== state.runId) return;
    if (data.type === 'ready') {
      renderMemory(data.memory, data.pages);
      log('run', `instantiated; memory ${fmtBytes(data.memory)} (${data.pages} pages)`, 'ok');
      setStatus($('#run-status'), 'исполнение main()…');
    } else if (data.type === 'print') {
      log('print', data.text, 'info');
    } else if (data.type === 'done') {
      clearTimeout(state.timer);
      state.timer = 0;
      stopWorker();
      renderMemory(data.memory, data.pages);
      setText('#m-run', fmtMs(data.ms));
      log('run', `main() = ${data.result} за ${fmtMs(data.ms)}`, 'ok');
      setStatus($('#run-status'), `main() = ${data.result} · ${fmtMs(data.ms)} · ${fmtBytes(data.memory)}`, 'ok');
      finish({status: 'done', ...data});
    } else if (data.type === 'error') {
      clearTimeout(state.timer);
      state.timer = 0;
      stopWorker();
      renderMemory(data.memory, data.pages);
      setText('#m-run', 'trap');
      log('trap', data.message, 'err');
      setStatus($('#run-status'), `wasm trap: ${data.message} — страница и данные живы`, 'warn');
      finish({status: 'trap', ...data});
    }
  });
  worker.addEventListener('error', (event) => {
    clearTimeout(state.timer);
    stopWorker();
    log('error', `worker error: ${event.message}`, 'err');
    setStatus($('#run-status'), `worker error: ${event.message}`, 'err');
    finish({status: 'worker-error', message: event.message});
  });
  worker.postMessage({bytes: wasm.buffer}, [wasm.buffer]);
  return state.runDone;
}

/* -------------------------------------------------------------------- setup */

function selectPreset(index) {
  const preset = PRESETS[index];
  state.editor.value = preset.code;
  state.source = preset.code;
  $$('[data-preset]').forEach((btn, i) => btn.classList.toggle('is-active', i === index));
  setText('#preset-name', preset.name);
  setText('#preset-desc', preset.desc);
  $('#log').innerHTML = '';
  log('cap', 'готово: выберите «Выполнить»', 'info');
  setStatus($('#run-status'), 'готово');
}

function buildPresets() {
  const host = $('#presets');
  host.innerHTML = PRESETS.map((preset, index) => `
    <button class="k-sample${index === 0 ? ' is-active' : ''}" type="button" data-preset="${index}">
      <span>
        <span class="k-mono">${esc(preset.name)}</span>
        <small style="display:block;color:var(--k-dim);font-family:var(--k-sans)">${esc(preset.desc)}</small>
      </span>
      <span class="k-badge ${preset.kind === 'attack' ? 'k-badge--red' : 'k-badge--green'}">${preset.kind}</span>
    </button>
  `).join('');
  $$('[data-preset]').forEach((btn, index) => {
    btn.addEventListener('click', () => selectPreset(index));
  });
}

async function boot() {
  buildPresets();
  state.editor = new EnhancedEditor($('#editor'), {
    value: PRESETS[0].code,
    tall: true,
    onChange: (value) => { state.source = value; },
  });
  $('#editor').addEventListener('editor-run', () => runCode());
  $('#run-code').addEventListener('click', runCode);
  try {
    const loaded = await loadCompilerWasm('../compiler.wasm');
    const instance = new WebAssembly.Instance(loaded.module, {env: {print() {}}});
    state.compiler = loaded;
    state.compilerExports = instance.exports;
    setStatus($('#loader-status'), `compiler.wasm · ${fmtBytes(loaded.bytes.length)} · загружен`, 'ok');
    log('cap', `compiler.wasm loaded (${fmtBytes(loaded.bytes.length)})`, 'ok');
    renderCapabilities(null, null);
    setStatus($('#caps-status'), 'скомпилируйте программу — capability-список построится по бинарнику', 'ok');
    setStatus($('#run-status'), 'готово к запуску');
    document.documentElement.dataset.killerReady = '1';
  } catch (error) {
    setStatus($('#loader-status'), `не удалось загрузить compiler.wasm: ${error.message}`, 'err');
    setStatus($('#run-status'), 'компилятор недоступен', 'err');
    document.documentElement.dataset.killerReady = '1';
  }
}

window.__killerSandbox = {
  run: runCode,
  preset: (id) => {
    const index = PRESETS.findIndex((p) => p.id === id);
    if (index >= 0) selectPreset(index);
    return index;
  },
  state: () => ({
    loaded: Boolean(state.compiler),
    running: state.running,
    source: state.editor ? state.editor.value : state.source,
    memory: state.lastMemory,
    pages: state.lastPages,
    imports: state.imports || null,
  }),
};

boot();
