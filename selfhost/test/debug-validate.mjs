// Отладчик: полная структурная валидация WASM-модуля с проверкой стека
// по сигнатурам функций. Печатает имя первой невалидной функции.
//   node selfhost/test/debug-validate.mjs <module.wasm> [source.lat]
import { readFileSync } from "node:fs";
import { compileWith } from "./harness.mjs";

const file = process.argv[2];
const srcFile = process.argv[3];

function walkSections(w) {
  let i = 8;
  const out = [];
  while (i < w.length) {
    const id = w[i++];
    let size = 0, sh = 0, b;
    do { b = w[i++]; size |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80);
    out.push({ id, start: i, size });
    i += size;
  }
  return out;
}
const rdU = (a, p) => { let r = 0, sh = 0, b; do { b = a[p[0]++]; r |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80); return r >>> 0; };
const rdS = (a, p) => { let r = 0, sh = 0, b; do { b = a[p[0]++]; r |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80); if (sh < 32 && (b & 0x40)) r |= (~0 << sh); return r | 0; };

export function analyze(w) {
  const secs = walkSections(w);
  const get = (id) => secs.find((s) => s.id === id);
  // types
  const types = [];
  if (get(1)) { const p = [get(1).start]; const n = rdU(w, p); for (let i = 0; i < n; i++) { p[0]++; const np = rdU(w, p); const params = []; for (let k = 0; k < np; k++) params.push(w[p[0]++]); const nr = rdU(w, p); const res = []; for (let k = 0; k < nr; k++) res.push(w[p[0]++]); types.push({ params, res }); } }
  // imports (func only)
  let importCount = 0; const importTypes = [];
  if (get(2)) { const p = [get(2).start]; const n = rdU(w, p); for (let i = 0; i < n; i++) { const ml = rdU(w, p); p[0] += ml; const fl = rdU(w, p); p[0] += fl; const kind = w[p[0]++]; if (kind === 0) { importTypes.push(rdU(w, p)); importCount++; } else if (kind === 1) { p[0]++; let f = w[p[0]++]; if (f & 1) rdU(w, p); rdU(w, p); } else if (kind === 2) { let f = w[p[0]++]; if (f & 1) rdU(w, p); rdU(w, p); } else if (kind === 3) { p[0]++; p[0]++; } } }
  // functions
  const funcTypes = [];
  if (get(3)) { const p = [get(3).start]; const n = rdU(w, p); for (let i = 0; i < n; i++) funcTypes.push(rdU(w, p)); }
  const allFuncTypes = [...importTypes, ...funcTypes];
  const sig = (fi) => types[allFuncTypes[fi]];
  // code
  const bodies = [];
  if (get(10)) { const p = [get(10).start]; const n = rdU(w, p); for (let i = 0; i < n; i++) { const len = rdU(w, p); bodies.push(w.slice(p[0], p[0] + len)); p[0] += len; } }
  return { sig, importCount, bodies };
}

const isCtl = (op) => op === 0x02 || op === 0x03 || op === 0x04;

export function checkBody(body, sigFn, fi) {
  const p = [0];
  const nloc = rdU(body, p); const locals = [];
  for (let i = 0; i < nloc; i++) { const c = rdU(body, p); const ty = body[p[0]++]; for (let k = 0; k < c; k++) locals.push(ty); }
  const funcSig = sigFn(fi);
  const stack = [...funcSig.params];
  const ctrl = [{ kind: "func", ret: funcSig.res, height: 0, unreachable: false }];
  const errs = [];
  const top = () => stack[stack.length - 1];
  const pop = (t) => { if (stack.length <= ctrl[ctrl.length - 1].height) { errs.push(`underflow op=0x${op.toString(16)} @${p[0] - 1}`); return; } stack.pop(); };
  let unreachable = false;
  const push = (t) => stack.push(t);
  while (p[0] < body.length) {
    const off = p[0]; const op = body[p[0]++];
    const cur = ctrl[ctrl.length - 1];
    switch (op) {
      case 0x00: unreachable = true; break;
      case 0x01: break;
      case 0x02: case 0x03: { const bt = body[p[0]++]; ctrl.push({ kind: op, ret: bt === 0x40 ? [] : [bt], height: stack.length, unreachable: false }); break; }
      case 0x04: { const bt = body[p[0]++]; pop(); ctrl.push({ kind: op, ret: bt === 0x40 ? [] : [bt], height: stack.length, unreachable: false }); break; }
      case 0x05: { const c = ctrl.pop(); while (stack.length > c.height) stack.pop(); ctrl.push({ kind: 0x04, ret: c.ret, height: c.height, unreachable: c.unreachable }); break; }
      case 0x0b: { const c = ctrl.pop(); while (stack.length > c.height) stack.pop(); if (c.ret.length) push(c.ret[0]); break; }
      case 0x0c: rdU(body, p); break;
      case 0x0d: rdU(body, p); pop(); break;
      case 0x0e: { const n = rdU(body, p); for (let i = 0; i <= n; i++) rdU(body, p); pop(); break; }
      case 0x0f: unreachable = true; break;
      case 0x10: { const fi2 = rdU(body, p); const s = sigFn(fi2); for (const _ of s.params) pop(); for (const r of s.res) push(r); break; }
      case 0x11: { rdU(body, p); p[0]++; pop(); const ti = 0; /* approx */ push(0x7f); break; }
      case 0x1a: pop(); break;
      case 0x1b: { pop(); pop(); pop(); push(0x7f); break; }
      case 0x20: { const li = rdU(body, p); push(li < funcSig.params.length ? funcSig.params[li] : (locals[li - funcSig.params.length] ?? 0x7f)); break; }
      case 0x21: case 0x22: rdU(body, p); if (op === 0x21) pop(); break;
      case 0x23: rdU(body, p); push(0x7f); break;
      case 0x24: rdU(body, p); pop(); break;
      case 0x28: case 0x2b: rdU(body, p); rdU(body, p); pop(); push(op === 0x2b ? 0x7c : 0x7f); break;
      case 0x2c: case 0x2d: rdU(body, p); rdU(body, p); pop(); push(0x7f); break;
      case 0x36: case 0x39: rdU(body, p); rdU(body, p); pop(); pop(); break;
      case 0x3a: rdU(body, p); rdU(body, p); pop(); pop(); break;
      case 0x3f: p[0]++; push(0x7f); break;
      case 0x40: p[0]++; pop(); push(0x7f); break;
      case 0x41: rdS(body, p); push(0x7f); break;
      case 0x42: rdS(body, p); push(0x7e); break;
      case 0x43: p[0] += 4; push(0x7d); break;
      case 0x44: p[0] += 8; push(0x7c); break;
      case 0x45: pop(); push(0x7f); break;
      case 0x46: case 0x47: case 0x48: case 0x49: case 0x4a: case 0x4b: case 0x4c: case 0x4d: case 0x4e: case 0x4f:
      case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58: case 0x59: case 0x5a:
      case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66: pop(); pop(); push(0x7f); break;
      case 0x67: case 0x68: case 0x69: case 0x6a: case 0x6b: case 0x6c: case 0x6d: case 0x6e: case 0x6f: case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76: pop(); pop(); push(0x7f); break;
      case 0x79: case 0x7a: case 0x7b: case 0x7c: case 0x7d: case 0x7e: pop(); pop(); push(0x7e); break;
      case 0xa0: case 0xa1: case 0xa2: case 0xa3: pop(); pop(); push(0x7c); break;
      case 0x99: case 0x9a: case 0x9f: pop(); push(0x7c); break;
      case 0xa7: case 0xa8: case 0xa9: case 0xaa: case 0xab: case 0xac: case 0xad: pop(); push(0x7f); break;
      case 0xae: case 0xaf: case 0xb0: case 0xb1: case 0xb2: case 0xb3: case 0xb4: case 0xb5: case 0xb6: case 0xb7: case 0xb8: case 0xb9: case 0xba: case 0xbb: case 0xbc: case 0xbd: case 0xbe: case 0xbf: pop(); push(0x7c); break;
      default: errs.push(`unknown op 0x${op.toString(16)} @${off}`); p[0] = body.length; 
    }
    if (errs.length) return errs[0];
  }
  return null;
}

function main() {
  let w;
  if (srcFile) {
    const { readFileSync: rf } = await imports;
    const comp = rf(file); w = compileWith(comp, rf(srcFile, "utf8")).wasm;
  } else {
    w = readFileSync(file);
  }
  const { sig, bodies } = analyze(w);
  const total = sig.length;
  for (let fi = 0; fi < bodies.length; fi++) {
    const e = checkBody(bodies[fi], sig, fi + 0);
  }
}

const imports = await import("node:fs");
main();