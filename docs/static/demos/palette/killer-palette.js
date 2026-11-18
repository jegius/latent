// killer-palette.js — Palette Studio, a working frontend utility built on a
// Latent→WASM core. The app extracts a palette from an image, lets the user
// edit colours, checks contrast and exports design tokens. The JS twin is here
// for an honest same-workload benchmark, not as the production path.

import {
  $, $$, esc, fmtInt, fmtBytes, fmtMs, initEmbed, initNav,
  setupCanvas, copyText,
} from '../assets/killer.js';

initEmbed();
initNav();

const INPUT_ADDR = 1048576;
const OUTPUT_ADDR = 2097152;
const MAX_SIDE = 480;

const SAMPLES = [
  {id: 'product', name: 'Product UI', dot: 'linear-gradient(135deg,#f7f8fb,#7c3aed 60%,#5eead4)'},
  {id: 'aurora', name: 'Aurora', dot: 'linear-gradient(135deg,#5eead4,#a78bfa 55%,#f472b6)'},
  {id: 'sunset', name: 'Sunset', dot: 'linear-gradient(135deg,#1d1b4b,#f26d5b 60%,#ffc371)'},
  {id: 'mono', name: 'Mono', dot: 'linear-gradient(135deg,#0b0d12,#6b7280 55%,#f9fafb)'},
];

const state = {
  module: null,
  wasmBytes: 0,
  work: null,
  workCtx: null,
  pixels: null,
  width: 0,
  height: 0,
  imageName: 'Product UI',
  colors: [],
  selected: 0,
  sort: 'share',
  running: false,
  lastExtractMs: 0,
  bench: null,
  toastTimer: 0,
};

/* ------------------------------------------------------------------- colour */

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(c) {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function hexOf(c) {
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function rgbOf(c) {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function readableOn(c) {
  return contrast(c, {r: 255, g: 255, b: 255}) >= contrast(c, {r: 0, g: 0, b: 0})
    ? '#ffffff'
    : '#071018';
}

function wcagBadge(ratio) {
  if (ratio >= 7) return {label: 'AAA', ok: true};
  if (ratio >= 4.5) return {label: 'AA', ok: true};
  if (ratio >= 3) return {label: 'AA Large', ok: false};
  return {label: 'fail', ok: false};
}

/* ------------------------------------------------------------------- images */

function makeWorkCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  state.work = canvas;
  state.workCtx = canvas.getContext('2d', {willReadFrequently: true});
}

function fitSize(w, h, max) {
  const scale = Math.min(1, max / Math.max(w, h));
  return {w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale))};
}

function drawSample(id) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 440;
  const ctx = canvas.getContext('2d');
  if (id === 'aurora') {
    ctx.fillStyle = '#060810';
    ctx.fillRect(0, 0, 720, 440);
    const blobs = [
      [120, 120, 230, '#5eead4'], [580, 90, 260, '#a78bfa'], [360, 330, 300, '#f472b6'],
      [650, 360, 190, '#60a5fa'], [200, 390, 180, '#34d399'],
    ];
    for (const [x, y, r, color] of blobs) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `${color}cc`);
      g.addColorStop(0.55, `${color}55`);
      g.addColorStop(1, `${color}00`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 720, 440);
    }
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (let x = 0; x < 720; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 440); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (id === 'sunset') {
    const g = ctx.createLinearGradient(0, 0, 0, 440);
    g.addColorStop(0, '#1d1b4b');
    g.addColorStop(0.45, '#8b3f8f');
    g.addColorStop(0.72, '#f26d5b');
    g.addColorStop(1, '#ffc371');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 720, 440);
    const sun = ctx.createRadialGradient(520, 170, 10, 520, 170, 130);
    sun.addColorStop(0, '#fff4c2');
    sun.addColorStop(0.5, '#ffd36b');
    sun.addColorStop(1, '#ff8a4c00');
    ctx.fillStyle = sun;
    ctx.fillRect(380, 20, 320, 320);
    ctx.fillStyle = 'rgba(20, 12, 40, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, 360); ctx.lineTo(180, 250); ctx.lineTo(330, 350); ctx.lineTo(520, 270);
    ctx.lineTo(720, 360); ctx.lineTo(720, 440); ctx.lineTo(0, 440); ctx.closePath(); ctx.fill();
  } else if (id === 'mono') {
    const g = ctx.createLinearGradient(0, 0, 720, 440);
    g.addColorStop(0, '#0b0d12');
    g.addColorStop(0.5, '#6b7280');
    g.addColorStop(1, '#f9fafb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 720, 440);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '700 64px ui-monospace, monospace';
    ctx.fillText('Aa', 70, 210);
    ctx.fillStyle = 'rgba(10,12,18,0.82)';
    ctx.font = '400 18px ui-monospace, monospace';
    ctx.fillText('typography is a palette too', 70, 260);
    ctx.fillStyle = 'rgba(94,234,212,0.9)';
    ctx.fillRect(70, 300, 260, 6);
  } else {
    ctx.fillStyle = '#f5f7fb';
    ctx.fillRect(0, 0, 720, 440);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(20, 32, 54, 0.16)';
    ctx.shadowBlur = 30;
    ctx.fillRect(60, 70, 380, 300);
    ctx.fillRect(470, 70, 190, 140);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#111827';
    ctx.font = '700 30px system-ui';
    ctx.fillText('Analytics', 92, 120);
    ctx.fillStyle = '#6b7280';
    ctx.font = '15px system-ui';
    ctx.fillText('Weekly revenue', 92, 150);
    ctx.fillStyle = '#5eead4';
    ctx.fillRect(92, 180, 200, 12);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(92, 202, 140, 12);
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(92, 270, 120, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px system-ui';
    ctx.fillText('Open report', 108, 298);
    ['#5eead4', '#a78bfa', '#f472b6', '#60a5fa', '#34d399'].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(500 + i * 28, 190 - i * 14, 18, 40 + i * 14);
    });
  }
  return canvas;
}

function adoptCanvas(source, name) {
  const fit = fitSize(source.width, source.height, MAX_SIDE);
  makeWorkCanvas(fit.w, fit.h);
  state.workCtx.drawImage(source, 0, 0, fit.w, fit.h);
  state.width = fit.w;
  state.height = fit.h;
  state.imageName = name;
  state.pixels = state.workCtx.getImageData(0, 0, fit.w, fit.h).data;
  drawPreview();
  setText('#image-name', name);
  setText('#image-size', `${fit.w} × ${fit.h}`);
}

let previewCtrl = null;

function drawPreview() {
  if (!state.work) return;
  if (!previewCtrl) previewCtrl = setupCanvas($('#preview'));
  previewCtrl.resize();
  const {ctx, w, h} = previewCtrl.state;
  if (w < 10 || h < 10) return;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#070b12');
  bg.addColorStop(1, '#0b1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const scale = Math.min(w / state.width, h / state.height);
  const dw = state.width * scale;
  const dh = state.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.work, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/* ------------------------------------------------------------------- module */

async function loadModule() {
  const response = await fetch('./palette.wasm', {cache: 'no-cache'});
  if (!response.ok) {
    throw new Error(`palette.wasm: HTTP ${response.status} — запустите node docs/static/demos/build-demos.mjs`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  state.wasmBytes = bytes.length;
  const {instance} = await WebAssembly.instantiate(bytes, {env: {print() {}}});
  state.module = instance.exports;
  setText('#m-wasm', fmtBytes(bytes.length));
  setText('#wasm-badge', `palette.wasm · ${fmtBytes(bytes.length)}`);
}

function ensureMemory(extra) {
  const memory = state.module.memory;
  const need = Math.ceil((extra + 8) / 65536);
  const have = memory.buffer.byteLength / 65536;
  if (need > have) memory.grow(need - have);
}

function runWasm(maxColors, writePixels = true) {
  ensureMemory(OUTPUT_ADDR + 256);
  if (writePixels) new Uint8Array(state.module.memory.buffer).set(state.pixels, INPUT_ADDR);
  const t0 = performance.now();
  state.module.main(INPUT_ADDR, state.width, state.height, OUTPUT_ADDR, maxColors);
  const ms = performance.now() - t0;
  const view = new DataView(state.module.memory.buffer);
  const opaque = view.getUint32(OUTPUT_ADDR, true);
  const count = Math.min(view.getUint32(OUTPUT_ADDR + 4, true), maxColors, 16);
  const colors = [];
  for (let i = 0; i < count; i += 1) {
    const argb = view.getUint32(OUTPUT_ADDR + 8 + i * 8, true) >>> 0;
    const n = view.getUint32(OUTPUT_ADDR + 12 + i * 8, true);
    colors.push({
      r: (argb >>> 16) & 255,
      g: (argb >>> 8) & 255,
      b: argb & 255,
      count: n,
      share: n / (opaque || 1),
    });
  }
  return {colors, opaque, ms, count};
}

/* JS twin: same 512 bins, typed arrays, same rounding. Used for the benchmark. */
function paletteJS(data, maxColors) {
  const bins = new Uint32Array(512);
  const rs = new Uint32Array(512);
  const gs = new Uint32Array(512);
  const bs = new Uint32Array(512);
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const bin = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    bins[bin] += 1;
    rs[bin] += r;
    gs[bin] += g;
    bs[bin] += b;
    opaque += 1;
  }
  const candidates = [];
  for (let i = 0; i < 512; i += 1) {
    if (bins[i] > 0) candidates.push(i);
  }
  const colors = [];
  for (let picked = 0; picked < Math.min(maxColors, 16); picked += 1) {
    let best = -1;
    let bestCount = 0;
    for (const bin of candidates) {
      if (bins[bin] > bestCount) {
        bestCount = bins[bin];
        best = bin;
      }
    }
    if (best < 0) break;
    colors.push({
      r: Math.floor(rs[best] / bestCount),
      g: Math.floor(gs[best] / bestCount),
      b: Math.floor(bs[best] / bestCount),
      count: bestCount,
      share: bestCount / (opaque || 1),
    });
    bins[best] = 0;
  }
  return {colors, opaque};
}

/* ------------------------------------------------------------------ extract */

function extract({quiet = false} = {}) {
  if (!state.module || !state.pixels || state.running) return;
  state.running = true;
  $('#extract').disabled = true;
  const maxColors = Number($('#max-colors').value);
  try {
    const result = runWasm(maxColors);
    if (!result.opaque || !result.colors.length) throw new Error('на изображении нет непрозрачных пикселей');
    state.colors = result.colors;
    state.selected = 0;
    state.lastExtractMs = result.ms;
    setText('#m-pixels', fmtInt(state.width * state.height));
    setText('#m-opaque', fmtInt(result.opaque));
    setText('#m-colors', fmtInt(result.colors.length));
    setText('#m-time', fmtMs(result.ms));
    setText('#m-ratio', `${Math.round((result.opaque / (state.width * state.height || 1)) * 100)}%`);
    renderPalette();
    renderPreview();
    renderExport();
    setText('#status', quiet ? 'палитра обновлена' : 'палитра готова · изображение не покидало браузер');
    if (!quiet) toast('Палитра пересчитана в WASM');
    document.documentElement.dataset.killerReady = '1';
  } catch (error) {
    setText('#status', `ошибка: ${error.message}`);
    toast(error.message, true);
  } finally {
    state.running = false;
    $('#extract').disabled = false;
  }
}

/* ------------------------------------------------------------------- render */

function sortedColors() {
  const colors = [...state.colors];
  if (state.sort === 'luminance') colors.sort((a, b) => luminance(b) - luminance(a));
  else colors.sort((a, b) => b.count - a.count);
  return colors;
}

function renderPalette() {
  const host = $('#palette');
  const colors = sortedColors();
  host.innerHTML = colors.map((color, index) => {
    const hex = hexOf(color);
    const ratio = Math.max(contrast(color, {r: 255, g: 255, b: 255}), contrast(color, {r: 0, g: 0, b: 0}));
    const badge = wcagBadge(ratio);
    return `<div class="app-color${index === state.selected ? ' is-active' : ''}" data-color="${index}" tabindex="0" role="button" aria-label="Цвет ${hex}">
      <input type="color" value="${hex}" data-color-input="${index}" aria-label="Изменить ${hex}" />
      <div class="app-color-main">
        <div class="app-color-hex">${hex}</div>
        <div class="app-color-sub">${rgbOf(color)} · ${(color.share * 100).toFixed(1)}% пикселей</div>
        <div class="app-color-bar" style="color:${hex}"><i style="width:${Math.max(2, color.share * 100)}%"></i></div>
      </div>
      <div class="app-color-side"><b>${ratio.toFixed(1)}:1</b><span class="${badge.ok ? 'ok' : ''}">${badge.label}</span></div>
    </div>`;
  }).join('');

  $$('[data-color]', host).forEach((row, index) => {
    const select = () => {
      state.selected = index;
      renderPalette();
      renderPreview();
      renderContrast();
    };
    row.addEventListener('click', (event) => {
      if (event.target.matches('input[type="color"]')) return;
      select();
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    });
  });
  $$('[data-color-input]', host).forEach((input, index) => {
    input.addEventListener('input', () => {
      state.colors[index] = {...hexToRgb(input.value), count: state.colors[index]?.count || 0, share: state.colors[index]?.share || 0};
      state.selected = index;
      renderPreview();
      renderContrast();
      renderExport();
      const row = input.closest('.app-color');
      row.querySelector('.app-color-hex').textContent = input.value;
      row.querySelector('.app-color-sub').textContent = `${rgbOf(state.colors[index])} · ${((state.colors[index].share || 0) * 100).toFixed(1)}% пикселей`;
    });
    input.addEventListener('change', () => {
      state.colors = sortedColors();
      state.selected = 0;
      renderPalette();
      renderContrast();
      renderExport();
    });
  });
  renderContrast();
}

function renderPreview() {
  const color = state.colors[state.selected] || state.colors[0];
  if (!color) return;
  const hex = hexOf(color);
  const fg = readableOn(color);
  const host = $('#accent-preview');
  host.style.setProperty('--accent', hex);
  host.style.setProperty('--accent-fg', fg);
  host.innerHTML = `
    <div class="app-preview-body">
      <div>
        <div class="app-preview-kicker">selected accent</div>
        <div class="app-preview-title">Ship the palette,<br />not the screenshot.</div>
        <p class="app-preview-text">Кнопка и график используют <b>${hex}</b>. Скопируйте CSS-переменные или поправьте свотч слева.</p>
        <div class="app-preview-actions">
          <button class="app-preview-btn" type="button" style="background:var(--accent);color:var(--accent-fg)">Применить</button>
          <button class="app-preview-btn app-preview-ghost" type="button">CSS variables</button>
        </div>
      </div>
      <div class="app-chart">
        ${[38, 62, 48, 84, 56].map((h, i) => `<i style="height:${h}%;background:${i === 3 ? 'var(--accent)' : 'rgba(148,178,255,.22)'}"></i>`).join('')}
      </div>
    </div>`;
  setText('#accent-label', `${hex} · ${state.imageName}`);
}

function renderContrast() {
  const color = state.colors[state.selected] || state.colors[0];
  if (!color) return;
  const white = contrast(color, {r: 255, g: 255, b: 255});
  const black = contrast(color, {r: 0, g: 0, b: 0});
  const best = Math.max(white, black);
  const badge = wcagBadge(best);
  const aa = state.colors.filter((c) => Math.max(
    contrast(c, {r: 255, g: 255, b: 255}),
    contrast(c, {r: 0, g: 0, b: 0}),
  ) >= 4.5).length;
  const aaa = state.colors.filter((c) => Math.max(
    contrast(c, {r: 255, g: 255, b: 255}),
    contrast(c, {r: 0, g: 0, b: 0}),
  ) >= 7).length;
  setText('#c-white', `${white.toFixed(2)}:1`);
  setText('#c-black', `${black.toFixed(2)}:1`);
  setText('#selected-hex', hexOf(color));
  setText('#selected-badge', `${badge.label} · ${best.toFixed(1)}`);
  setText('#aa-count', `${aa}/${state.colors.length}`);
  setText('#aaa-count', `${aaa}/${state.colors.length}`);
  setText('#accent-label', `${hexOf(color)} · ${state.imageName}`);
}

function cssExport() {
  return `:root {\n${sortedColors().map((color, i) => `  --color-${i + 1}: ${hexOf(color)};`).join('\n')}\n}`;
}

function jsonExport() {
  return JSON.stringify(sortedColors().map((color) => ({
    hex: hexOf(color),
    rgb: [Math.round(color.r), Math.round(color.g), Math.round(color.b)],
    share: Number(color.share.toFixed(4)),
  })), null, 2);
}

function renderExport() {
  $('#export-css').dataset.payload = cssExport();
  $('#export-json').dataset.payload = jsonExport();
  setText('#export-hint', `${state.colors.length} цветов · CSS`);
}

/* -------------------------------------------------------------------- export */

function downloadPalettePng() {
  const colors = sortedColors();
  if (!colors.length) return;
  const width = 1200;
  const height = 300;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, width, height);
  const step = width / colors.length;
  colors.forEach((color, i) => {
    const hex = hexOf(color);
    ctx.fillStyle = hex;
    ctx.fillRect(i * step, 0, step, 220);
    ctx.fillStyle = readableOn(color);
    ctx.font = '600 15px ui-monospace, monospace';
    ctx.fillText(hex, i * step + 14, 190);
    ctx.fillStyle = '#9aa9c7';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${(color.share * 100).toFixed(1)}%`, i * step + 14, 208);
  });
  const link = document.createElement('a');
  link.download = 'palette.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('palette.png сохранён');
}

function downloadCss() {
  if (!state.colors.length) return;
  const blob = new Blob([`${cssExport()}\n`], {type: 'text/css;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'tokens.css';
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('tokens.css сохранён');
}

async function copyPayload(selector) {
  const payload = $(selector).dataset.payload || '';
  const ok = await copyText(payload);
  toast(ok ? 'Скопировано в буфер' : 'Не удалось скопировать', !ok);
}

/* ----------------------------------------------------------------- benchmark */

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function benchmark() {
  if (!state.module || !state.pixels) return;
  const maxColors = Number($('#max-colors').value);
  $('#bench').disabled = true;
  setText('#bench-speed', 'меряем…');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    ensureMemory(OUTPUT_ADDR + 256);
    new Uint8Array(state.module.memory.buffer).set(state.pixels, INPUT_ADDR);
    for (let i = 0; i < 2; i += 1) { runWasm(maxColors, false); paletteJS(state.pixels, maxColors); }
    const wasmTimes = [];
    const jsTimes = [];
    let wasmResult = null;
    let jsResult = null;
    const REPEAT = 5;
    for (let i = 0; i < 9; i += 1) {
      const t0 = performance.now();
      for (let r = 0; r < REPEAT; r += 1) wasmResult = runWasm(maxColors, false);
      wasmTimes.push((performance.now() - t0) / REPEAT);
      const t1 = performance.now();
      for (let r = 0; r < REPEAT; r += 1) jsResult = paletteJS(state.pixels, maxColors);
      jsTimes.push((performance.now() - t1) / REPEAT);
    }
    const wasmMs = median(wasmTimes);
    const jsMs = median(jsTimes);
    const speedup = jsMs / wasmMs;
    const wasmHex = wasmResult.colors.map((c) => hexOf(c)).sort().join(',');
    const jsHex = jsResult.colors.map((c) => hexOf(c)).sort().join(',');
    state.bench = {wasmMs, jsMs, speedup, match: wasmHex === jsHex};
    setText('#bench-wasm', fmtMs(wasmMs));
    setText('#bench-js', fmtMs(jsMs));
    setText('#bench-match', wasmHex === jsHex ? 'полное' : 'частичное');
    setText('#bench-speed', `${speedup >= 1 ? 'Latent' : 'JS'} быстрее в ${(speedup >= 1 ? speedup : 1 / speedup).toFixed(2)}×`);
  } catch (error) {
    setText('#bench-speed', `ошибка: ${error.message}`);
  } finally {
    $('#bench').disabled = false;
  }
}

/* -------------------------------------------------------------------- misc */

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

function toast(message, danger = false) {
  const el = $('#toast');
  el.textContent = message;
  el.style.borderColor = danger ? 'rgba(251,113,133,.5)' : '';
  el.classList.add('is-on');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800);
}

function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const base = document.createElement('canvas');
    base.width = image.naturalWidth;
    base.height = image.naturalHeight;
    base.getContext('2d').drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    adoptCanvas(base, file.name);
    extract();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    toast('Не удалось прочитать изображение', true);
  };
  image.src = url;
}

async function boot() {
  $('#samples').innerHTML = SAMPLES.map((sample, index) =>
    `<button class="app-sample${index === 0 ? ' is-active' : ''}" type="button" data-sample="${sample.id}"><i style="background:${sample.dot}"></i>${esc(sample.name)}</button>`).join('');
  $$('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-sample]').forEach((b) => b.classList.toggle('is-active', b === button));
      adoptCanvas(drawSample(button.dataset.sample), button.textContent.trim());
      extract();
    });
  });

  $('#max-colors').addEventListener('input', () => setText('#max-label', $('#max-colors').value));
  $('#max-colors').addEventListener('change', () => extract());
  $('#extract').addEventListener('click', () => extract());
  $('#bench').addEventListener('click', benchmark);
  $('#export-css').addEventListener('click', () => copyPayload('#export-css'));
  $('#export-json').addEventListener('click', () => copyPayload('#export-json'));
  $('#export-css-file').addEventListener('click', downloadCss);
  $('#export-png').addEventListener('click', downloadPalettePng);
  $('#sort-share').addEventListener('click', () => {
    state.sort = 'share';
    state.colors = sortedColors();
    state.selected = 0;
    renderPalette();
    renderPreview();
    renderExport();
  });
  $('#sort-lum').addEventListener('click', () => {
    state.sort = 'luminance';
    state.colors = sortedColors();
    state.selected = 0;
    renderPalette();
    renderPreview();
    renderExport();
  });
  $('#file').addEventListener('change', (event) => loadFile(event.target.files && event.target.files[0]));
  $('#drop').addEventListener('dragover', (event) => { event.preventDefault(); $('#drop').classList.add('is-over'); });
  $('#drop').addEventListener('dragleave', () => $('#drop').classList.remove('is-over'));
  $('#drop').addEventListener('drop', (event) => {
    event.preventDefault();
    $('#drop').classList.remove('is-over');
    loadFile(event.dataTransfer.files && event.dataTransfer.files[0]);
  });
  window.addEventListener('resize', drawPreview);

  try {
    await loadModule();
    $('#extract').disabled = false;
    adoptCanvas(drawSample('product'), 'Product UI');
    extract({quiet: true});
    setTimeout(() => benchmark(), 200);
  } catch (error) {
    setText('#status', error.message);
    setText('#wasm-badge', 'palette.wasm не найден');
    toast(error.message, true);
  }
}

window.__killerPalette = {
  extract,
  benchmark,
  sample: (id) => {
    const sample = SAMPLES.find((s) => s.id === id) || SAMPLES[0];
    adoptCanvas(drawSample(sample.id), sample.name);
    extract();
  },
  state: () => ({
    ready: Boolean(state.module),
    image: state.imageName,
    width: state.width,
    height: state.height,
    colors: state.colors.map((color) => ({...color, hex: hexOf(color)})),
    ms: state.lastExtractMs,
    wasmBytes: state.wasmBytes,
    bench: state.bench,
  }),
};

boot();
