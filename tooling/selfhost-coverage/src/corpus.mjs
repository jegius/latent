// Корпус программ для прогона через инструментированный компилятор.
//
// Состав:
//   1. все кейсы из selfhost/test/*.test.mjs (template literal после `src:`);
//   2. сам shc.lat (самый полный вход: компилятор компилирует себя);
//   3. примеры web-ide/examples/*.lat (если есть) — реальные программы;
//   4. детерминированные «фаззинг-подобные» программы (LCG, без Math.random);
//   5. ручные пробы на ветки ошибок/редкие конструкции.
//
// Ошибочные программы не отбрасываются: компилятор всё равно проходит
// лексер/парсер/тайп-чек и увеличивает счётчики — это и есть покрытие.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  FEATURE_CASES,
  COVERAGE_CASES,
  PARITY_OK_CASES,
  PARITY_ERROR_CASES,
  LEXER_SNIPPETS,
  SCOPING_PROGRAMS,
} from "../../../selfhost/test/corpus.mjs";

/** Декодирует cooked-значение template literal (без вычисления ${}). */
function decodeTemplate(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") { out += c; continue; }
    const n = raw[i + 1];
    i++;
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b") out += "\b";
    else if (n === "f") out += "\f";
    else if (n === "v") out += "\v";
    else if (n === "0") out += "\0";
    else if (n === "\\") out += "\\";
    else if (n === "`") out += "`";
    else if (n === "$") out += "$";
    else if (n === "x") { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; }
    else if (n === "u") {
      if (raw[i + 1] === "{") {
        const end = raw.indexOf("}", i + 2);
        out += String.fromCodePoint(parseInt(raw.slice(i + 2, end), 16));
        i = end;
      } else {
        out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
        i += 4;
      }
    } else out += n;
  }
  return out;
}

/** Вытаскивает содержимое template literal, начиная сразу после обратной кавычки. */
function readTemplate(text, start) {
  let i = start;
  let raw = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { raw += c + (text[i + 1] ?? ""); i += 2; continue; }
    if (c === "`") return { value: decodeTemplate(raw), end: i + 1 };
    if (c === "$" && text[i + 1] === "{") {
      throw new Error("selfhost-coverage: интерполяция ${} в тестовом кейсе не поддерживается");
    }
    raw += c;
    i++;
  }
  throw new Error("selfhost-coverage: незакрытый template literal в тестах");
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

/** Все `src: \`...\`` из selfhost/test/*.test.mjs. */
export function extractTestPrograms(testDir) {  if (!existsSync(testDir)) return [];
  const out = [];
  for (const file of readdirSync(testDir).filter((f) => f.endsWith(".test.mjs")).sort()) {
    const text = readFileSync(join(testDir, file), "utf8");
    const re = /src\s*:\s*`/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index + m[0].length;
      const { value, end } = readTemplate(text, start);
      out.push({
        name: `${file}:${lineOf(text, start)}`,
        kind: "test",
        source: value,
      });
      re.lastIndex = end;
    }
  }
  return out;
}

/** Кейсы из общего корпуса selfhost/test/corpus.mjs — единый источник правды. */
export function extractSharedCorpus() {
  const out = [];
  const add = (file, name, src) => out.push({ name: `${file}:${name}`, kind: "test", source: src });
  for (const [name, c] of Object.entries(FEATURE_CASES)) add("features.test.mjs", name, c.src);
  for (const [name, c] of Object.entries(COVERAGE_CASES)) add("coverage.test.mjs", name, c.src);
  for (const [name, c] of Object.entries(PARITY_OK_CASES)) add("parity.test.mjs", name, c.src);
  for (const [name, c] of Object.entries(PARITY_ERROR_CASES)) add("parity.test.mjs", name, c.src);
  for (const c of SCOPING_PROGRAMS) add("scoping.test.mjs", c.name, c.src);
  for (const [ch] of LEXER_SNIPPETS.singles) add("lexer.test.mjs", JSON.stringify(ch), ch);
  for (const [ch] of LEXER_SNIPPETS.twins) add("lexer.test.mjs", JSON.stringify(ch), ch);
  for (const w of LEXER_SNIPPETS.words) add("lexer.test.mjs", JSON.stringify(w), w);
  return out;
}

/** Примеры языка из web-ide/examples/*.lat (если каталог есть). */
export function extractExamples(examplesDir) {  if (!existsSync(examplesDir)) return [];
  return readdirSync(examplesDir)
    .filter((f) => f.endsWith(".lat"))
    .sort()
    .map((f) => ({
      name: `examples/${f}`,
      kind: "example",
      source: readFileSync(join(examplesDir, f), "utf8"),
    }));
}

// --- Ручные пробы: ветки, которых нет в дифференциальных тестах ------------

const PROBES = [
  // Классы: поля, init, this, методы, присваивание в поле.
  {
    name: "probe/class: fields init this methods",
    source: `class Point {
  x: int;
  y: int;
  fn init(x, y) { this.x = x; this.y = y; }
  fn norm2() -> int { return this.x * this.x + this.y * this.y; }
}
fn main() -> int { let p = new Point(3, 4); return p.norm2(); }`,
  },
  // Ошибка: неизвестное поле.
  {
    name: "probe/class: unknown field (error)",
    source: `class P { x: int; }
fn main() -> int { let p = new P(); return p.missing; }`,
  },
  // Ошибка: неизвестный класс.
  {
    name: "probe/class: unknown class (error)",
    source: `fn main() -> int { let p = new Nope(1); return 0; }`,
  },
  // Ошибка: неизвестный метод.
  {
    name: "probe/class: unknown method (error)",
    source: `class P { x: int; }
fn main() -> int { let p = new P(); return p.nope(); }`,
  },
  // Enum + match по конструкторам с payload.
  {
    name: "probe/enum: payload and match",
    source: `enum Shape { Circle(int), Empty }
fn area(s) -> int {
  return match s { case Circle(r): r * r * 3, case Empty: 0, default: -1 };
}
fn main() -> int { return area(Circle(2)) + area(Empty); }`,
  },
  // match по литералам и default.
  {
    name: "probe/match: int literals and default",
    source: `fn f(n) -> int { return match n { case 0: 10, case 1: 20, default: 30 }; }
fn main() -> int { return f(0) + f(1) + f(2); }`,
  },
  // Лямбды: выражение, блок, захват, косвенный вызов.
  {
    name: "probe/lambda: expr block capture indirect",
    source: `fn apply(f, x) -> int { return f(x); }
fn main() -> int {
  let k = 5;
  let a = fn(x) => x + k;
  let b = fn(x) { let y = x * 2; return y + k; };
  return apply(a, 1) + apply(b, 2);
}`,
  },
  // Float: литералы, локальные, сравнения, конверсии, sqrt.
  {
    name: "probe/float: literals locals conv sqrt",
    source: `fn main() -> int {
  let a: float = 2.5;
  let b = 1.5;
  let c = a + b;
  let d = int(c * 2.0);
  let e = int(sqrt(16.0));
  if (a < c && c > b) { return d + e + int(float("3.9")); }
  return 0;
}`,
  },
  // Строки: concat, eq, index, len, to_str/to_int, escape.
  {
    name: "probe/string: concat eq index conv escape",
    source: `fn f(s: string) -> int { return len(s) + s[0] + s[2]; }
fn main() -> int {
  let s = "abc";
  let t = s + "de";
  if (s == "abc" && s != t) { return f(t) + "42".to_int(); }
  return 0;
}`,
  },
  // Массивы: литерал, push/pop, length, for-in, index-assign.
  {
    name: "probe/array: push pop for-in assign",
    source: `fn main() -> int {
  let a = [1, 2, 3];
  a.push(4); a[0] = a[0] + 10;
  let s = 0;
  for (let x in a) { s = s + x; }
  return s + a.length + a.pop();
}`,
  },
  // Линейная память.
  {
    name: "probe/memory: alloc store load memcopy",
    source: `fn main() -> int {
  let p = alloc(16);
  store32(p, 11); store32(p + 4, 31);
  store8(p + 8, 65);
  let q = alloc(16);
  memcopy(q, p, 8);
  return load32(q) + load32(q + 4) + load8(p + 8);
}`,
  },
  // Управление: if/else if, while, C-for, return, break/continue? (break нет)
  {
    name: "probe/control: if else while for",
    source: `fn main() -> int {
  let s = 0; let i = 0;
  while (i < 5) { if (i == 2) { s = s + 10; } else { s = s + i; } i = i + 1; }
  for (let j = 0; j < 3; j = j + 1) { s = s + j; }
  return s;
}`,
  },
  // Печать разных типов.
  {
    name: "probe/print: int float string bool null",
    source: `fn main() -> int { print(1, 2.5, "x", true, null); return 0; }`,
  },
  // Builtins, которые не встречаются в дифференциальных тестах, но есть в
  // компиляторе: assert_eq, str(), функциональная форма push(), .length().
  {
    name: "probe/builtin: assert_eq",
    source: `fn main() -> int { assert_eq(1 + 1, 2); return 0; }`,
  },
  {
    name: "probe/builtin: str(int)",
    source: `fn main() -> int { let s = str(42); return len(s); }`,
  },
  {
    name: "probe/builtin: push(arr, value)",
    source: `fn main() -> int { let a = [1, 2]; push(a, 3); return a.length; }`,
  },
  {
    name: "probe/method: length()",
    source: `fn main() -> int { let a = [1, 2, 3]; return a.length(); }`,
  },
  // Host-конструкции, которые selfhost исполняет inline.
  {
    name: "probe/host: spawn yield await select test",
    source: `async fn v() -> int { return 2; }
fn main() -> int {
  let x = 0;
  spawn { x = x + 1; }
  yield;
  let y = await v();
  select { case c <- 0: { x = x + 10; } default: { x = x + 100; } }
  test "inner" { assert(true); }
  return x + y + select { default: 3 };
}`,
  },
  // Ошибки тайп-чека.
  {
    name: "probe/error: undefined variable",
    source: `fn main() -> int { return missing; }`,
  },
  {
    name: "probe/error: undefined function",
    source: `fn main() -> int { return missing(1); }`,
  },
  {
    name: "probe/error: arity mismatch",
    source: `fn f(a, b) -> int { return a + b; }
fn main() -> int { return f(1); }`,
  },
  {
    name: "probe/error: condition not bool",
    source: `fn main() -> int { if (1) { return 1; } return 0; }`,
  },
  {
    name: "probe/error: return type mismatch",
    source: `fn f() -> string { return 1; }
fn main() -> int { return 0; }`,
  },
  {
    name: "probe/error: assignment to undefined",
    source: `fn main() -> int { nope = 1; return 0; }`,
  },
  {
    name: "probe/error: unknown builtin tensor",
    source: `fn main() -> int { let t = tensor([1]); return 0; }`,
  },
  {
    name: "probe/error: method on int",
    source: `fn main() -> int { let n = 1; return n.unknown(); }`,
  },
  // Модуль без main (ветка find_main).
  {
    name: "probe/module: no main",
    source: `fn helper(n) -> int { return n * 2; }`,
  },
  // Пустая функция/ранний return/вложенные блоки.
  {
    name: "probe/control: nested blocks early return",
    source: `fn f(n) -> int {
  if (n > 0) { if (n > 10) { return 2; } else { return 1; } }
  return 0;
}
fn main() -> int { return f(11) + f(5) + f(0); }`,
  },
  // Побитовые/логические/сравнения/сдвиги.
  {
    name: "probe/operators: bit logic cmp shift",
    source: `fn main() -> int {
  let a = (1 << 4) + (64 >> 2) + (7 & 3) + (8 | 1) + (5 ^ 1);
  if (a > 0 && a != 0 || false) { return a; }
  return 0;
}`,
  },
  // Класс с методом, возвращающим строку (строковый тип результата).
  {
    name: "probe/class: string-returning method",
    source: `class P { s: string; fn init(v: string) { this.s = v; } fn get() -> string { return this.s; } }
fn main() -> int { let p = new P("abc"); return p.get()[1]; }`,
  },
];

// --- Фаззинг-подобная генерация (детерминированная) ------------------------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}
function pick(rand, arr) {
  return arr[rand() % arr.length];
}
const INTS = ["0", "1", "2", "3", "5", "7", "10", "42", "100", "(2 + 3 * 4)", "(40 - 5)", "(3 << 2)", "(64 / 8)", "(9 % 4)"];
const STRS = ['"a"', '"abc"', '"hello"', '""', '"x y"'];
const FLOATS = ["1.5", "2.5", "0.5", "10.0", "1e3", "2.5e1"];

const TEMPLATES = [
  (r) => `fn add(a, b) -> int { return a + b; }
fn main() -> int { return add(${pick(r, INTS)}, ${pick(r, INTS)}); }`,
  (r) => `fn fact(n) -> int { if (n <= 1) { return 1; } return n * fact(n - 1); }
fn main() -> int { return fact(${pick(r, ["3", "4", "5", "6"])}); }`,
  (r) => `fn main() -> int { let a = [${pick(r, INTS)}, ${pick(r, INTS)}, ${pick(r, INTS)}]; return a[0] + a[1] + a.length; }`,
  (r) => `fn main() -> int { let s = 0; for (let x in [1, 2, 3, 4]) { if (x > ${pick(r, ["1", "2", "3"])}) { s = s + x; } } return s; }`,
  (r) => `fn main() -> int { let s = ${pick(r, STRS)}; return len(s) + s[0]; }`,
  (r) => `fn main() -> int { let x = ${pick(r, FLOATS)}; return int(x * 2.0) + int(sqrt(9.0)); }`,
  (r) => `fn main() -> int { let i = 0; let s = 0; while (i < ${pick(r, ["3", "5", "7"])}) { s = s + i; i = i + 1; } return s; }`,
  (r) => `fn main() -> int { let p = alloc(8); store32(p, ${pick(r, INTS)}); return load32(p); }`,
  (r) => `fn main() -> int { let n = ${pick(r, INTS)}; return match n { case 0: 1, case 1: 2, default: 3 }; }`,
  (r) => `fn main() -> int { let f = fn(x) => x + ${pick(r, INTS)}; return f(1); }`,
  (r) => `class C { v: int; fn init(x) { this.v = x; } fn get() -> int { return this.v; } }
fn main() -> int { let c = new C(${pick(r, INTS)}); return c.get(); }`,
  (r) => `fn main() -> int { let s = 0; if (${pick(r, INTS)} > 1) { s = s + 1; } else { s = s + 2; } return s; }`,
  (r) => `fn main() -> int { let a = [1, 2]; a.push(${pick(r, INTS)}); return a.pop() + a.length; }`,
  (r) => `fn main() -> int { return (${pick(r, INTS)} + ${pick(r, INTS)}) * 2 - ${pick(r, INTS)}; }`,
  (r) => `fn main() -> int { spawn { let x = 1; } yield; return select { default: ${pick(r, INTS)} }; }`,
  (r) => `fn main() -> int { let s = ${pick(r, STRS)} + ${pick(r, STRS)}; if (s == ${pick(r, STRS)}) { return 1; } return len(s); }`,
  // Ошибочные программы тоже полезны: покрывают диагностику.
  (r) => `fn main() -> int { return ${pick(r, ["nope", "nosuch(1)", "missing.field"])}; }`,
  (r) => `fn main() -> int { if (${pick(r, INTS)}) { return 1; } return 0; }`,
];

/**
 * @param {{testDir?:string, examplesDir?:string, shcSource?:string, shcName?:string,
 *          fuzz?:number, includeTests?:boolean, includeExamples?:boolean}} opts
 */
export function buildCorpus(opts = {}) {
  const corpus = [];
  const seen = new Set();
  const push = (entry) => {
    const key = entry.source;
    if (seen.has(key)) return;
    seen.add(key);
    corpus.push(entry);
  };

  if (opts.includeTests !== false) {
    for (const t of extractSharedCorpus()) push(t);
    for (const t of extractTestPrograms(opts.testDir)) push(t);
  }
  if (opts.shcSource) {
    push({ name: `selfhost/${opts.shcName ?? "shc.lat"}`, kind: "self", source: opts.shcSource });
  }
  if (opts.includeExamples !== false) {
    for (const e of extractExamples(opts.examplesDir)) push(e);
  }
  for (const p of PROBES) push({ ...p, kind: "probe" });

  const fuzz = opts.fuzz ?? 24;
  if (fuzz > 0) {
    const rand = lcg(0x5eed1234);
    for (let i = 0; i < fuzz; i++) {
      const tpl = TEMPLATES[i % TEMPLATES.length];
      push({ name: `fuzz/${String(i + 1).padStart(2, "0")}`, kind: "fuzz", source: tpl(rand) });
    }
  }
  return corpus;
}

/** Краткая сводка корпуса по kind (для отчёта). */
export function corpusSummary(corpus) {
  const byKind = {};
  for (const c of corpus) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  return { total: corpus.length, byKind };
}

export { PROBES, TEMPLATES };
