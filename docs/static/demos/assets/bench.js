// bench.js — JS reference implementations for the five benchmark tasks.
//
// Each function performs the same integer workload as the matching .lat file,
// with buffers prepared once outside the measured region wherever the Latent
// version also caches them. The pages time these functions and the WASM calls
// with the same `performance.now()` harness, then compare checksums.

const MASK = 0x7fffffff;

function lcgStep(s) {
  return (Math.imul(s, 1103515245) + 12345) & MASK;
}

// --- FNV-1a ---------------------------------------------------------------

let hashBuf = null;
let hashN = 0;

function hashPrepare(n) {
  if (hashBuf && hashN === n) return;
  hashBuf = new Uint8Array(n);
  hashN = n;
  let s = 123456789;
  for (let g = 0; g < n; g++) {
    s = lcgStep(s);
    hashBuf[g] = (s >>> 8) & 255;
  }
}

export function hashJS(n, rounds) {
  hashPrepare(n);
  let h = -2128831035; // 0x811c9dc5 as a signed i32 — literals above 2^31-1 wrap
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n; i++) {
      h = Math.imul(h ^ hashBuf[i], 16777619);
    }
  }
  return h | 0;
}

// --- Sieve ----------------------------------------------------------------

let sieveBuf = null;

export function sieveJS(n) {
  if (!sieveBuf || sieveBuf.length !== n + 1) sieveBuf = new Uint8Array(n + 1);
  const a = sieveBuf;
  for (let i = 0; i <= n; i++) a[i] = 1;
  a[0] = 0;
  if (n >= 1) a[1] = 0;
  for (let p = 2; p * p <= n; p++) {
    if (a[p] !== 0) {
      for (let j = p * p; j <= n; j += p) a[j] = 0;
    }
  }
  let count = 0;
  for (let i = 2; i <= n; i++) count += a[i];
  return count;
}

// --- Matrix multiply ------------------------------------------------------

let matA = null;
let matB = null;
let matC = null;
let matN = 0;

function matPrepare(n) {
  if (matA && matN === n) return;
  matN = n;
  const size = n * n;
  matA = new Int32Array(size);
  matB = new Int32Array(size);
  matC = new Int32Array(size);
  let s = 987654321;
  for (let i = 0; i < size; i++) {
    s = lcgStep(s);
    matA[i] = ((s >>> 9) % 97) - 48;
    s = lcgStep(s);
    matB[i] = ((s >>> 9) % 97) - 48;
    matC[i] = 0;
  }
}

export function matmulJS(n) {
  matPrepare(n);
  const a = matA;
  const b = matB;
  const c = matC;
  for (let i = 0; i < n * n; i++) c[i] = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k];
      for (let j = 0; j < n; j++) {
        c[i * n + j] = (c[i * n + j] + aik * b[k * n + j]) | 0;
      }
    }
  }
  let sum = 0;
  for (let i = 0; i < n * n; i++) sum = (sum * 31 + c[i]) & MASK;
  return sum | 0;
}

// --- Quicksort ------------------------------------------------------------

let sortBuf = null;
let sortN = 0;

function partition(a, lo, hi) {
  const pivot = a[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (a[j] < pivot) {
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
      i++;
    }
  }
  const last = a[hi];
  a[hi] = a[i];
  a[i] = last;
  return i;
}

function qsort(a, lo, hi) {
  if (lo >= hi) return;
  const p = partition(a, lo, hi);
  qsort(a, lo, p - 1);
  qsort(a, p + 1, hi);
}

export function sortJS(n) {
  if (!sortBuf || sortN !== n) {
    sortBuf = new Int32Array(n);
    sortN = n;
  }
  const a = sortBuf;
  let s = 42424242;
  for (let i = 0; i < n; i++) {
    s = lcgStep(s);
    a[i] = s;
  }
  qsort(a, 0, n - 1);
  let sum = 0;
  for (let k = 0; k < n; k++) sum = (sum * 33 + a[k]) & MASK;
  return sum | 0;
}

// --- UTF-8 ----------------------------------------------------------------

export const UTF8_TEXT =
  'Привет, Latent! 🚀 — naïve café, 日本語, Ελληνικά. Слава Україні!';

const utf8Bytes = new TextEncoder().encode(UTF8_TEXT);
let utf8Points = 0;
for (let i = 0; i < utf8Bytes.length; i++) {
  if ((utf8Bytes[i] & 192) !== 128) utf8Points++;
}

export function utf8Stats() {
  return {bytes: utf8Bytes.length, points: utf8Points};
}

export function utf8JS(rounds) {
  let acc = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < utf8Bytes.length; i++) {
      acc = (acc * 33 + utf8Bytes[i]) & MASK;
    }
  }
  return acc | 0;
}

/** Median of an array of samples. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
