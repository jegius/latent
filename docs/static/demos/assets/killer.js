// killer.js — shared, dependency-free toolkit for the five killer demos.
//
// Exports: DOM/format helpers, a Latent/JS highlighter, CodeViewer (tabs + line
// numbers), EnhancedEditor (textarea + live highlight), canvas/RAF helpers,
// colour ramps, tooltips, number animation and a small compiler.wasm loader.
// Everything is plain ESM and works offline from GitHub Pages.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function fmtInt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0 ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(0)} µs`;
  return `${(ms * 1e6).toFixed(0)} ns`;
}

export function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function fmtPct(x, digits = 0) {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** +?embed=1 → compact layout used by the docs iframes (and CDP tests). */
export function initEmbed() {
  const params = new URLSearchParams(location.search);
  const embed = params.get('embed') === '1' || params.get('embed') === 'true';
  if (embed) document.documentElement.classList.add('k-embed');
  document.documentElement.dataset.embed = embed ? '1' : '0';
  return embed;
}

export function initNav() {
  const toggle = $('[data-nav-toggle]');
  const nav = $('.k-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

/** Copy text with a clipboard fallback; returns a promise<boolean>. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ highlight */

const LATENT_KEYWORDS = new Set([
  'fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return', 'true', 'false',
  'null', 'print', 'class', 'new', 'this', 'enum', 'import', 'export', 'from',
  'as', 'async', 'await', 'spawn', 'channel', 'select', 'case', 'default',
  'yield', 'match', 'test', 'assert', 'assert_eq', 'forall', 'snapshot',
  'ai', 'tensor', 'semantic', 'ai_contract', 'enforce_contract',
]);

const LATENT_BUILTINS = new Set([
  'print', 'len', 'push', 'pop', 'channel', 'tensor', 'semantic', 'matmul',
  'cosine_similarity', 'dot', 'magnitude', 'zeros', 'ones', 'range', 'Ok',
  'Err', 'Some', 'None', 'unwrap', 'unwrap_or', 'is_ok', 'is_err', 'is_some',
  'assert', 'assert_eq', 'ai_infer', 'ai_embed', 'ai_stream', 'stream_next',
  'ai_contract', 'enforce_contract', 'snapshot', 'alloc', 'load8', 'store8',
  'load32', 'store32', 'memcopy',
]);

const LATENT_TYPES = new Set([
  'int', 'float', 'bool', 'string', 'void', 'channel', 'tensor', 'semantic',
  'fn',
]);

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
  'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
  'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
  'typeof', 'var', 'void', 'while', 'yield', 'true', 'false', 'null',
  'undefined', '=>',
]);

function tokenClass(word, lang, prev) {
  if (lang === 'js') {
    if (JS_KEYWORDS.has(word)) return 'kw';
    if (prev === 'function' || prev === 'class' || prev === 'new') return 'fn';
    if (/^[A-Z]/.test(word)) return 'type';
    return 'ident';
  }
  if (LATENT_KEYWORDS.has(word)) {
    if (word === 'fn' || word === 'class' || word === 'enum') return 'kw';
    return 'kw';
  }
  if (prev === 'fn' || prev === 'class' || prev === 'enum' || prev === 'new') return 'fn';
  if (LATENT_BUILTINS.has(word)) return 'builtin';
  if (LATENT_TYPES.has(word)) return 'type';
  if (/^[A-Z]/.test(word)) return 'type';
  return 'ident';
}

/**
 * Tokenize one line and return HTML. Strings/comments never span lines in the
 * snippets we show; JS template literals are handled as a single token per line.
 * @param {string} line
 * @param {'latent'|'js'} lang
 */
export function highlightLine(line, lang = 'latent') {
  let out = '';
  let i = 0;
  let prev = '';
  const n = line.length;
  const push = (text, cls) => {
    if (!text) return;
    out += cls ? `<span class="k-tok-${cls}">${esc(text)}</span>` : esc(text);
  };
  while (i < n) {
    const ch = line[i];
    const rest = line.slice(i);

    // comments
    if (rest.startsWith('//')) {
      push(rest, 'com');
      break;
    }
    if (rest.startsWith('/*')) {
      const end = line.indexOf('*/', i + 2);
      const text = end === -1 ? rest : line.slice(i, end + 2);
      push(text, 'com');
      i += text.length;
      continue;
    }
    // strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let value = quote;
      while (j < n) {
        const c = line[j];
        value += c;
        if (c === '\\') {
          if (j + 1 < n) value += line[j + 1];
          j += 2;
          continue;
        }
        j += 1;
        if (c === quote) break;
      }
      push(value, 'str');
      i = j;
      prev = 'string';
      continue;
    }
    // numbers
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9._xXa-fA-F]/.test(line[j])) j += 1;
      push(line.slice(i, j), 'num');
      i = j;
      prev = 'number';
      continue;
    }
    // identifiers
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      push(word, tokenClass(word, lang, prev));
      prev = word;
      i = j;
      continue;
    }
    // multi-char operators
    const three = line.slice(i, i + 3);
    const two = line.slice(i, i + 2);
    if (three === '...' || three === '===' || three === '!==' || three === '>>>') {
      push(three, 'op');
      i += 3;
      prev = 'op';
      continue;
    }
    if (['==', '!=', '<=', '>=', '&&', '||', '->', '=>', '<-', '**', '+=',
      '-=', '*=', '/=', '++', '--', '::'].includes(two)) {
      push(two, 'op');
      i += 2;
      prev = 'op';
      continue;
    }
    if ('+-*/%<>=!&|^~?'.includes(ch)) {
      push(ch, 'op');
      i += 1;
      prev = 'op';
      continue;
    }
    if ('(){}[];,:.@'.includes(ch)) {
      push(ch, 'punct');
      i += 1;
      prev = 'punct';
      continue;
    }
    if (/\s/.test(ch)) {
      push(ch);
      i += 1;
      continue;
    }
    push(ch);
    i += 1;
  }
  return out;
}

export function highlightCode(code, lang = 'latent') {
  return String(code)
    .split('\n')
    .map((line) => highlightLine(line, lang))
    .join('\n');
}

/* ---------------------------------------------------------------- CodeViewer */

export class CodeViewer {
  /**
   * @param {HTMLElement} root
   * @param {{files: {name: string, lang?: string, code: string, note?: string}[],
   *   height?: 'tall'|'normal', start?: number}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.files = opts.files;
    this.lang = opts.lang || 'latent';
    this.current = opts.start || 0;
    this.height = opts.height || 'normal';
    this.render();
  }

  render() {
    const files = this.files;
    this.root.classList.add('k-code');
    this.root.innerHTML = `
      <div class="k-code-head">
        <div class="k-tabs" role="tablist">
          ${files.map((f, i) => `
            <button class="k-tab${i === this.current ? ' is-active' : ''}" type="button"
              role="tab" aria-selected="${i === this.current}" data-code-tab="${i}">${esc(f.name)}</button>
          `).join('')}
        </div>
        <button class="k-copy" type="button" data-code-copy>Копировать</button>
      </div>
      <div class="k-code-body${this.heightClass}">
        <pre class="k-code-pre" data-code-pre></pre>
      </div>`;
    this.pre = $('[data-code-pre]', this.root);
    this.body = $('.k-code-body', this.root);
    $$('[data-code-tab]', this.root).forEach((tab) => {
      tab.addEventListener('click', () => this.select(Number(tab.dataset.codeTab)));
    });
    const copy = $('[data-code-copy]', this.root);
    copy.addEventListener('click', async () => {
      const ok = await copyText(files[this.current].code);
      copy.textContent = ok ? 'Скопировано ✓' : 'Не вышло';
      copy.classList.toggle('is-done', ok);
      setTimeout(() => { copy.textContent = 'Копировать'; copy.classList.remove('is-done'); }, 1400);
    });
    this.select(this.current);
  }

  get heightClass() {
    return this.height === 'tall' ? ' k-code-body--tall' : '';
  }

  select(index) {
    this.current = clamp(index, 0, this.files.length - 1);
    const file = this.files[this.current];
    const lang = file.lang || this.lang;
    this.pre.innerHTML = file.code.split('\n').map((line, i) => `
      <div class="k-code-line"><span class="k-ln">${i + 1}</span><span class="k-code-text">${highlightLine(line, lang) || ' '}</span></div>
    `).join('');
    $$('[data-code-tab]', this.root).forEach((tab, i) => {
      const on = i === this.current;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
  }
}

/* ------------------------------------------------------------ EnhancedEditor */

export class EnhancedEditor {
  /**
   * @param {HTMLElement} root
   * @param {{value?: string, lang?: string, tall?: boolean, short?: boolean,
   *   onChange?: (value: string) => void}} opts
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.lang = opts.lang || 'latent';
    this.onChange = opts.onChange || (() => {});
    root.classList.add('k-editor');
    if (opts.tall) root.classList.add('k-editor--tall');
    if (opts.short) root.classList.add('k-editor--short');
    root.innerHTML = `
      <div class="k-editor-gutter" data-gutter aria-hidden="true"></div>
      <div class="k-editor-pane">
        <pre class="k-editor-highlight" data-highlight aria-hidden="true"></pre>
        <textarea class="k-editor-area" data-area spellcheck="false" autocapitalize="off"
          autocomplete="off" wrap="off" aria-label="Latent editor"></textarea>
      </div>`;
    this.area = $('[data-area]', root);
    this.highlight = $('[data-highlight]', root);
    this.gutter = $('[data-gutter]', root);
    this.area.value = opts.value || '';
    this.area.addEventListener('input', () => this.sync());
    this.area.addEventListener('scroll', () => {
      this.highlight.scrollTop = this.area.scrollTop;
      this.highlight.scrollLeft = this.area.scrollLeft;
      this.gutter.scrollTop = this.area.scrollTop;
    });
    this.area.addEventListener('keydown', (event) => this.onKeydown(event));
    this.sync();
  }

  onKeydown(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const {selectionStart, selectionEnd, value} = this.area;
      this.area.setRangeText('  ', selectionStart, selectionEnd, 'end');
      this.sync();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.root.dispatchEvent(new CustomEvent('editor-run', {bubbles: true}));
    }
  }

  sync() {
    const value = this.area.value;
    const lines = value.split('\n');
    this.highlight.innerHTML = lines
      .map((line) => `<div>${highlightLine(line, this.lang) || ' '}</div>`)
      .join('');
    this.gutter.innerHTML = lines.map((_, i) => `${i + 1}`).join('<br>');
    this.highlight.scrollTop = this.area.scrollTop;
    this.highlight.scrollLeft = this.area.scrollLeft;
    this.onChange(value);
  }

  get value() { return this.area.value; }
  set value(text) { this.area.value = text; this.sync(); }
}

/* ------------------------------------------------------------------- canvas */

/**
 * Sizes a canvas to its container with devicePixelRatio and calls back on
 * resize/DPR change. Returns a controller with `ctx`, `w`, `h`.
 */
export function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const state = {ctx, w: 0, h: 0, dpr: 1};
  let onResize = null;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === state.w && h === state.h && dpr === state.dpr) return;
    state.w = w;
    state.h = h;
    state.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (onResize) onResize(state);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement || canvas);
  resize();
  return {
    state,
    resize,
    onResize(fn) { onResize = fn; },
    disconnect() { observer.disconnect(); },
  };
}

/**
 * RAF loop that pauses when the tab is hidden and can be stopped. The callback
 * receives (dtSeconds, elapsedSeconds).
 */
export function rafLoop(callback) {
  let raf = 0;
  let last = 0;
  let running = true;
  const tick = (now) => {
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    callback(dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      last = 0;
    } else if (running) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function glowDot(ctx, x, y, r, color, alpha = 1, blur = 14) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function bezier(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/* ------------------------------------------------------------------- colour */

/** Value 0..1 → neon ramp (deep blue → cyan → violet → pink). */
export function heatColor(t, alpha = 1) {
  const x = clamp(t, 0, 1);
  const stops = [
    [0, [24, 34, 58]],
    [0.32, [37, 99, 235]],
    [0.55, [94, 234, 212]],
    [0.78, [167, 139, 250]],
    [1, [244, 114, 182]],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (x - a) / (b - a || 1);
      const c = ca.map((v, j) => Math.round(lerp(v, cb[j], k)));
      return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
    }
  }
  return `rgba(244, 114, 182, ${alpha})`;
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ------------------------------------------------------------------ numbers */

export function animateNumber(el, to, {duration = 700, format = fmtInt, from = null} = {}) {
  const startValue = from == null ? Number(el.dataset.value || 0) : from;
  const t0 = performance.now();
  if (prefersReducedMotion()) {
    el.textContent = format(to);
    el.dataset.value = String(to);
    return;
  }
  const step = (now) => {
    const t = clamp((now - t0) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = lerp(startValue, to, eased);
    el.textContent = format(value);
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = format(to);
      el.dataset.value = String(to);
    }
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------- charts */

/** Draws a sparkline into a canvas context; values are auto-scaled. */
export function drawSparkline(ctx, values, w, h, {color = '#5eead4', fill = true, line = 1.6, max = null, min = null} = {}) {
  if (!values.length) return;
  const lo = min == null ? Math.min(...values) : min;
  const hi = max == null ? Math.max(...values) : max;
  const span = hi - lo || 1;
  const px = (i) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const py = (v) => h - 4 - ((v - lo) / span) * (h - 8);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = px(i);
    const y = py(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.stroke();
  if (fill) {
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, `${color}55`);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient;
    ctx.shadowBlur = 0;
    ctx.fill();
  }
  ctx.restore();
}

/* ----------------------------------------------------------------- tooltips */

let tooltipEl = null;

export function showTooltip(html, x, y) {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'k-tooltip';
    tooltipEl.setAttribute('role', 'status');
    document.body.append(tooltipEl);
  }
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
  tooltipEl.classList.add('is-on');
}

export function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove('is-on');
}

/* ------------------------------------------------------------ compiler loader */

/**
 * Fetches compiler.wasm (engine #2) and returns bytes + module metadata.
 * Candidate URLs cover /demos/<page>/ and a build served from the site root.
 */
export async function loadCompilerWasm(relative = '../compiler.wasm') {
  const candidates = [relative, './compiler.wasm', '../compiler.wasm',
    '/latent/demos/compiler.wasm', '/latent/playground/compiler.wasm'];
  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {cache: 'no-cache'});
      if (!res.ok) { lastError = new Error(`${url}: HTTP ${res.status}`); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const module = new WebAssembly.Module(bytes);
      return {
        url,
        bytes,
        module,
        imports: WebAssembly.Module.imports(module),
        exports: WebAssembly.Module.exports(module),
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('compiler.wasm not found');
}

/** sha256 hex of bytes via SubtleCrypto. */
export async function sha256Hex(bytes) {
  if (!window.crypto || !window.crypto.subtle) return '—';
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Formats a hex hash for the UI: first 12…last 8. */
export function shortHash(hash, head = 14, tail = 8) {
  if (!hash || hash.length <= head + tail + 1) return hash || '—';
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/* --------------------------------------------------------------- status text */

export function setStatus(el, text, kind = '') {
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}
