// integration.mjs — сквозная проверка: компиляция .lat → WASM → исполнение.
//
// Прогоняет примеры через `latentc`, валидирует и исполняет их в Node,
// сверяя вывод / возврат main() с ожидаемым. Запуск: node scripts/integration.mjs
//
// Компилятор берётся из target/debug/latentc (соберите `cargo build`).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CLI = join(ROOT, "target/debug/latentc");

if (!existsSync(CLI)) {
  console.error(`latentc not found at ${CLI}; run 'cargo build --bin latentc'`);
  process.exit(2);
}

// Случаи: source, ожидаемый результат main(), ожидаемые подстроки вывода.
const cases = [
  {
    name: "arithmetic",
    src: `fn main() -> int { return 2 + 3 * 4; }`,
    main: 14,
  },
  {
    name: "unary_neg",
    src: `fn main() -> int { return -7; }`,
    main: -7,
  },
  {
    name: "string_concat",
    src: `fn main() -> int { let s = "ab" + "cd"; print(s); return s.length; }`,
    main: 4,
    out: ["abcd"],
  },
  {
    name: "string_number_concat",
    src: `fn main() -> int { let s = "n=" + 42; print(s); return s.length; }`,
    main: 4,
    out: ["n=42"],
  },
  {
    name: "string_compare",
    src: `fn main() -> int { if ("a" == "a") { return 1; } return 0; }`,
    main: 1,
  },
  {
    name: "enum_match",
    src: `
enum Shape { Circle(int), Square(int), Empty }
fn area(s: Shape) -> int {
    return match s { case Circle(r): r * r, case Square(a): a * a, case Empty: 0 };
}
fn main() -> int { return area(Circle(6)) + area(Square(3)); }`,
    main: 45,
  },
  {
    name: "result_match",
    src: `
fn unwrap_or(r, d) -> int { return match r { case Ok(v): v, case Err(e): d }; }
fn main() -> int { return unwrap_or(Ok(7), 0) + unwrap_or(Err(0), 3); }`,
    main: 10,
  },
  {
    name: "lambda_no_capture",
    src: `fn main() -> int { let d = fn(x) => x * 2; return d(21); }`,
    main: 42,
  },
  {
    name: "closure_capture",
    src: `fn main() -> int { let b = 10; let add = fn(x) => x + b; return add(5); }`,
    main: 15,
  },
  {
    name: "block_lambda",
    src: `fn main() -> int { let s = fn(x) { let y = x + 1; return y * 10; }; return s(4); }`,
    main: 50,
  },
  {
    name: "higher_order",
    src: `fn apply_twice(f, x) { return f(f(x)); }
fn main() -> int { let d = fn(x) => x * 2; return apply_twice(d, 5); }`,
    main: 20,
  },
  {
    name: "bitwise_shifts",
    src: `fn main() -> int { return (1 << 4) + (16 >> 2) + (7 & 3) + (1 | 2) + (5 ^ 1); }`,
    main: 16 + 4 + 3 + 3 + 4,
  },
  {
    name: "for_in_loop",
    src: `fn main() -> int {
    let s = 0;
    for (let x in [1, 2, 3, 4]) { s = s + x; }
    return s;
}`,
    main: 10,
  },
  {
    name: "array_push_pop",
    src: `fn main() -> int {
    let a = [1, 2];
    a.push(3);
    let top = a.pop();
    return a.length + top;
}`,
    main: 5,
  },
  {
    name: "recursion",
    src: `fn fact(n: int) -> int { if (n <= 1) { return 1; } return n * fact(n - 1); }
fn main() -> int { return fact(5); }`,
    main: 120,
  },
  {
    name: "string_char_at",
    src: `fn main() -> int { return "ABC"[1]; }`,
    main: 66,
  },
  {
    name: "int_str_roundtrip",
    src: `fn main() -> int { return int(str(123)) + 1; }`,
    main: 124,
  },
  {
    name: "classes",
    src: `class Point { x: int; y: int;
  fn init(x, y) { this.x = x; this.y = y; }
  fn norm2() { return this.x * this.x + this.y * this.y; }
}
fn main() -> int { let p = new Point(3, 4); return p.norm2(); }`,
    main: 25,
  },
  {
    name: "leb128_roundtrip",
    src: `
fn write_uleb128(buf, value) -> int {
    let n = 0;
    let v = value;
    while (true) {
        let byte = v & 127;
        v = v >> 7;
        if (v != 0) { byte = byte | 128; }
        buf[n] = byte;
        n = n + 1;
        if (v == 0) { return n; }
    }
    return n;
}
fn read_uleb128(buf, len) -> int {
    let result = 0;
    let shift = 0;
    let i = 0;
    while (i < len) {
        let byte = buf[i];
        result = result | ((byte & 127) << shift);
        shift = shift + 7;
        i = i + 1;
    }
    return result;
}
fn main() -> int {
    let buf = [0, 0, 0, 0, 0];
    let n = write_uleb128(buf, 624485);
    return read_uleb128(buf, n);
}`,
    main: 624485,
  },
];

const tmp = mkdtempSync(join(tmpdir(), "latent-int-"));

let pass = 0, fail = 0;
for (const c of cases) {
  const srcPath = join(tmp, `${c.name}.lat`);
  const wasmPath = join(tmp, `${c.name}.wasm`);
  try {
    writeFileSync(srcPath, c.src, "utf8");
    execFileSync(CLI, ["compile", srcPath, wasmPath], { stdio: "pipe" });
    const bytes = readFileSync(wasmPath);
    if (!WebAssembly.validate(bytes)) throw new Error("WebAssembly.validate failed");
    const output = [];
    let instance;
    const module = new WebAssembly.Module(bytes);
    instance = new WebAssembly.Instance(module, {
      env: {
        print: (ptr) => {
          const dv = new DataView(instance.exports.memory.buffer);
          const len = dv.getUint32(ptr, true);
          const view = new Uint8Array(instance.exports.memory.buffer);
          output.push(new TextDecoder().decode(view.subarray(ptr + 4, ptr + 4 + len)));
        },
      },
    });
    const result = instance.exports.main();
    if (result !== c.main) throw new Error(`main()=${result}, expected ${c.main}`);
    for (const want of c.out || []) {
      if (!output.includes(want)) throw new Error(`output missing ${JSON.stringify(want)}; got ${JSON.stringify(output)}`);
    }
    console.log(`PASS ${c.name}`);
    pass++;
  } catch (e) {
    console.error(`FAIL ${c.name}: ${e.message}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);