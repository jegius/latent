// killer-ai.js — AI-native primitives executed by engine #1 (offline mock).
//
// Every number on the page is produced by a real Latent program: ai_embed,
// cosine_similarity, ai_infer, ai_stream/stream_next, tensor and matmul are
// called from Latent source and executed by the JS interpreter. The page only
// visualizes the recorded results. Optional gateway: ai_infer is fetched from a
// real endpoint and injected into the interpreter cache; embeddings stay mock.

import {
  $, $$, esc, clamp, fmtInt, fmtMs, sleep, prefersReducedMotion, initEmbed,
  initNav, CodeViewer, setupCanvas, showTooltip, hideTooltip, heatColor,
  setStatus,
} from '../assets/killer.js';
import {
  tokenize, Parser, Interpreter, configureAI, getAIConfig, checkAIGateway,
  aiInferRemote, cosineSimilarity,
} from '../vendor/compiler/index.js';
import { buildBuiltins } from '../vendor/compiler/interpreter-builtins.js';

initEmbed();
initNav();

const DEFAULT_DOCS = [
  'goroutines and channels are syntax in Latent',
  'AI-native primitives: embeddings, tensors, inference',
  'self-hosted compiler compiles itself to WebAssembly',
  'sandboxed execution with a single print import',
  'file modules, imports and a browser linker',
];
const DEFAULT_PROMPT = 'How do channels and AI primitives work in Latent?';

const state = {
  docs: [...DEFAULT_DOCS],
  prompt: DEFAULT_PROMPT,
  trace: null,
  result: null,
  streamToken: 0,
  tensorTimers: [],
  gateway: false,
};

/* ------------------------------------------------------------------ program */

function escapeLatent(text) {
  return String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(/\r?\n/g, ' ');
}

function buildSource(docs, prompt) {
  const docList = docs.map((d) => `"${escapeLatent(d)}"`).join(', ');
  return `// AI-примитивы — часть грамматики Latent, а не библиотека.
// Программа исполняется движком №1 (JS-интерпретатор) прямо в браузере.
fn main() -> int {
    let docs = [${docList}];
    let prompt = "${escapeLatent(prompt)}";

    // 1) эмбеддинги документов (детерминированный mock, офлайн)
    let mat = [];
    let i = 0;
    while (i < docs.length) {
        mat.push(ai_embed(docs[i]));
        i = i + 1;
    }

    // 2) матрица косинусной близости docs × docs
    i = 0;
    while (i < docs.length) {
        let j = 0;
        while (j < docs.length) {
            print("SIM", i, j, cosine_similarity(mat[i], mat[j]));
            j = j + 1;
        }
        i = i + 1;
    }

    // 3) близость запроса к документам
    let q = ai_embed(prompt);
    i = 0;
    while (i < docs.length) {
        print("RANK", i, cosine_similarity(q, mat[i]));
        i = i + 1;
    }

    // 4) инференс и поток токенов
    let answer = ai_infer("mock:latent-1", prompt);
    print("INFER", answer);
    let s = ai_stream("mock:latent-1", prompt);
    let k = 0;
    while (k < 48) {
        let tok = stream_next(s);
        if (tok == null) {
            k = 48;
        } else {
            print("TOK", tok);
            k = k + 1;
        }
    }

    // 5) тензоры: A(2×3) × B(3×2) = C(2×2)
    let a = tensor([[1, 2, 3], [4, 5, 6]]);
    let b = tensor([[7, 8], [9, 10], [11, 12]]);
    let c = matmul(a, b);
    print("MAT", c.data[0][0], c.data[0][1], c.data[1][0], c.data[1][1]);
    return 0;
}`;
}

/* ------------------------------------------------------------------- trace */

class AIInterpreter extends Interpreter {
  constructor(program, output) {
    super(program, output);
    this.aiTrace = {
      embeds: [],
      infers: [],
      cos: [],
      tensors: [],
      matmuls: [],
      tokens: [],
      streams: [],
    };
    this.vectorLabels = new Map();
  }

  enableAI() { this.aiEnabled = true; }

  aiEmbed(text) {
    const value = super.aiEmbed(text);
    this.aiTrace.embeds.push({ text: String(text), vector: value });
    this.vectorLabels.set(value, String(text));
    return value;
  }

  aiInfer(model, prompt) {
    const text = super.aiInfer(model, prompt);
    this.aiTrace.infers.push({ model: String(model), prompt: String(prompt), text: String(text) });
    return text;
  }

  aiStream(model, prompt) {
    const handle = super.aiStream(model, prompt);
    this.aiTrace.streams.push({ model: String(model), prompt: String(prompt), handle });
    return handle;
  }

  streamNext(handle) {
    const token = super.streamNext(handle);
    if (token != null) this.aiTrace.tokens.push(String(token));
    return token;
  }

  get builtins() {
    const builtins = buildBuiltins(this);
    const cosine = builtins.cosine_similarity;
    builtins.cosine_similarity = (args) => {
      const value = cosine(args);
      const a = this.vectorLabels.get(args[0]) || null;
      const b = this.vectorLabels.get(args[1]) || null;
      this.aiTrace.cos.push({a, b, value});
      return value;
    };
    const tensor = builtins.tensor;
    builtins.tensor = (args) => {
      const value = tensor(args);
      this.aiTrace.tensors.push({
        data: value.data.flat(Infinity),
        shape: [...value.shape],
      });
      return value;
    };
    const matmul = builtins.matmul;
    builtins.matmul = (args) => {
      const value = matmul(args);
      this.aiTrace.matmuls.push({
        a: args[0] ? {data: args[0].data.flat(Infinity), shape: [...args[0].shape]} : null,
        b: args[1] ? {data: args[1].data.flat(Infinity), shape: [...args[1].shape]} : null,
        c: value ? {data: value.data.flat(Infinity), shape: [...value.shape]} : null,
      });
      return value;
    };
    return builtins;
  }
}

function executeAI(source, aiCache) {
  const program = new Parser(tokenize(source)).parseProgram();
  const lines = [];
  const interp = new AIInterpreter(program, (line) => lines.push(line));
  interp.enableAI();
  if (aiCache) interp.aiCache = aiCache;
  const t0 = performance.now();
  let result = null;
  let error = null;
  try {
    result = interp.run();
  } catch (e) {
    error = String(e.message || e);
  }
  return {
    result,
    error,
    lines,
    realMs: performance.now() - t0,
    trace: interp.aiTrace,
    source,
  };
}

/* --------------------------------------------------------------- rendering */

let codeViewer = null;
let heat = {cells: [], docs: [], size: 0, hover: null};
let heatCtrl = null;

function docLabel(index) {
  return `D${index + 1}`;
}

function shortText(text, n = 34) {
  const t = String(text);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const JS_EQUIV = `// JS: те же шаги — это SDK, HTTP, JSON и отдельные библиотеки.
import OpenAI from 'openai';
import { Matrix } from 'ml-matrix';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// эмбеддинги (сеть + деньги + ключ)
async function embed(text) {
  const res = await client.embeddings.create({
    model: 'text-embedding-3-small', input: text,
  });
  return res.data[0].embedding;
}

// косинусная близость руками
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// инференс + стриминг через async iterator
async function infer(prompt) {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini', stream: true,
    messages: [{ role: 'user', content: prompt }],
  });
  const tokens = [];
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content;
    if (t) tokens.push(t);
  }
  return tokens;
}

const docs = ['...', '...'];
const vectors = await Promise.all(docs.map(embed));
const prompt = await embed('...');
const matrix = vectors.map((a) => vectors.map((b) => cosine(a, b)));
const rank = vectors.map((v) => cosine(prompt, v));
const tokens = await infer('...');

// матрицы — отдельная библиотека
const a = new Matrix([[1, 2, 3], [4, 5, 6]]);
const b = new Matrix([[7, 8], [9, 10], [11, 12]]);
const c = a.mmul(b);
`;

function renderVectors(docs, prompt, embeds) {
  const host = $('#vectors');
  const byText = new Map();
  for (const embed of embeds) byText.set(embed.text, embed.vector);
  const unique = [];
  const seen = new Set();
  for (const text of [...docs, prompt]) {
    if (seen.has(text) || !byText.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  host.innerHTML = unique.map((text, index) => {
    const vector = byText.get(text);
    const label = index < docs.length ? `${docLabel(index)}` : 'prompt';
    const cells = vector.map((value) => {
      const t = (value + 1) / 2;
      return `<span class="k-vector-cell" style="background:${heatColor(t, 0.9)}" title="${value.toFixed(3)}"></span>`;
    }).join('');
    return `<div class="k-vector-row">
      <span class="k-vector-name" title="${esc(text)}"><b>${label}</b> ${esc(shortText(text, 26))}</span>
      <span class="k-vector-cells">${cells}</span>
      <span class="k-vector-val">${vector.length}d</span>
    </div>`;
  }).join('');
}

function buildSimilarity(docs, cos) {
  const n = docs.length;
  const matrix = Array.from({length: n}, () => Array(n).fill(0));
  const rank = Array(n).fill(0);
  for (const entry of cos) {
    if (entry.a == null || entry.b == null) continue;
    const ai = docs.indexOf(entry.a);
    const bi = docs.indexOf(entry.b);
    if (ai >= 0 && bi >= 0) matrix[ai][bi] = entry.value;
    if (entry.a && entry.a === state.prompt && bi >= 0) rank[bi] = entry.value;
    if (entry.b && entry.b === state.prompt && ai >= 0) rank[ai] = entry.value;
  }
  return {matrix, rank};
}

function drawHeatmap() {
  const canvas = $('#heatmap');
  if (!canvas || !state.trace) return;
  if (!heatCtrl) {
    heatCtrl = setupCanvas(canvas);
    heatCtrl.onResize(() => drawHeatmap());
  } else {
    heatCtrl.resize();
  }
  const {ctx, w, h} = heatCtrl.state;
  if (w < 20 || h < 20) return;
  const n = state.docs.length;
  const {matrix} = buildSimilarity(state.docs, state.trace.trace.cos);
  const padLeft = 46;
  const padTop = 34;
  const padRight = 10;
  const padBottom = 12;
  const size = Math.min(w - padLeft - padRight, h - padTop - padBottom);
  const cell = size / n;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  heat = {cells: [], docs: state.docs, size, cell, x0: padLeft, y0: padTop, hover: null};
  // column labels
  for (let j = 0; j < n; j += 1) {
    ctx.fillStyle = 'rgba(154,169,199,0.85)';
    ctx.fillText(docLabel(j), padLeft + j * cell + cell / 2 - 6, padTop - 12);
  }
  // rows
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = 'rgba(154,169,199,0.85)';
    ctx.fillText(docLabel(i), 8, padTop + i * cell + cell / 2);
    for (let j = 0; j < n; j += 1) {
      const value = matrix[i][j];
      const t = (value + 1) / 2;
      const x = padLeft + j * cell;
      const y = padTop + i * cell;
      ctx.fillStyle = heatColor(t, 0.95);
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      if (cell > 42) {
        ctx.fillStyle = Math.abs(value) > 0.55 ? 'rgba(4,7,13,0.85)' : 'rgba(232,238,251,0.85)';
        ctx.textAlign = 'center';
        ctx.fillText(value.toFixed(2), x + cell / 2, y + cell / 2);
        ctx.textAlign = 'left';
      }
      heat.cells.push({i, j, value, x, y, w: cell, h: cell});
    }
  }
  // legend
  const legendY = padTop + size + 8;
  const legendW = Math.min(size, 180);
  for (let i = 0; i < legendW; i += 1) {
    ctx.fillStyle = heatColor(i / legendW, 0.9);
    ctx.fillRect(padLeft + i, legendY, 1.5, 5);
  }
  ctx.fillStyle = 'rgba(154,169,199,0.7)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('cos −1', padLeft, legendY + 16);
  ctx.textAlign = 'right';
  ctx.fillText('+1', padLeft + legendW, legendY + 16);
  ctx.restore();
}

function renderRank(docs, prompt, cos) {
  const host = $('#rank');
  const {rank} = buildSimilarity(docs, cos);
  const order = rank.map((value, i) => ({value, i})).sort((a, b) => b.value - a.value);
  const max = Math.max(1e-9, ...rank.map(Math.abs));
  host.innerHTML = order.map((item, k) => `
    <div class="k-rank-row">
      <span class="k-rank-n">${k + 1}</span>
      <span class="k-rank-name" title="${esc(docs[item.i])}">${esc(shortText(docs[item.i], 40))}</span>
      <span class="k-rank-val">${item.value.toFixed(3)}</span>
      <span class="k-rank-bar"><i style="width:${(Math.abs(item.value) / max) * 100}%"></i></span>
    </div>
  `).join('');
  const top = order[0];
  setText('#m-sim', top ? top.value.toFixed(3) : '—');
  setText('#m-sim-badge', top ? `top ${docLabel(top.i)} · ${top.value.toFixed(3)}` : 'cos ∈ [−1, 1]');
}

function renderTensors(trace) {
  const tensors = trace.tensors;
  const matmul = trace.matmuls[trace.matmuls.length - 1];
  const a = matmul?.a || tensors[0];
  const b = matmul?.b || tensors[1];
  const c = matmul?.c || null;
  const renderMatrix = (data, shape, host, extra = '') => {
    if (!data || !shape) { host.innerHTML = '<p class="k-hint">—</p>'; return; }
    const [rows, cols] = shape;
    host.innerHTML = `<div class="k-matrix-caption">${rows}×${cols}${extra}</div>` +
      `<div class="k-matrix" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr))">` +
      data.map((v, i) => `<span class="k-matrix-cell" data-mat-i="${i}" data-mat-r="${Math.floor(i / cols)}" data-mat-c="${i % cols}">${v}</span>`).join('') +
      '</div>';
  };
  renderMatrix(a?.data, a?.shape, $('#mat-a'));
  renderMatrix(b?.data, b?.shape, $('#mat-b'));
  renderMatrix(c?.data, c?.shape, $('#mat-c'), c ? ' = A × B' : '');
  const rowsA = a?.shape?.[0] || 0;
  const shared = a?.shape?.[1] || 0;
  const colsB = b?.shape?.[1] || 0;
  setText('#m-flops', fmtInt(2 * rowsA * shared * colsB));
  setText('#mat-shapes', a && b && c ? `A ${a.shape.join('×')} · B ${b.shape.join('×')} → C ${c.shape.join('×')}` : '—');
}

function renderCode(source) {
  if (!codeViewer) {
    codeViewer = new CodeViewer($('#code-latent'), {
      files: [{name: 'pipeline.lat', code: source}],
      height: 'tall',
    });
    // eslint-disable-next-line no-new
    new CodeViewer($('#code-js'), {
      files: [{name: 'pipeline.js', lang: 'js', code: JS_EQUIV}],
      height: 'tall',
    });
  } else {
    codeViewer.files[0].code = source;
    codeViewer.select(0);
  }
  setText('#latent-lines', `${source.split('\n').length} строк`);
}

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

/* ------------------------------------------------------------------ stream */

async function streamTokens(tokens, {delay = 55} = {}) {
  const host = $('#stream');
  const token = ++state.streamToken;
  host.textContent = '';
  const reduce = prefersReducedMotion();
  let count = 0;
  for (const part of tokens) {
    if (token !== state.streamToken) return;
    const span = document.createElement('span');
    span.className = 'k-tok';
    span.textContent = `${part} `;
    host.append(span);
    count += 1;
    setText('#stream-count', `${count} / ${tokens.length} токенов`);
    if (!reduce) await sleep(delay);
  }
  if (token === state.streamToken) {
    setText('#stream-status', `поток завершён · ${tokens.length} токенов`);
    setText('#m-tokens', fmtInt(tokens.length));
  }
}

/* ------------------------------------------------------------------- run */

async function runPipeline({useGateway = false} = {}) {
  const prompt = $('#prompt').value.trim() || DEFAULT_PROMPT;
  const docs = $('#docs').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 7);
  if (docs.length < 2) {
    setStatus($('#ai-status'), 'нужно хотя бы два документа', 'err');
    return;
  }
  state.docs = docs;
  state.prompt = prompt;
  const source = buildSource(docs, prompt);
  renderCode(source);
  setStatus($('#ai-status'), 'исполняем Latent-программу…');
  setActiveStep(-1);
  $('#run-ai').disabled = true;

  let aiCache = null;
  let gatewayNote = '';
  if (useGateway && getAIConfig().provider !== 'mock') {
    setStatus($('#ai-status'), `проверяем gateway ${getAIConfig().provider}…`);
    const check = await checkAIGateway();
    if (!check.ok) {
      gatewayNote = `gateway недоступен: ${check.error} — использую mock`;
      setStatus($('#gateway-status'), gatewayNote, 'err');
    } else {
      try {
        const remote = await aiInferRemote(null, prompt);
        aiCache = new Map([[prompt, remote]]);
        gatewayNote = `ai_infer ← ${getAIConfig().provider}/${getAIConfig().model}`;
        setStatus($('#gateway-status'), `gateway OK · ${remote.length} символов`, 'ok');
      } catch (e) {
        gatewayNote = `gateway error: ${e.message} — mock`;
        setStatus($('#gateway-status'), gatewayNote, 'err');
      }
    }
  }

  await new Promise((resolve) => requestAnimationFrame(resolve));
  let result;
  try {
    result = executeAI(source, aiCache);
  } catch (error) {
    setStatus($('#ai-status'), `ошибка парсинга: ${error.message}`, 'err');
    $('#run-ai').disabled = false;
    return;
  }
  if (result.error) {
    setStatus($('#ai-status'), `ошибка исполнения: ${result.error}`, 'err');
    $('#run-ai').disabled = false;
    return;
  }
  state.result = result;
  state.trace = {
    trace: result.trace,
    lines: result.lines,
    realMs: result.realMs,
  };
  renderVectors(docs, prompt, result.trace.embeds);
  renderRank(docs, prompt, result.trace.cos);
  drawHeatmap();
  renderTensors(result.trace);
  setText('#m-embed', fmtInt(result.trace.embeds.length));
  setText('#m-cosine', fmtInt(result.trace.cos.length));
  setText('#m-time', fmtMs(result.realMs));
  setText('#m-tokens', fmtInt(result.trace.tokens.length));
  setText('#m-infer', fmtInt(result.trace.infers.length));
  setText('#m-matmul', fmtInt(result.trace.matmuls.length));
  setText('#stream-status', `${result.trace.tokens.length} токенов записано`);
  setStatus($('#ai-status'),
    `Latent-программа: ${fmtMs(result.realMs)} · ${result.lines.length} строк вывода` +
    (gatewayNote ? ` · ${gatewayNote}` : ' · offline mock'),
    'ok');
  $('#run-ai').disabled = false;
  $('#stream-btn').disabled = false;
  $('#matmul-btn').disabled = false;
  await highlightPipeline();
  await streamTokens(result.trace.tokens);
  setActiveStep(-1);
  window.__killerAI = {
    prompt,
    docs,
    embedCalls: result.trace.embeds.length,
    cosineOps: result.trace.cos.length,
    tokens: result.trace.tokens.length,
    matmul: result.trace.matmuls.at(-1) || null,
    realMs: result.realMs,
    outputs: result.lines,
    source,
  };
  document.documentElement.dataset.killerReady = '1';
}

async function highlightPipeline() {
  const steps = $$('[data-step]');
  for (let i = 0; i < steps.length; i += 1) {
    setActiveStep(i);
    await sleep(prefersReducedMotion() ? 0 : 140);
  }
}

function setActiveStep(index) {
  $$('[data-step]').forEach((el, i) => el.classList.toggle('is-active', i === index));
}

/* --------------------------------------------------------------- tensor fx */

function animateMatmul() {
  state.tensorTimers.forEach(clearTimeout);
  state.tensorTimers = [];
  const a = state.trace?.trace.matmuls.at(-1)?.a;
  const b = state.trace?.trace.matmuls.at(-1)?.b;
  const c = state.trace?.trace.matmuls.at(-1)?.c;
  if (!a || !b || !c) return;
  const [m, k] = a.shape;
  const p = b.shape[1];
  const reduce = prefersReducedMotion();
  const clear = () => {
    $$('#mat-a .k-matrix-cell').forEach((el) => el.classList.remove('is-row'));
    $$('#mat-b .k-matrix-cell').forEach((el) => el.classList.remove('is-col'));
    $$('#mat-c .k-matrix-cell').forEach((el) => el.classList.remove('is-hot'));
  };
  clear();
  $$('#mat-c .k-matrix-cell').forEach((el) => el.classList.remove('is-hot'));
  if (reduce) {
    $$('#mat-c .k-matrix-cell').forEach((el) => el.classList.add('is-hot'));
    return;
  }
  let delay = 0;
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < p; j += 1) {
      const tick = () => {
        clear();
        $$(`#mat-a .k-matrix-cell[data-mat-r="${i}"]`).forEach((el) => el.classList.add('is-row'));
        $$(`#mat-b .k-matrix-cell[data-mat-c="${j}"]`).forEach((el) => el.classList.add('is-col'));
        const out = $(`#mat-c .k-matrix-cell[data-mat-i="${i * p + j}"]`);
        if (out) out.classList.add('is-hot');
      };
      state.tensorTimers.push(setTimeout(tick, delay));
      delay += 300;
    }
  }
  state.tensorTimers.push(setTimeout(() => {
    clear();
    $$('#mat-c .k-matrix-cell').forEach((el) => el.classList.add('is-hot'));
  }, delay));
}

/* ---------------------------------------------------------------- gateway */

function applyGateway() {
  const provider = $('#gateway-provider').value;
  const baseUrl = $('#gateway-url').value.trim();
  const model = $('#gateway-model').value.trim();
  const apiKey = $('#gateway-key').value.trim();
  configureAI({provider, baseUrl, model, apiKey});
  state.gateway = provider !== 'mock';
  const label = provider === 'mock' ? 'offline mock' : `${provider} · ${model || 'model'}`;
  setText('#gateway-badge', label);
  setStatus($('#gateway-status'), provider === 'mock'
    ? 'детерминированный mock, сеть не используется'
    : 'настройки применены (ключ хранится только в памяти вкладки)', 'ok');
}

function resetGateway() {
  configureAI({provider: 'mock', baseUrl: 'http://localhost:11434', model: 'qwen3:4b', apiKey: ''});
  $('#gateway-provider').value = 'mock';
  setText('#gateway-badge', 'offline mock');
  setStatus($('#gateway-status'), 'mock: сеть не используется', 'ok');
}

/* ------------------------------------------------------------------- wire */

function wire() {
  $('#prompt').value = state.prompt;
  $('#docs').value = state.docs.join('\n');
  $('#run-ai').addEventListener('click', () => runPipeline({useGateway: state.gateway}));
  $('#stream-btn').addEventListener('click', () => {
    if (state.trace) streamTokens(state.trace.trace.tokens);
  });
  $('#matmul-btn').addEventListener('click', animateMatmul);
  $('#gateway-apply').addEventListener('click', applyGateway);
  $('#gateway-reset').addEventListener('click', resetGateway);
  $('#gateway-provider').addEventListener('change', () => {
    const mock = $('#gateway-provider').value === 'mock';
    $('#gateway-fields').classList.toggle('k-hide', mock);
  });
  $('#gateway-provider').dispatchEvent(new Event('change'));

  const canvas = $('#heatmap');
  canvas.addEventListener('mousemove', (event) => {
    if (!heat.cells.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cell = heat.cells.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    if (!cell) { hideTooltip(); return; }
    showTooltip(
      `${docLabel(cell.i)} × ${docLabel(cell.j)} = <b>${cell.value.toFixed(4)}</b><br>` +
      `${esc(shortText(heat.docs[cell.i], 28))}<br>${esc(shortText(heat.docs[cell.j], 28))}`,
      event.clientX, event.clientY - 6,
    );
  });
  canvas.addEventListener('mouseleave', hideTooltip);

  window.addEventListener('resize', () => {
    drawHeatmap();
  });
}

wire();
runPipeline({useGateway: false}).then(() => {
  document.documentElement.dataset.killerReady = '1';
});

window.__killer = {
  run: (opts) => runPipeline(opts || {useGateway: false}),
  state: () => ({
    prompt: state.prompt,
    docs: state.docs,
    trace: state.trace ? {
      embedCalls: state.trace.trace.embeds.length,
      cosineOps: state.trace.trace.cos.length,
      tokens: state.trace.trace.tokens.length,
      realMs: state.trace.realMs,
      outputs: state.trace.lines,
      matmul: state.trace.trace.matmuls.at(-1) || null,
    } : null,
  }),
};
