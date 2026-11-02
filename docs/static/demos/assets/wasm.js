// wasm.js — tiny browser host used by every Latent demo.
//
// No dependencies, no bundler. Modules are fetched as bytes and instantiated
// with the single import the Latent ABI requires: env.print(ptr), where the
// pointer references [len u32 LE][utf8 bytes] in linear memory.

/** Fetch the first URL that responds with a 2xx and return its bytes. */
export async function fetchFirst(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {cache: 'no-cache'});
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      return {url, bytes: new Uint8Array(await res.arrayBuffer())};
    } catch (err) {
      errors.push(`${url}: ${err.message || err}`);
    }
  }
  throw new Error(`could not fetch any of:\n${errors.join('\n')}`);
}

/** Read a Latent string at `ptr` from a WebAssembly.Memory. */
export function readString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

/**
 * Instantiate a Latent program module.
 * `onPrint` receives decoded strings; the import always exists in the ABI.
 */
export async function instantiateLatent(bytes, onPrint) {
  let instance;
  const imports = {
    env: {
      print(ptr) {
        if (onPrint) {
          try {
            onPrint(readString(instance.exports.memory, ptr));
          } catch {
            /* the module may call print with a non-string in hand-written code */
          }
        }
      },
    },
  };
  const result = await WebAssembly.instantiate(bytes, imports);
  instance = result.instance;
  return instance;
}

/**
 * Candidate URLs for compiler.wasm, ordered from "next to the demos" to the
 * deployed Docusaurus playground. Works both at /latent/demos/... and when the
 * docs build is served from the site root.
 */
export function compilerCandidates() {
  const here = location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.replace(/[^/]+$/, '');
  const demosRoot = here.includes('/demos/')
    ? here.slice(0, here.indexOf('/demos/') + '/demos/'.length)
    : here;
  return [
    `${demosRoot}compiler.wasm`,
    `${demosRoot}../playground/compiler.wasm`,
    '/latent/playground/compiler.wasm',
    '/playground/compiler.wasm',
    '../../playground/compiler.wasm',
    '../playground/compiler.wasm',
  ];
}

/**
 * Compiler-as-WASM client: implements latent_alloc / latent_compile /
 * latent_free and returns {wasm, compileMs, version}.
 */
export class LatentCompiler {
  constructor(instance) {
    this.ex = instance.exports;
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.version = '';
    if (typeof this.ex.latent_version === 'function') {
      const ptr = this.ex.latent_version();
      const dv = new DataView(this.ex.memory.buffer);
      const len = dv.getUint32(ptr, true);
      this.version = this.decoder.decode(
        new Uint8Array(this.ex.memory.buffer, ptr + 4, len),
      );
    }
  }

  compile(source) {
    const ex = this.ex;
    const src = this.encoder.encode(source);
    const ptr = ex.latent_alloc(Math.max(src.length, 1));
    new Uint8Array(ex.memory.buffer).set(src, ptr);
    const t0 = performance.now();
    const res = ex.latent_compile(ptr, src.length);
    const compileMs = performance.now() - t0;
    const dv = new DataView(ex.memory.buffer);
    const status = dv.getUint32(res, true);
    const len = dv.getUint32(res + 4, true);
    const payload = new Uint8Array(ex.memory.buffer, res + 8, len).slice();
    try {
      ex.latent_free(ptr, Math.max(src.length, 1));
    } catch {
      /* optional */
    }
    try {
      ex.latent_free(res, 8 + len);
    } catch {
      /* optional */
    }
    if (status !== 1) {
      throw new Error(this.decoder.decode(payload));
    }
    return {wasm: payload, compileMs};
  }
}

export async function loadCompiler() {
  const {bytes, url} = await fetchFirst(compilerCandidates());
  const instance = await instantiateLatent(bytes);
  return {compiler: new LatentCompiler(instance), url, bytes};
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 100) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(1)} ms`;
}

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function p95(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ask the browser for a repaint before a long synchronous measurement. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
