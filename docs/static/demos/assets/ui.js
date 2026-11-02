// ui.js — shared, dependency-free UI helpers for the Latent demo pages.
//
// Everything here is progressive enhancement: if a page doesn't use a helper,
// nothing happens. All animation is rAF-driven, pauses when the document is
// hidden / the element is off-screen, and collapses under
// `prefers-reduced-motion: reduce`.

export const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isCoarsePointer = () =>
  window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ */
/* header: scroll state + mobile nav                                   */
/* ------------------------------------------------------------------ */

export function initHeader() {
  const bar = document.querySelector('.topbar');
  if (bar) {
    const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, {passive: true});
  }

  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('.topnav');
  if (!toggle || !nav) return;
  const close = () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      close();
      toggle.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!nav.classList.contains('open')) return;
    if (nav.contains(event.target) || toggle.contains(event.target)) return;
    close();
  });
}

/* ------------------------------------------------------------------ */
/* scroll reveal                                                       */
/* ------------------------------------------------------------------ */

export function initReveal(root = document) {
  const items = [...root.querySelectorAll('.reveal')];
  if (!items.length) return;

  // Stagger siblings inside grids so groups cascade instead of popping.
  const groups = new Map();
  for (const el of items) {
    const parent = el.parentElement;
    if (!parent) continue;
    const arr = groups.get(parent) || [];
    arr.push(el);
    groups.set(parent, arr);
  }
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.forEach((el, i) => {
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(i));
    });
  }

  if (reduceMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    },
    {rootMargin: '0px 0px -8% 0px', threshold: 0.08},
  );
  items.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ */
/* pointer-tracked card spotlight                                      */
/* ------------------------------------------------------------------ */

export function initSpotlight(root = document) {
  if (isCoarsePointer() || reduceMotion()) return;
  let frame = 0;
  let pending = null;

  const apply = () => {
    frame = 0;
    if (!pending) return;
    const {el, x, y} = pending;
    pending = null;
    const rect = el.getBoundingClientRect();
    const mx = clamp(((x - rect.left) / rect.width) * 100, 0, 100);
    const my = clamp(((y - rect.top) / rect.height) * 100, 0, 100);
    el.style.setProperty('--mx', `${mx.toFixed(2)}%`);
    el.style.setProperty('--my', `${my.toFixed(2)}%`);
  };

  root.addEventListener(
    'pointermove',
    (event) => {
      const el = event.target.closest && event.target.closest('[data-spotlight]');
      if (!el) return;
      pending = {el, x: event.clientX, y: event.clientY};
      if (!frame) frame = requestAnimationFrame(apply);
    },
    {passive: true},
  );
}

/* ------------------------------------------------------------------ */
/* parallax (fine pointers only)                                       */
/* ------------------------------------------------------------------ */

export function initParallax(root = document) {
  const items = [...root.querySelectorAll('[data-parallax]')];
  if (!items.length || isCoarsePointer() || reduceMotion()) return;

  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let running = false;

  const tick = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    for (const el of items) {
      const depth = Number(el.dataset.parallax) || 1;
      el.style.transform = `translate3d(${(cx * depth * 10).toFixed(2)}px, ${(cy * depth * 10).toFixed(2)}px, 0)`;
    }
    if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) {
      requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };

  window.addEventListener(
    'pointermove',
    (event) => {
      tx = (event.clientX / window.innerWidth - 0.5) * 2;
      ty = (event.clientY / window.innerHeight - 0.5) * 2;
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    },
    {passive: true},
  );
}

/* ------------------------------------------------------------------ */
/* count-up numbers                                                    */
/* ------------------------------------------------------------------ */

export function animateNumber(el, to, opts = {}) {
  const {duration = 900, decimals = 0, prefix = '', suffix = '', from = null} = opts;
  const start = from == null ? Number(el.dataset.fromValue || 0) : from;
  const fmt = (v) =>
    `${prefix}${decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('ru-RU')}${suffix}`;

  if (reduceMotion()) {
    el.textContent = fmt(to);
    el.dataset.fromValue = String(to);
    return;
  }

  const t0 = performance.now();
  const step = (now) => {
    const p = clamp((now - t0) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(start + (to - start) * eased);
    if (p < 1) requestAnimationFrame(step);
    else {
      el.textContent = fmt(to);
      el.dataset.fromValue = String(to);
    }
  };
  requestAnimationFrame(step);
}

export function initCountUp(root = document) {
  const items = [...root.querySelectorAll('[data-count]')];
  if (!items.length) return;
  const run = (el) => {
    const to = Number(el.dataset.count);
    if (!Number.isFinite(to)) return;
    animateNumber(el, to, {
      decimals: Number(el.dataset.decimals || 0),
      prefix: el.dataset.prefix || '',
      suffix: el.dataset.suffix || '',
      duration: Number(el.dataset.duration || 1100),
    });
  };
  if (!('IntersectionObserver' in window)) {
    items.forEach(run);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        run(entry.target);
        io.unobserve(entry.target);
      }
    },
    {threshold: 0.4},
  );
  items.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ */
/* tabs                                                                */
/* ------------------------------------------------------------------ */

export function initTabs(root = document) {
  for (const group of root.querySelectorAll('[data-tabs]')) {
    const buttons = [...group.querySelectorAll('[data-tab]')];
    const panels = [...group.querySelectorAll('[data-panel]')];
    if (!buttons.length || !panels.length) continue;

    const select = (value) => {
      for (const b of buttons) {
        const on = b.dataset.tab === value;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      for (const p of panels) {
        const on = p.dataset.panel === value;
        p.hidden = !on;
      }
    };

    for (const btn of buttons) {
      btn.addEventListener('click', () => select(btn.dataset.tab));
      btn.addEventListener('keydown', (event) => {
        const i = buttons.indexOf(btn);
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const dir = event.key === 'ArrowRight' ? 1 : -1;
          const next = buttons[(i + dir + buttons.length) % buttons.length];
          next.focus();
          select(next.dataset.tab);
        }
      });
    }
    select(buttons.find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab || buttons[0].dataset.tab);
  }
}

/* ------------------------------------------------------------------ */
/* range inputs: fill track + output label                             */
/* ------------------------------------------------------------------ */

export function bindRange(input, output, format = String) {
  if (!input) return;
  const paint = () => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const v = Number(input.value);
    const pct = ((v - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${clamp(pct, 0, 100)}%`);
    if (output) output.textContent = format(v);
  };
  input.addEventListener('input', paint);
  paint();
}

/* ------------------------------------------------------------------ */
/* hero particles                                                      */
/* ------------------------------------------------------------------ */

const PARTICLE_COLORS = [
  [94, 234, 212],
  [56, 189, 248],
  [167, 139, 250],
  [125, 211, 252],
  [251, 113, 133],
];

export function initHeroParticles(canvas, opts = {}) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const density = opts.count || 84;
  const linkDistance = opts.link || 118;
  const reduced = reduceMotion();

  let width = 0;
  let height = 0;
  let dpr = 1;
  let points = [];
  let raf = 0;
  let running = false;
  let visible = true;
  let px = 0;
  let py = 0;
  let targetX = 0;
  let targetY = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function seed() {
    const n = Math.round(clamp((width * height) / 14000, 34, density));
    points = [];
    for (let i = 0; i < n; i++) {
      const c = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
      points.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: rand(-0.16, 0.16),
        vy: rand(-0.16, 0.16),
        r: rand(0.7, 2.1),
        c,
        a: rand(0.25, 0.75),
      });
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!points.length) seed();
    else {
      for (const p of points) {
        p.x = clamp(p.x, 0, width);
        p.y = clamp(p.y, 0, height);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Parallax offset follows the pointer with a soft ease.
    px += (targetX - px) * 0.045;
    py += (targetY - py) * 0.045;

    const ox = px * 14;
    const oy = py * 10;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const q = points[j];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > linkDistance * linkDistance) continue;
        const alpha = (1 - Math.sqrt(d2) / linkDistance) * 0.16;
        ctx.strokeStyle = `rgba(110, 210, 220, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x + ox, p.y + oy);
        ctx.lineTo(q.x + ox, q.y + oy);
        ctx.stroke();
      }
    }

    for (const p of points) {
      const r = p.r;
      const x = p.x + ox;
      const y = p.y + oy;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
      glow.addColorStop(0, `rgba(${p.c[0]}, ${p.c[1]}, ${p.c[2]}, ${(p.a * 0.55).toFixed(2)})`);
      glow.addColorStop(1, `rgba(${p.c[0]}, ${p.c[1]}, ${p.c[2]}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${p.c[0]}, ${p.c[1]}, ${p.c[2]}, ${p.a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame() {
    raf = 0;
    if (!running) return;
    for (const p of points) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -8) p.x = width + 8;
      else if (p.x > width + 8) p.x = -8;
      if (p.y < -8) p.y = height + 8;
      else if (p.y > height + 8) p.y = -8;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const ro = new ResizeObserver(() => {
    resize();
    draw();
  });
  ro.observe(canvas);

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible && !document.hidden) start();
        else stop();
      },
      {threshold: 0.02},
    );
    io.observe(canvas);
  }

  const onVisibility = () => (document.hidden ? stop() : visible && start());
  document.addEventListener('visibilitychange', onVisibility);

  if (!reduced) {
    window.addEventListener(
      'pointermove',
      (event) => {
        const rect = canvas.getBoundingClientRect();
        targetX = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
        targetY = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
      },
      {passive: true},
    );
  }

  resize();
  draw();
  if (!reduced) start();

  return () => {
    stop();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/* ------------------------------------------------------------------ */
/* canvas charts                                                       */
/* ------------------------------------------------------------------ */

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return {ctx, w, h};
}

/**
 * Multi-series line chart.
 * series: [{values: number[], color: string, width?: number, fill?: boolean, dash?: number[]}]
 */
export function drawLines(canvas, series, opts = {}) {
  if (!canvas) return;
  const {ctx, w, h} = sizeCanvas(canvas);
  const pad = opts.pad ?? {top: 8, right: 8, bottom: 6, left: 8};
  const iw = Math.max(1, w - pad.left - pad.right);
  const ih = Math.max(1, h - pad.top - pad.bottom);

  let lo = opts.min ?? 0;
  let hi = opts.max;
  if (hi == null) {
    hi = 0;
    for (const s of series) {
      for (const v of s.values) if (Number.isFinite(v)) hi = Math.max(hi, v);
    }
    hi = hi <= 0 ? 1 : hi * 1.12;
  }
  if (hi <= lo) hi = lo + 1;

  const y = (v) => pad.top + ih - ((clamp(v, lo, hi) - lo) / (hi - lo)) * ih;
  const x = (i, n) => pad.left + (n <= 1 ? iw : (i / (n - 1)) * iw);

  // horizontal grid
  if (opts.grid !== false) {
    ctx.strokeStyle = 'rgba(146, 178, 219, 0.09)';
    ctx.lineWidth = 1;
    const rows = opts.gridRows || 4;
    for (let i = 0; i <= rows; i++) {
      const gy = Math.round(pad.top + (ih / rows) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(w - pad.right, gy);
      ctx.stroke();
    }
  }

  const thresholds = [];
  if (opts.threshold != null && Number.isFinite(opts.threshold)) {
    thresholds.push({value: opts.threshold, color: opts.thresholdColor});
  }
  if (Array.isArray(opts.thresholds)) {
    for (const t of opts.thresholds) {
      if (t && Number.isFinite(t.value)) thresholds.push(t);
    }
  }
  for (const t of thresholds) {
    const ty = y(t.value);
    ctx.save();
    ctx.setLineDash(t.dash || [3, 4]);
    ctx.strokeStyle = t.color || 'rgba(251, 191, 36, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, ty);
    ctx.lineTo(w - pad.right, ty);
    ctx.stroke();
    ctx.restore();
  }

  for (const s of series) {
    const n = s.values.length;
    if (!n) continue;
    const color = s.color || '#5eead4';

    if (s.fill) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ih);
      grad.addColorStop(0, s.fill === true ? 'rgba(94, 234, 212, 0.24)' : s.fill);
      grad.addColorStop(1, 'rgba(94, 234, 212, 0)');
      ctx.beginPath();
      ctx.moveTo(x(0, n), y(s.values[0]));
      for (let i = 1; i < n; i++) ctx.lineTo(x(i, n), y(s.values[i]));
      ctx.lineTo(x(n - 1, n), pad.top + ih);
      ctx.lineTo(x(0, n), pad.top + ih);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const gx = x(i, n);
      const gy = y(s.values[i]);
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = s.width || 1.7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.dash) ctx.setLineDash(s.dash);
    ctx.stroke();
    ctx.setLineDash([]);

    if (s.dots !== false) {
      const i = n - 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x(i, n), y(s.values[i]), 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x(i, n), y(s.values[i]), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

/** Backwards-friendly single-series sparkline. */
export function drawSparkline(canvas, values, opts = {}) {
  drawLines(
    canvas,
    [{values, color: opts.color || '#5eead4', fill: opts.fill !== false, width: opts.width || 1.8}],
    opts,
  );
}

/** Vertical bars (histogram). */
export function drawBars(canvas, values, opts = {}) {
  if (!canvas) return;
  const {ctx, w, h} = sizeCanvas(canvas);
  const pad = opts.pad ?? {top: 6, right: 4, bottom: 4, left: 4};
  const iw = Math.max(1, w - pad.left - pad.right);
  const ih = Math.max(1, h - pad.top - pad.bottom);
  let hi = opts.max ?? 0;
  if (!hi) for (const v of values) hi = Math.max(hi, v);
  if (hi <= 0) hi = 1;
  const n = values.length;
  if (!n) return;
  const bw = iw / n;
  const color = opts.color || '#5eead4';
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ih);
  grad.addColorStop(0, color);
  grad.addColorStop(1, opts.fade || 'rgba(56, 189, 248, 0.15)');
  ctx.fillStyle = grad;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v <= 0) continue;
    const bh = Math.max(1, (v / hi) * ih);
    const bx = pad.left + i * bw;
    ctx.fillRect(bx + 0.3, pad.top + ih - bh, Math.max(1, bw - 0.6), bh);
  }
  if (opts.outline) {
    ctx.strokeStyle = opts.outline;
    ctx.lineWidth = 1.2;
    const n2 = values.length;
    ctx.beginPath();
    for (let i = 0; i < n2; i++) {
      const gx = pad.left + (i / Math.max(1, n2 - 1)) * iw;
      const gy = pad.top + ih - (values[i] / hi) * ih;
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    }
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* code rendering                                                      */
/* ------------------------------------------------------------------ */

/**
 * Highlight `source` line by line and wrap each line so CSS counters can
 * number them. `highlight` must return HTML (already escaped).
 */
export function codeLines(source, highlight) {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines
    .map((line) => {
      const html = line.length ? highlight(line) : '&nbsp;';
      return `<span class="cl">${html}</span>`;
    })
    .join('');
}

/** Number of source lines (for the footer meta). */
export function countLines(source) {
  const t = String(source).replace(/\r\n/g, '\n');
  return t.endsWith('\n') ? t.split('\n').length - 1 : t.split('\n').length;
}

export {clamp};
