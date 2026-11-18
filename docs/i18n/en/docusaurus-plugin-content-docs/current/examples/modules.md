---
title: "Modules: a project of three files"
sidebar_label: "Modules (multi-file project)"
sidebar_position: 16
description: "A step-by-step walkthrough of a multi-file Latent project: math.lat, model.lat, main.lat — the output of engine #1, compilation with engine #2, what latentc bundle prints, and the exact linking error texts."
---

# Modules: a project of three files

A walkthrough of the project used in the [modules guide](../guide/modules.md):
functions and an enum in `math.lat`, a class in `model.lat`, the scenario in
`main.lat`. Below you get the file code, what you see in the console of each
engine, and what it looks like after `latentc bundle`.

## 1. The files

```text
project/
  main.lat    — entry: main(), the scenario
  math.lat    — square, sum_squares, enum Shape
  model.lat   — class Point, fn area(Shape)
```

```latent
// module-part math.lat
export fn square(x: int) -> int { return x * x; }

export fn sum_squares(a: int, b: int) -> int { return square(a) + square(b); }

export enum Shape { Circle(int), Rect(int, int) }
```

```latent
// module-part model.lat
import { square, Shape } from "./math.lat";

export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
    fn norm2() -> int { return square(this.x) + square(this.y); }
}

export fn area(shape: Shape) -> int {
    return match shape {
        case Circle(r): 3 * square(r),
        default: 0,
    };
}
```

```latent
// module-part main.lat
import { Shape } from "./math.lat";
import { Point, area } from "./model.lat";

fn main() -> int {
    let p = new Point(3, 4);
    let c = Circle(2);
    print("norm2 =", p.norm2());
    print("area =", area(c));
    return p.norm2() + area(c);
}
```

Line by line:

- `model.lat` imports `Shape` but calls `Circle(2)` only inside `match` — an enum
  variant arrives together with the enum import, so a separate
  `import { Circle }` is neither needed nor allowed.
- `main.lat` imports `Point` and `area` from `model.lat`, and `Shape` directly
  from `math.lat`: v1 has no transitive re-exports, so every module imports what
  it needs.
- `math.lat` is imported by two files, but the linker loads it once.

## 2. Run in the web IDE (engine #1)

Create the three files in the project tree, open `main.lat` (the active file is
the entry) and press **Run** (`Ctrl/⌘+Enter`). The console shows:

```text
norm2 = 25
area = 12
```

`print` in engine #1 joins its arguments with a space on one line, so
`print("norm2 =", p.norm2())` produces `norm2 = 25`. The value of `main()` is
`37`.

What happens inside: `compiler/modules.js` builds the graph from `main.lat`,
finds `math.lat` and `model.lat`, and caches the parsed modules;
`modules-link.js` renames the declarations to `m0$…`/`m1$…`/`m2$…` and assembles
a single `Program` that the interpreter runs.

## 3. Engine #2 (the WASM compiler)

The **Engine #2** button sends all three files to `compiler.wasm` in an `LPF1`
manifest: the project compiles as a whole, and the **WASM** tab shows a valid
**1194-byte** module. If you run it in a Node host with `env.print`, the output
differs from engine #1:

```text
norm2 =
25
area =
12
```

This is not a mismatch of the example but the ABI: `print` in engine #2 is called
**once per argument**, so each part is a separate line. `main()` returns `37` —
the same as in engine #1.

## 4. What `latentc bundle` prints

`latentc bundle main.lat bundle.lat` merges the modules into one source: `import`
and `export` are removed, names are mangled, and `$` is replaced with `__` (the
selfhost lexer does not know `$`). For the project above you get exactly this
file (it compiles and produces the same 1194 bytes as the project):

```latent
fn main() -> int {
    let p = new m2__Point(3, 4);
    let c = m1__Circle(2);
    print("norm2 =", p.norm2());
    print("area =", m2__area(c));
    return (p.norm2() + m2__area(c));
}
fn m1__square(x: int) -> int {
    return (x * x);
}
fn m1__sum_squares(a: int, b: int) -> int {
    return (m1__square(a) + m1__square(b));
}
enum m1__Shape { m1__Circle(int), m1__Rect(int, int) }
class m2__Point {
    x: int;
    y: int;
    fn init(x: int, y: int) {
        (this.x = x);
        (this.y = y);
    }
    fn norm2() -> int {
        return (m1__square(this.x) + m1__square(this.y));
    }
}
fn m2__area(shape: m1__Shape) -> int {
    return (match shape { case m1__Circle(r): (3 * m1__square(r)), case _: 0 });
}
```

How to read it:

| In the bundle | Where it comes from |
|---|---|
| `m0` = `main.lat` | indices: sorting by canonical path (`main` < `math` < `model`) |
| `m1__square`, `m2__Point` | `$` → `__`: names after linking, in a syntax selfhost understands |
| `main` without a prefix | the entry module's `main` is not mangled: it is the WASM module export |
| `case _: 0` | the `default:` of `area` printed as a wildcard pattern |
| `(3 * m1__square(r))` | the expression printer adds parentheses by precedence |
| `(this.x = x);` | a field assignment printed as an expression statement |

Printing is deterministic: the same project always yields the same bundle, so it
can be compared byte-for-byte in tests and cached.

## 5. Errors you will see

The texts below were produced by the compiler on this same project (the position
is the line and column of the import declaration):

| What was broken | Message |
|---|---|
| `import { sq } from "./math.lat";` (no such export) | `main.lat:1:10: символ 'sq' не экспортирован из 'math.lat'` |
| `import { util } from "./lib/util.lat";` (no such file) | `main.lat:1:1: файл не найден: lib/util.lat` |
| `import { square } from "math.lat";` (no `./`) | `main.lat:1:1: путь импорта должен быть относительным ('./' или '../'): 'math.lat'` |
| two identical imports | `main.lat:2:10: дубликат импортированного имени 'square'` |
| the import conflicts with a local `fn square` | `main.lat:1:10: имя 'square' уже объявлено в модуле` |
| `import` inside a function | `main.lat: Ошибка парсинга на строке 2:5: ожидалось 'declaration (import/export допустимы только на верхнем уровне)', найдено Import` |

In the CLI the same texts are prefixed with `error: ` and return code `1`. In the
web IDE a linking error comes from engine #1 (English texts such as
`main.lat:1: module './lib/util.lat' not found (resolved to 'lib/util.lat').
Create the file in the workspace (＋) or fix the import path.`) — that is the
diagnostic of the JS resolver, not of the compiler.

## 6. An import cycle

Cycles are allowed: linking goes through tables, not through execution order. The
files below compile as one project without errors:

```text
// a.lat
import { b } from "./b.lat";
export fn a(n: int) -> int { if (n <= 1) { return 1; } return n + b(n - 1); }

// b.lat
import { a } from "./a.lat";
export fn b(n: int) -> int { if (n <= 1) { return 0; } return a(n - 1); }

// main.lat
import { a } from "./a.lat";
fn main() -> int { return a(4); }
```

What counts as an error is not a cycle but a missing file or a name that is not
exported.

## 7. Reproducing it in the CLI

```bash
# three files in one directory
latentc check main.lat              # ok: 1194 bytes of wasm
latentc compile main.lat app.wasm   # main.lat -> app.wasm (1194 bytes)
latentc bundle main.lat bundle.lat  # main.lat -> bundle.lat (N bytes)
```

`app.wasm` and `bundle.wasm` (the result of compiling the bundle through the
single-file path) are byte-for-byte identical — on this project the sha256 starts
with `5e66d6d2…`. That is exactly the property the selfhost compiler needs: it
receives a flat bundle instead of a file tree (see
[the self-hosted compiler](../specs/selfhost.md#modules-and-bundle)).

## 8. Related sections

- [File modules](../guide/modules.md) — syntax, linking, limitations.
- [CLI](../reference/cli.md#multi-file-projects) — commands and exit codes.
- [Diagnostics](../reference/errors.md#modules-and-linking) — the full catalogue.
- [Web IDE](../tooling/web-ide.md#modules-and-multi-file-projects) — how to open
  the project in the playground.
- [Example walkthroughs](./index.md) — the other examples.
