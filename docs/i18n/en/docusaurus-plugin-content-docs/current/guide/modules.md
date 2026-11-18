---
title: "File modules"
sidebar_label: "Modules"
sidebar_position: 18
description: "Latent modules v1: import/export, path rules, two-phase linking and name mangling, a multi-file project, CLI compile/check/bundle, support in both web IDE engines, bundle for the self-hosted compiler, and the v1 limitations."
---

# File modules

Modules are how you split a program into several `.lat` files and connect them at
compile time: `export` opens a name to other files, `import` pulls it in. There is
no runtime loader: the linker assembles a single `Program`, and from there it goes
to the type checker and codegen exactly like a single-file program. One and the
same mechanism works in four places:

| Where | How |
|---|---|
| Rust compiler | `latent::compile_files`, `latentc compile/check` |
| web IDE, engine #1 (JS interpreter) | native linker `web-ide/compiler/modules*.js` |
| web IDE, engine #2 (Rust → WASM) | C-ABI `latent_compile_files` + the `LPF1` manifest |
| self-hosted compiler | `latentc bundle` → a flat source (selfhost has no file system) |

## 1. Why modules

- **Boundaries of responsibility.** `math.lat` with functions and enums,
  `model.lat` with classes, `main.lat` with the scenario — instead of one
  thousand-line file.
- **Compile-time checking.** A typo in a name, a forgotten `export`, a missing
  file — a build error with a path and a line, not an `undefined` at runtime.
- **Zero runtime cost.** No module resolver appears in the WASM: names are
  resolved and renamed by the linker, and `import`/`export` are already gone from
  the AST.
- **One language for browser and server.** The same project compiles to WASM,
  runs in the playground interpreter, and travels to selfhost as a `bundle`.

## 2. Syntax

`import` and `export` are **top-level** declarations. Inside a block (`{ ... }`)
the parser reports an error: `ожидалось 'declaration (import/export допустимы
только на верхнем уровне)'` (a declaration was expected; import/export are
allowed at the top level only).

### 2.1. `export`

The modifier goes before a top-level `fn`, `class` or `enum` (including an
`async fn`):

```text
export fn square(x: int) -> int { ... }
export class Point { ... }
export enum Shape { Circle(int), Rect(int, int) }
export async fn fetch(url: string) -> int { ... }
```

- **Only** these three kinds can be exported: `export let` gives
  `ожидалось 'fn, class or enum after export'`, while `export` inside a block or
  on a class method gives `import/export допустимы только на верхнем уровне`.
- Declaration order inside a file does not matter: the linker builds its tables
  before rewriting the AST, so an `export fn` may call a function declared below
  it, and vice versa.

### 2.2. Named import

```text
import { square, Point, Shape } from "./math.lat";
import { square as sq } from "./math.lat";
```

- The list is named-only: `{ name }` or `{ name as alias }`, comma-separated.
- `from` and the path string are mandatory, and the trailing semicolon is
  mandatory (in both engines: this is a declaration, not an expression).
- An import **brings in exactly the listed names**. `import { Shape }` makes both
  `Shape` and its constructors (`Circle`, `Rect`) visible — they belong to the
  enum. All other names of the module stay private.
- You can only import what is marked `export`. A private function of a module is
  invisible from outside: `символ 'helper' не экспортирован из 'math.lat'`.
- An alias is an ordinary local name: `import { square as sq }` gives you `sq`,
  and `square` does not appear in that file.

### 2.3. Import for the side effect of connecting a file

```text
import "./effects.lat";
```

The form without a name list. Since top-level code in Latent is not executed, the
semantics are "connect the module": the file joins the project, is parsed and
linked (so its errors become build errors), but it adds no names to the current
module.

### 2.4. Path rules

The path in an `import` is a **path to a file**, not a package name:

| Rule | Example | Result |
|---|---|---|
| relative paths only | `"./math.lat"`, `"../lib/math.lat"` | resolved from the importer's directory |
| the `.lat` extension is mandatory | `"./math"` | `путь импорта должен оканчиваться на '.lat'` |
| absolute paths are forbidden | `"/abs/math.lat"`, `"C:\lib\math.lat"` | `абсолютный путь импорта недопустим` |
| `./` or `../` at the start is mandatory | `"math.lat"` | `путь импорта должен быть относительным ('./' или '../')` |
| `..` is normalized lexically | `"./sub/../math.lat"` | `./math.lat` |
| backslashes are allowed | `"..\lib\m.lat"` | `../lib/m.lat` |
| a file is loaded once | two `import`s of the same path | one module (canonical path) |

Normalization is a pure function (`\` → `/`, collapsing `.`/`..`/`//`); symlinks
are not resolved: this matters for the WASM build and for determinism. In the web
IDE paths are flat (there are no directories), so in practice you use
`"./name.lat"`; `../` outside the workspace is an error.

### 2.5. The single-file API is unchanged

`latent::compile_source(&str)` (and the C-ABI `latent_compile`) still compiles a
single source; a project without `import` takes the same path in `latentc`, so
its WASM is byte-for-byte the same as before (the golden set checks this). If the
source contains an `import`, an error with a hint is returned (the compiler
message is Russian; shown verbatim):

```text
Импорты не поддерживаются в однофайловой компиляции: используйте latent::compile_files / latentc compile <entry.lat> (проект из нескольких файлов)
```

## 3. A project of three files

```text
project/
  main.lat    — entry: the entry point, main()
  math.lat    — functions and an enum
  model.lat   — a class and a function that uses math
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

What matters here: `model.lat` imports only `Shape` but uses the `Circle`
constructor in `match` — importing an enum brings its variants along; `math.lat`
is imported by two files but loaded once; `main.lat` is the entry, so only its
`main` stays `main`, and every other name is mangled.

Running it:

```bash
latentc compile main.lat app.wasm   # build the project
latentc check main.lat              # the same without writing a file
latentc bundle main.lat bundle.lat  # a flat source
```

The blocks above are marked `// module-part`: they do not compile on their own
(they contain `import`), so the documentation validator skips them — see
[the example rules](../tooling/contributing.md#documentation-rules-for-examples).

## 4. How linking works

Linking is two-phase. **Loading:** a DFS from the entry over `import`, paths
normalized to canonical paths, each file parsed exactly once (cycles are allowed
— a module is marked parsed **before** walking its imports). **Tables:** modules
are sorted by canonical path and get indices `m0`, `m1`, …; for each one a table
`(module, name) → mangled` is built, and every import is checked: the module
exists, the symbol is exported, the local name is free. **Rewriting:** each
module's AST is rewritten through the tables, the `import`/`export` nodes are
removed, and everything is merged into a single `Program`.

After that the program goes to the type checker and codegen unchanged: the linker
adds neither "module" instructions nor a runtime resolver.

### 4.1. Module order

The project composition comes from the DFS, the indices come from sorting by
canonical path. For the example above (`main.lat`, `math.lat`, `model.lat`):

```text
m0 = main.lat     (entry: fn main stays main)
m1 = math.lat     square → m1$square, sum_squares → m1$sum_squares, Shape → m1$Shape
m2 = model.lat    Point → m2$Point, area → m2$area
```

The order is deterministic: the same set of files always produces the same names
and therefore the same WASM bytes.

### 4.2. Name mangling

The format is `m<index>$<name>`:

| What | How it is rewritten |
|---|---|
| top-level `fn`/`class`/`enum` | `m1$square`, `m2$Point`, `m1$Shape` |
| the entry module's `main` | **not** mangled — it is what the WASM module exports |
| enum variants | `m1$Circle`, `m1$Rect`; both `Circle(2)` calls and `case Circle(r)` patterns are rewritten |
| `new Point` | `new m2$Point` (the parser keeps the class name with the `new ` prefix) |
| class methods | mangled by the existing `Class_method` mechanism from the mangled class name |
| local declarations, builtins, imported names | locals and builtins (`print`, `len`) are not mangled; imported names are replaced with the target's mangled name (taking the alias into account) |

Practical consequence: two functions called `helper` in different modules are
different symbols (`m1$helper` and `m2$helper`), no conflict. Two **exports** with
the same name in one module are an error already at the table phase.

### 4.3. What the type checker sees

The linked `Program` contains all functions/classes/enums at once, so the type
checker sees the signatures of the whole project: a call to a function from
another module is typed as an ordinary call, and cross-module recursion works.
There is no separate "module" type or namespace in the type system.

### 4.4. Import cycles

Cycles are allowed: `a.lat` ↔ `b.lat` is a normal project. Names are resolved
through tables, not through execution order, and top-level code is not executed
at all. Engine #1's resolver additionally reports the cycles it finds in `cycles`,
but does not treat them as errors.

## 5. Errors

All module errors carry the file path, and import errors also carry the position
of the declaration: `path:line:col: ...`. Exact texts (Rust compiler; the
messages are Russian):

| Text | Cause |
|---|---|
| `абсолютный путь импорта недопустим: '<path>'` | the path starts with `/`, `C:\` or a UNC prefix |
| `путь импорта должен оканчиваться на '.lat': '<path>'` | the extension is missing |
| `путь импорта должен быть относительным ('./' или '../'): '<path>'` | `import { x } from "math.lat"` |
| `<path>:<L>:<C>: файл не найден: <resolved>` | there is no file at the resolved path |
| `<path>:<L>:<C>: символ '<name>' не экспортирован из '<path>'` | importing a private or non-existent name |
| `<path>:<L>:<C>: имя '<name>' уже объявлено в модуле` · `<path>:<L>:<C>: дубликат импортированного имени '<name>'` | the import conflicts with a local declaration or is imported twice |
| `<path>:<L>:<C>: export '<name>': объявление не найдено` | `export` attached to a name that does not exist (an internal linker check) |
| `<path>:<L>:<C>: модуль не найден: <resolved>` | the file was present at load time but got lost during linking |
| `<path>: файл передан дважды с разным содержимым` · `<path>: entry-файл не найден среди переданных файлов` | a duplicate path with different text, or no entry in the set |
| `<path>: <lexer/parser error>` | a syntax error in a specific file |

An example of CLI output (verbatim):

```text
$ latentc check main.lat
error: main.lat:2:10: символ 'squer' не экспортирован из 'math.lat'
```

The project structure is checked first, the types after it; the full catalogue is
in [diagnostics](../reference/errors.md#modules-and-linking).

## 6. CLI

```text
latentc compile <file.lat> [out.wasm]   — compile the project to WASM
latentc check <file.lat>                — check the project without writing
latentc bundle <file.lat> [out.lat]     — the flat Latent source of the project
latentc version | --version | -v        — the compiler version
```

- The argument is the **entry file**; the CLI finds the rest itself by reading
  `import`s from disk recursively (cycles are safe, repeated imports are not read
  twice).
- `compile` writes `<input without .lat>.wasm` by default and prints
  `main.lat -> app.wasm (1194 bytes)`; `check` prints `ok: <N> bytes of wasm`
  (a full compilation pass including codegen, not just syntax).
- `bundle` without a second argument prints the source to stdout; with an
  argument it writes the file and prints `main.lat -> bundle.lat (N bytes)`.
- Errors go to stderr as `error: ...` with exit code `1`; a read error inside the
  import tree looks like
  `main.lat:3:1: файл не найден: /work/project/util.lat (...)`.

## 7. Modules in the web IDE

**The active file is the entry.** The other `.lat` files of the workspace are
available as modules; an `import` path is resolved relative to the active file.

- **Engine #1 (JS interpreter)** links modules natively: `compiler/modules.js`
  (path canonicalization, `import` parsing, DFS graph, a cache of parsed modules
  keyed by "path + content hash"), `modules-link.js` (two-phase linking and
  `mN$name` mangling), `modules-rewrite.js` (AST rewriting), `parser-modules.js`
  (the `import`/`export` grammar).
- **Engine #2 (Rust → WASM)** receives **all** `.lat` files of the workspace in
  one `LPF1` manifest (sorted by path, plus the entry index) and calls the
  `latent_compile_files` C-ABI; the result is cached by the project hash
  (`services/compiler-service-project.js`). The ABI is detected through
  `supportsModules`: an old `compiler.wasm` without it gives a clear "engine #2
  has no modules yet" and runs on engine #1.
- **Run / Run with AI / Check** work with the project: Check also validates
  linking (a missing file, a symbol that is not exported), Run executes all
  modules in engine #1, and self-repair patches only the entry file — the rest
  are treated as libraries.
- **UI limitations.** The file tree is flat: there are no directories, and the
  characters `/ \ : * ? " < > |` in a name are replaced with `_`, so in practice
  an import is always `"./name.lat"`, and `"../x.lat"` outside the workspace is
  the error `module path '...' escapes the project root`. File names are unique
  (`main-2.lat`), otherwise two files with the same path could not be linked.
  Errors are shown as `path:line: ...`. More about the IDE —
  [Web IDE](../tooling/web-ide.md#modules-and-multi-file-projects).

## 8. The self-hosted compiler and `bundle`

The self-hosted compiler (`selfhost/`) has **no file system**: it receives one
source in linear memory and cannot read `import`. So modules are a host/linker
feature, and selfhost consumes a **bundle**:

```bash
latentc bundle main.lat bundle.lat    # host: linking + printing
node selfhost/wasm-compiler.mjs compile bundle.lat bundle.wasm
```

What `bundle` does:

- prints the linked `Program` back to Latent: `import`/`export` removed,
  modules in canonical-path order (the same deterministic order as linking);
- replaces `$` in names (`m1$square`) with `__` (`m1__square`), because the
  selfhost lexer accepts only `[A-Za-z_][A-Za-z0-9_]*`;
- printing is deterministic, so the `bundle` of one project is always identical.

Selfhost stays a single-file compiler (its own `shc.lat` is one file) but can
build **any** multi-file project once the host has produced a `bundle`. The check
is the differential test `selfhost/test/modules.test.mjs` over the fixtures in
`selfhost/test/fixtures/modules/`: `latentc compile(bundle)` is byte-identical to
`latentc compile_files(entry)`, and selfhost on the same bundle returns the same
`main()` and the same error status. Byte equality **between Rust and selfhost does
not exist and is not required** — their code generators have historically
diverged even on a single-file `fn main() -> int { return 42; }`; the details and
the size table are in
[the self-hosted compiler](../specs/selfhost.md#modules-and-bundle).

## 9. v1 limitations

| Not available | What to do |
|---|---|
| `export *`, `export { x } from ...` (re-export) | import names one by one in each module |
| `import * as ns` | import the names you need explicitly |
| dynamic `import()` | modules are static; all code is in the build |
| a package manager, `node_modules`, external packages | project files only |
| absolute paths and URLs in `import` | a relative path from the importer |
| an import without the `.lat` extension | always specify the extension |
| directories in the web IDE | flat file names |
| a separate namespace/qualification (`math.square`) | names are imported "flat"; resolve conflicts with aliases |

## 10. Modules, chunks and bundlers

These are different levels and they do not conflict: Latent file modules are
folded by the compiler's linker (the output is **one** WASM module per project),
while lazy chunks are produced by your bundler (Vite/Rollup/webpack) — several
`.js`/`.wasm` assets loaded on a user action.

After linking, an `import` does not become a network request. Chunking is the
runtime's job — load the core `.wasm` through a `dynamic import()` around the
loader instead of putting it in the initial bundle. Practical techniques (Vite
`?url`, `new URL(..., import.meta.url)`, `manualChunks`, size budgets) are in the
[frontend guide](./web-and-frontend.md#68-lazy-loading-and-chunks).

**Modules are about code structure, chunks are about load timing**: the linker
removes the module boundary before WASM, the bundler adds the network boundary
after it.

## Terms

- **engine #1** — the JS interpreter in the web IDE: executes the language,
  including host features.
- **engine #2** — the Rust compiler (`src/`), built into `compiler.wasm`:
  compiles a subset of the language to WASM.
- **type checker** — the type-checking pass (`src/typechecker/`), shared by a
  single file and by a linked project.
- **runtime** — program execution: engine #1's host runtime or the browser's WASM
  runtime.
- **linker** — `src/modules/linker.rs`: export tables, mangling, assembling a
  single `Program`.
- **bundle** — a flat Latent source of the whole project (`m1__square`), the input
  of the selfhost compiler.
- **fixed point** — a selfhost property: `stage2 === stage3` byte-for-byte.

## Related sections

- [Multi-file example walkthrough](../examples/modules.md) — the same project
  with the output of both engines and the bundle.
- [Grammar](../reference/grammar.md#import-and-export) — the EBNF production.
- [CLI](../reference/cli.md#multi-file-projects) and
  [diagnostics](../reference/errors.md#modules-and-linking).
- [Self-hosted compiler](../specs/selfhost.md#modules-and-bundle) — why bundle.
- [Web IDE](../tooling/web-ide.md) · [Latent in the frontend](./web-and-frontend.md) ·
  [Killer features](./killer-features.md#6-modules-and-lazy-chunks)
