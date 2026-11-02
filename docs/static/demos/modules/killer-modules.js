// killer-modules.js — a multi-file Latent project in the browser.
//
// Engine #1 just gained native modules (resolver + two-phase linker): the demo
// uses the real `resolveModuleGraph` / `linkModuleProject` / `runLatentProject`
// from web-ide/compiler and shows the actual graph, mangled names and output.
// If compiler.wasm exports the C-ABI `latent_compile_files`, the page also
// offers an engine #2 (WASM) run; otherwise it says so honestly.

import {
  $, $$, esc, clamp, fmtInt, fmtMs, fmtBytes, initEmbed, initNav,
  EnhancedEditor, CodeViewer, loadCompilerWasm, setStatus, sleep,
} from '../assets/killer.js';
import {
  resolveModuleGraph, linkModuleProject, runLatentProject, normalizeModulePath,
} from '../vendor/compiler/index.js';

initEmbed();
initNav();

const PROJECTS = {
  stats: {
    name: 'stats pipeline',
    entry: 'main.lat',
    desc: 'math → stats → model → main: четыре файла, именованные импорты и линковка.',
    files: [
      {
        name: 'math.lat',
        code: `// Math primitives. Only exported names are importable.
export fn square(x: int) -> int {
    return x * x;
}

export fn mean(xs: [int]) -> int {
    let sum = 0;
    for (let x in xs) {
        sum = sum + x;
    }
    return sum / xs.length;
}
`,
      },
      {
        name: 'stats.lat',
        code: `import { square, mean } from "./math.lat";

export fn variance(xs: [int]) -> int {
    let m = mean(xs);
    let acc = 0;
    for (let x in xs) {
        acc = acc + square(x - m);
    }
    return acc / xs.length;
}

export fn std(xs: [int]) -> int {
    return variance(xs) * variance(xs);
}
`,
      },
      {
        name: 'model.lat',
        code: `import { mean } from "./math.lat";
import { variance } from "./stats.lat";

export fn score(xs: [int]) -> int {
    return mean(xs) * 100 + variance(xs);
}
`,
      },
      {
        name: 'main.lat',
        code: `import { mean, square } from "./math.lat";
import { variance } from "./stats.lat";
import { score } from "./model.lat";

fn main() -> int {
    let data = [2, 4, 6, 8];
    print("mean =", mean(data));
    print("variance =", variance(data));
    print("score =", score(data));
    print("square(9) =", square(9));
    return score(data);
}
`,
      },
    ],
  },
  cycle: {
    name: 'cycles allowed',
    entry: 'main.lat',
    desc: 'Двухфазная линковка разрешает цикл a.lat ↔ b.lat.',
    files: [
      {
        name: 'a.lat',
        code: `import { b } from "./b.lat";

export fn a(n: int) -> int {
    if (n <= 0) {
        return 1;
    }
    return b(n - 1);
}
`,
      },
      {
        name: 'b.lat',
        code: `import { a } from "./a.lat";

export fn b(n: int) -> int {
    if (n <= 0) {
        return 2;
    }
    return a(n - 1);
}
`,
      },
      {
        name: 'main.lat',
        code: `import { a } from "./a.lat";

fn main() -> int {
    print("a(4) =", a(4));
    return a(4);
}
`,
      },
    ],
  },
  broken: {
    name: 'missing import',
    entry: 'main.lat',
    desc: 'Ошибка линковки с путём и строкой — тоже часть демо.',
    files: [
      {
        name: 'math.lat',
        code: `export fn double(x: int) -> int {
    return x * 2;
}
`,
      },
      {
        name: 'main.lat',
        code: `import { triple } from "./utils.lat";

fn main() -> int {
    print(triple(14));
    return 0;
}
`,
      },
    ],
  },
};

const state = {
  projectId: 'stats',
  files: [],
  active: 'main.lat',
  editor: null,
  graph: null,
  linking: false,
  wasmAbi: false,
  compilerBytes: 0,
  lastLink: null,
  lastRun: null,
  saved: new Map(),
  suppressChange: false,
  graphTimer: 0,
};

function project() { return PROJECTS[state.projectId]; }

function filesArray() {
  return state.files.map((file) => ({name: file.name, code: file.code}));
}

function fileByName(name) {
  return state.files.find((file) => file.name === name);
}

/* ------------------------------------------------------------------- graph */

function computeLayout(graph) {
  const entry = graph.entry;
  const nodes = graph.modules.map((m) => m.path);
  const depth = new Map([[entry, 0]]);
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift();
    const edges = graph.graph.get(path) || [];
    for (const edge of edges) {
      if (!depth.has(edge.resolved)) {
        depth.set(edge.resolved, (depth.get(path) || 0) + 1);
        queue.push(edge.resolved);
      }
    }
  }
  // unreachable modules still get a column
  for (const path of nodes) if (!depth.has(path)) depth.set(path, 0);
  const byDepth = new Map();
  for (const path of nodes) {
    const d = depth.get(path);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(path);
  }
  const positions = new Map();
  const width = 420;
  const maxDepth = Math.max(0, ...[...byDepth.keys()]);
  for (const [d, list] of byDepth) {
    list.sort();
    const x = 34 + (maxDepth === 0 ? 0.5 : d / maxDepth) * (width - 110);
    list.forEach((path, i) => {
      const y = 44 + ((i + 1) / (list.length + 1)) * 212;
      positions.set(path, {x, y});
    });
  }
  return positions;
}

function renderGraph() {
  const host = $('#graph');
  if (!host) return;
  if (!state.graph) {
    host.innerHTML = '<text x="20" y="30" fill="#6c7c9c" font-family="ui-monospace" font-size="11">ошибка графа</text>';
    return;
  }
  const graph = state.graph;
  const positions = computeLayout(graph);
  const edges = [];
  for (const [from, list] of graph.graph) {
    for (const edge of list) {
      edges.push({from, to: edge.resolved, cycle: graph.cycles.some((cycle) => cycle.includes(from) && cycle.includes(edge.resolved))});
    }
  }
  const nodeHtml = graph.modules.map((module) => {
    const pos = positions.get(module.path) || {x: 20, y: 20};
    const isEntry = module.path === graph.entry;
    const isActive = module.path === state.active;
    const exports = module.exports.size;
    return `<g class="k-graph-node${isEntry ? ' is-entry' : ''}" data-node="${esc(module.path)}"
        transform="translate(${pos.x},${pos.y})" style="cursor:pointer">
      <rect x="-45" y="-20" width="90" height="40" rx="9"
        fill="${isActive ? 'rgba(94,234,212,0.14)' : 'rgba(148,178,255,0.06)'}"
        stroke="${isEntry ? '#5eead4' : isActive ? '#60a5fa' : 'rgba(148,178,255,0.25)'}" stroke-width="1.2"/>
      <text x="0" y="-2" text-anchor="middle" fill="${isEntry ? '#5eead4' : '#dbe6ff'}" font-size="10.5">${esc(module.path)}</text>
      <text x="0" y="12" text-anchor="middle" fill="#6c7c9c" font-size="8.5">${exports} export(s)${isEntry ? ' · entry' : ''}</text>
    </g>`;
  }).join('');
  const edgeHtml = edges.map((edge) => {
    const a = positions.get(edge.from) || {x: 0, y: 0};
    const b = positions.get(edge.to) || {x: 0, y: 0};
    const x1 = a.x + 45;
    const y1 = a.y;
    const x2 = b.x - 45;
    const y2 = b.y;
    const mx = (x1 + x2) / 2;
    const path = edge.cycle
      ? `M ${x1} ${y1} C ${mx} ${y1 - 60}, ${mx} ${y2 + 60}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    return `<path class="k-graph-edge${edge.cycle ? ' is-cycle' : ''}" d="${path}" marker-end="url(#arrow)"/>`;
  }).join('');
  host.innerHTML = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(94,234,212,0.7)"/>
      </marker>
    </defs>
    ${edgeHtml}${nodeHtml}`;
  $$('[data-node]', host).forEach((node) => {
    node.addEventListener('click', () => selectFile(node.dataset.node));
  });
}

function rebuildGraph() {
  try {
    state.graph = resolveModuleGraph(filesArray(), project().entry);
    setStatus($('#graph-status'),
      `${state.graph.modules.length} модул(я) · ${[...state.graph.graph.values()].reduce((n, e) => n + e.length, 0)} импортов` +
      (state.graph.cycles.length ? ` · циклов: ${state.graph.cycles.length}` : ''),
      state.graph.cycles.length ? 'warn' : 'ok');
    $('#run-project').disabled = false;
    $('#graph-error').classList.add('k-hide');
    renderGraph();
    setText('#m-modules', fmtInt(state.graph.modules.length));
    setText('#m-modules-2', fmtInt(state.graph.modules.length));
    setText('#m-edges', fmtInt([...state.graph.graph.values()].reduce((n, e) => n + e.length, 0)));
    setText('#m-cycles', fmtInt(state.graph.cycles.length));
    return true;
  } catch (error) {
    state.graph = null;
    renderGraph();
    setStatus($('#graph-status'), error.message, 'err');
    $('#run-project').disabled = true;
    $('#graph-error').classList.remove('k-hide');
    setText('#graph-error', error.message);
    return false;
  }
}

/* -------------------------------------------------------------------- editor */

function selectFile(name) {
  if (!fileByName(name)) return;
  if (state.active !== name) saveActive();
  state.active = name;
  state.suppressChange = true;
  state.editor.value = fileByName(name).code;
  state.suppressChange = false;
  renderTree();
  renderGraph();
  setText('#active-file', name);
  setText('#active-file-2', name);
}

function saveActive() {
  const file = fileByName(state.active);
  if (!file || !state.editor) return;
  file.code = state.editor.value;
}

function renderTree() {
  const host = $('#tree');
  host.innerHTML = state.files.map((file) => {
    const active = file.name === state.active;
    const isEntry = file.name === project().entry;
    const lines = file.code.split('\n').length;
    return `<button class="k-file${active ? ' is-active' : ''}" type="button" data-file="${esc(file.name)}">
      <span class="k-file-icon">▤</span>
      <span>${esc(file.name)}</span>
      ${isEntry ? '<span class="k-file-badge">entry</span>' : ''}
      <span class="k-file-badge">${lines}</span>
    </button>`;
  }).join('');
  $$('[data-file]', host).forEach((btn) => {
    btn.addEventListener('click', () => selectFile(btn.dataset.file));
  });
  setText('#tree-count', `${state.files.length} файлов`);
}

function scheduleGraph() {
  saveActive();
  clearTimeout(state.graphTimer);
  state.graphTimer = setTimeout(() => {
    rebuildGraph();
    renderTree();
  }, 180);
}

/* --------------------------------------------------------------------- run */

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

function appendConsole(text, kind = 'out') {
  const host = $('#project-console');
  const row = document.createElement('div');
  row.className = `k-console-line k-console-line--${kind}`;
  row.innerHTML = `<span class="k-out">${esc(text)}</span>`;
  host.append(row);
  host.scrollTop = host.scrollHeight;
}

function renderLinkedNames(linked) {
  const host = $('#linked-names');
  if (!host) return;
  const functions = Object.keys(linked.program.functions || {});
  const rows = functions.map((name) => {
    const [moduleIndex, sourceName] = name.split('$');
    const index = Number(moduleIndex.replace('m', ''));
    const path = linked.modules[index]?.path || `m${index}`;
    return `<tr><td class="k-mono">${esc(name)}</td><td class="k-mono">${esc(path)}</td><td class="k-mono">${esc(sourceName || '')}</td></tr>`;
  });
  host.innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="3" class="k-dim">линкер не вернул функций</td></tr>';
  setText('#m-functions', fmtInt(functions.length));
}

async function runProject() {
  if (state.linking) return;
  saveActive();
  state.linking = true;
  $('#run-project').disabled = true;
  $('#project-console').innerHTML = '';
  appendConsole(
    state.wasmAbi
      ? 'resolve + link (engine #1) → compile + run (engine #2 WASM)'
      : 'resolve + link + execute (engine #1, JS interpreter)',
    'sys',
  );
  setStatus($('#run-status'), 'линковка модулей…');

  let linked;
  let linkMs = 0;
  try {
    const t0 = performance.now();
    linked = linkModuleProject(filesArray(), project().entry);
    linkMs = performance.now() - t0;
    state.lastLink = linked;
    renderLinkedNames(linked);
    setText('#m-link', fmtMs(linkMs));
    appendConsole(`linked ${linked.modules.length} module(s) in ${fmtMs(linkMs)}`, 'ok');
    for (const cycle of linked.cycles) appendConsole(`cycle: ${cycle.join(' → ')}`, 'warn');
  } catch (error) {
    setStatus($('#run-status'), `ошибка линковки: ${error.message}`, 'err');
    appendConsole(error.message, 'err');
    state.linking = false;
    $('#run-project').disabled = false;
    return;
  }

  if (state.wasmAbi) {
    try {
      const wasm = await compileProjectWasm();
      if (wasm) {
        const run = runWasmProject(wasm);
        setText('#m-exec', fmtMs(run.ms));
        setText('#m-bytes-out', fmtBytes(run.bytes));
        appendConsole(`engine #2: ${fmtBytes(run.bytes)} wasm · main() = ${run.result} · ${fmtMs(run.ms)}`, 'ok');
        for (const line of run.output) appendConsole(line);
        setStatus($('#run-status'), `WASM ABI: ${linked.modules.length} модуля · ${fmtMs(run.ms)} · main() = ${run.result}`, 'ok');
        state.lastRun = {result: run.result, output: run.output, modules: linked.modules.length, cycles: linked.cycles};
        window.__killerModules.last = {
          ...state.lastRun, linkMs, execMs: run.ms,
          linkedNames: Object.keys(linked.program.functions || {}), mode: 'wasm',
        };
        state.linking = false;
        $('#run-project').disabled = false;
        return;
      }
    } catch (error) {
      appendConsole(`WASM ABI error: ${error.message} — fallback to engine #1`, 'warn');
    }
  }

  try {
    const t0 = performance.now();
    const result = await runLatentProject(filesArray(), project().entry);
    const execMs = performance.now() - t0;
    setText('#m-exec', fmtMs(execMs));
    appendConsole(`main() = ${result.result} · ${fmtMs(execMs)} · ${result.output.length} строк вывода`, 'ok');
    for (const line of result.output) appendConsole(line);
    setStatus($('#run-status'),
      `OK: ${result.modules} модуля · link ${fmtMs(linkMs)} · exec ${fmtMs(execMs)} · main() = ${result.result}`, 'ok');
    state.lastRun = {result: result.result, output: result.output, modules: result.modules, cycles: result.cycles};
    window.__killerModules.last = {
      ...state.lastRun,
      linkMs,
      execMs,
      linkedNames: Object.keys(linked.program.functions || {}),
      mode: state.wasmAbi ? 'wasm' : 'engine1',
    };
    document.documentElement.dataset.killerReady = '1';
  } catch (error) {
    setStatus($('#run-status'), `ошибка исполнения: ${error.message}`, 'err');
    appendConsole(error.message, 'err');
  } finally {
    state.linking = false;
    $('#run-project').disabled = false;
  }
}

/* ------------------------------------------------------------------ projects */

function loadProject(id) {
  const preset = PROJECTS[id];
  if (!preset) return;
  state.projectId = id;
  state.files = preset.files.map((file) => ({name: file.name, code: file.code}));
  state.active = preset.entry;
  state.saved = new Map();
  state.suppressChange = true;
  state.editor.value = fileByName(state.active).code;
  state.suppressChange = false;
  renderTree();
  selectFile(preset.entry);
  setStatus($('#run-status'), preset.desc);
  setText('#project-name', preset.name);
  setText('#project-desc', preset.desc);
  setText('#entry-name', preset.entry);
  $('#project-console').innerHTML = '';
  appendConsole(`${preset.name} · entry ${preset.entry}`, 'sys');
  $('#linked-names').innerHTML = '<tr><td colspan="3" class="k-dim">запустите проект, чтобы увидеть имена после линковки</td></tr>';
  setText('#m-functions', '—');
  setText('#m-exec', '—');
  setText('#m-link', '—');
  rebuildGraph();
  if (!state.graph) {
    setStatus($('#run-status'), $('#graph-error').textContent || 'ошибка графа модулей', 'err');
  }
}

function markProject(id) {
  $$('[data-project]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.project === id));
}

/* -------------------------------------------------------------------- wasm */

function encodeManifest(files, entryPath) {
  const encoder = new TextEncoder();
  const parts = [];
  const push32 = (value) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, true);
    parts.push(new Uint8Array(buf));
  };
  const magic = encoder.encode('LPF1');
  parts.push(magic);
  push32(files.length);
  let entryIndex = 0;
  files.forEach((file, index) => {
    if (file.name === entryPath) entryIndex = index;
    const path = encoder.encode(file.name);
    const src = encoder.encode(file.code);
    push32(path.length);
    parts.push(path);
    push32(src.length);
    parts.push(src);
  });
  push32(entryIndex);
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function detectWasmAbi() {
  try {
    const loaded = await loadCompilerWasm('../compiler.wasm');
    state.compilerBytes = loaded.bytes.length;
    state.wasmAbi = loaded.exports.some((exp) => exp.name === 'latent_compile_files');
    const badge = $('#abi-badge');
    if (badge) {
      badge.textContent = state.wasmAbi ? 'engine #2 · latent_compile_files' : 'engine #1 · JS linker';
      badge.className = `k-badge ${state.wasmAbi ? 'k-badge--green' : 'k-badge--amber'}`;
    }
    setText('#abi-detail', state.wasmAbi
      ? 'compiler.wasm экспортирует модульный ABI: страница кодирует manifest и запускает WASM. JS-линкер ниже показывает граф и мангленные имена.'
      : `compiler.wasm (${fmtBytes(loaded.bytes.length)}) в этой сборке не экспортирует latent_compile_files — проект исполняется движком №1. Это не имитация: линковка настоящая, но в JS.`);
    setText('#m-abi', state.wasmAbi ? 'WASM' : 'engine #1');
    if (state.wasmAbi) await initWasmCompiler(loaded);
  } catch (error) {
    setText('#abi-detail', `compiler.wasm не загрузился: ${error.message}; остаёмся на движке №1.`);
  }
}

let wasmCompiler = null;

async function initWasmCompiler(loaded) {
  const instance = new WebAssembly.Instance(loaded.module, {env: {print() {}}});
  wasmCompiler = instance.exports;
}

async function compileProjectWasm() {
  if (!wasmCompiler || !wasmCompiler.latent_compile_files) return null;
  const files = filesArray();
  const manifest = encodeManifest(files, project().entry);
  const ptr = wasmCompiler.latent_alloc(manifest.length);
  new Uint8Array(wasmCompiler.memory.buffer).set(manifest, ptr);
  const res = wasmCompiler.latent_compile_files(ptr, manifest.length);
  const view = new DataView(wasmCompiler.memory.buffer);
  const status = view.getUint32(res, true);
  const len = view.getUint32(res + 4, true);
  const payload = new Uint8Array(wasmCompiler.memory.buffer, res + 8, len).slice();
  try { wasmCompiler.latent_free(ptr, manifest.length); } catch {}
  try { wasmCompiler.latent_free(res, 8 + len); } catch {}
  if (status !== 1) throw new Error(new TextDecoder().decode(payload));
  return payload;
}

function runWasmProject(wasmBytes) {
  const output = [];
  let instance;
  const decoder = new TextDecoder();
  const imports = {
    env: {
      print(ptr) {
        const buffer = instance.exports.memory.buffer;
        const length = new DataView(buffer).getUint32(ptr, true);
        output.push(decoder.decode(new Uint8Array(buffer, ptr + 4, length)));
      },
    },
  };
  instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), imports);
  if (typeof instance.exports.main !== 'function') throw new Error('wasm module has no main export');
  const t0 = performance.now();
  const result = instance.exports.main();
  return {result, output, ms: performance.now() - t0, bytes: wasmBytes.length};
}

/* -------------------------------------------------------------------- setup */

function buildProjects() {
  const host = $('#projects');
  host.innerHTML = Object.entries(PROJECTS).map(([id, preset], index) => `
    <button class="k-sample${index === 0 ? ' is-active' : ''}" type="button" data-project="${id}">
      <span>
        <span>${esc(preset.name)}</span>
        <small style="display:block;color:var(--k-dim);font-size:10.5px">${esc(preset.desc)}</small>
      </span>
      <span class="k-badge k-badge--muted">${preset.files.length}</span>
    </button>
  `).join('');
  $$('[data-project]').forEach((btn) => {
    btn.addEventListener('click', () => {
      markProject(btn.dataset.project);
      loadProject(btn.dataset.project);
    });
  });
}

async function boot() {
  buildProjects();
  state.editor = new EnhancedEditor($('#module-editor'), {
    value: '',
    onChange: () => {
      if (state.suppressChange) return;
      saveActive();
      scheduleGraph();
    },
    tall: true,
  });
  $('#module-editor').addEventListener('editor-run', () => runProject());
  $('#run-project').addEventListener('click', runProject);
  $('#reset-project').addEventListener('click', () => loadProject(state.projectId));
  loadProject('stats');
  detectWasmAbi();
  document.documentElement.dataset.killerReady = '1';
}

window.__killerModules = {
  run: runProject,
  load: loadProject,
  state: () => ({
    project: state.projectId,
    files: state.files.map((file) => file.name),
    graph: state.graph ? {
      entry: state.graph.entry,
      modules: state.graph.modules.map((m) => m.path),
      cycles: state.graph.cycles,
    } : null,
    last: window.__killerModules.last || null,
    wasmAbi: state.wasmAbi,
  }),
  last: null,
};

boot();
