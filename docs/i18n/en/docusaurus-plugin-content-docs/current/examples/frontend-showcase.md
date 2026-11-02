---
title: "Nine interactive Latent pages"
sidebar_label: "Demos and the app"
sidebar_position: 15
description: "Nine browser pages: goroutines and channels, AI primitives, the self-hosted compiler, a sandbox, modules, Palette Studio — plus a benchmark, canvas filters and physics. Real execution, live metrics, known limits."
---

# Nine interactive Latent pages

The nine pages below run Latent right in the browser. Five are about the language:
goroutines and channels, AI primitives, the self-hosted compiler, a sandbox and
modules. One is a working design-system app. Three are about dense computation: a
benchmark, image filters and physics.

There are no recorded videos and no "average numbers from our machine": the code
runs on yours, the metrics are measured on the spot, and the `.lat` sources sit
next to them. These are static pages with no bundler and no external
dependencies, in `docs/static/demos/`, published at `/latent/demos/...`. A copy
of the interpreter for offline use lives in `demos/vendor/compiler/`.

## Map: page, strong side, what you see

| Page | Strong side | What you see |
|---|---|---|
| <a href="/latent/demos/concurrency/">Goroutines & channels</a> | CSP in the grammar: `spawn`, `channel`, `<-`, `select`, `yield` | a live visualization of goroutines, channel pipes and message tokens; the scheduler trace; fan-in, map-reduce, worker pool, select, **1000 goroutines**, deadlock |
| <a href="/latent/demos/ai/">AI-native</a> | `ai_embed`, `ai_infer`, `ai_stream`, `tensor`, `matmul` are language syntax | embeddings as vectors, a cosine heatmap, token streaming, real A/B/C matrices, optional gateway |
| <a href="/latent/demos/selfhost/">Compiler compiles itself</a> | a 41 KiB `seed.wasm` compiles the 164 KiB `shc.lat` in the browser | the `seed → stage1′ → stage2′ → stage3′` chain, sha256 per stage, **FIXED POINT**, sample run |
| <a href="/latent/demos/sandbox/">Sandbox</a> | a single `env.print` import, wasm traps, Worker termination | editor → `compiler.wasm` → Worker; infinite loop, OOB, `memory.grow` 64 MiB, DOM/fetch rejected |
| <a href="/latent/demos/modules/">Modules</a> | `import`/`export`, module graph, two-phase linking | a 4-file tree, SVG graph, mangled names, an `a ↔ b` cycle, a build through `latent_compile_files` |
| <a href="/latent/demos/palette/">Palette Studio</a> | an app: pixels → palette → CSS tokens | image upload, editable swatches, WCAG contrast, CSS/JSON/PNG export and an **honest benchmark** against a JS twin |
| <a href="/latent/demos/bench/">Benchmark</a> | dense `i32` loops in linear memory | JS vs Latent→WASM on five algorithms, medians, parity checksums |
| <a href="/latent/demos/image/">Images</a> | pointers into memory instead of copies | grayscale, blur, Sobel, threshold over `ImageData`, an original/filter slider |
| <a href="/latent/demos/physics/">Physics</a> | one buffer, fixed point, no GC | up to 30,000 particles, an FPS graph, bit-for-bit parity with the JS twin |

## 1. Goroutines and channels

The flagship demo. Eight scenarios are real Latent programs with `spawn`,
`channel`, `ch.send`, `select` and `yield`. Engine #1 executes the program, records
a trace (spawns, messages, waits, scheduler steps), and the page replays it as an
animation. The metrics come from the real run, not from the animation.

<iframe
  src="/latent/demos/concurrency/?embed=1"
  title="Latent — goroutines, channels and the scheduler"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

If the iframe does not load, open the page directly:
<a href="/latent/demos/concurrency/">latent/demos/concurrency</a>.

```latent
// Does not compile with engine #2: channels and spawn require the host runtime.
// Executed by engine #1 in the demo.
fn producer(ch: channel, n: int) {
    let i = 1;
    while (i <= n) {
        ch.send(i * i);
        i = i + 1;
    }
}

fn consumer(ch: channel, n: int) {
    let sum = 0;
    let got = 0;
    while (got < n) {
        let v = ch.recv();
        sum = sum + v;
        got = got + 1;
    }
    print("consumer: got", got, "sum =", sum);
}

fn main() -> int {
    let ch = channel();
    spawn producer(ch, 12);
    spawn consumer(ch, 12);
    return 0;
}
```

What you see: producer/consumer over a channel, fan-in from three workers, four
workers with partial sums (map-reduce), a worker pool over two channels, a select
race, 1000 goroutines, a deadlock, and `yield` semantics. Every scenario ships a JS
equivalent built on promises, so you can compare size and readability.

The scheduler is cooperative: one thread, channels have no bounded queue, and
`select` polls arms in order. The counters show it, and so does the limitations
section on the page.

## 2. AI-native primitives

<iframe
  src="/latent/demos/ai/?embed=1"
  title="Latent — AI primitives in the browser"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

```latent
// host-only: ai_embed/cosine_similarity require the host runtime (engine #1).
fn main() -> int {
    let docs = ["channels and goroutines", "ai-native primitives"];
    let mat = [];
    let i = 0;
    while (i < docs.length) {
        mat.push(ai_embed(docs[i]));
        i = i + 1;
    }
    let q = ai_embed("how do channels work?");
    i = 0;
    while (i < docs.length) {
        print("sim", i, cosine_similarity(q, mat[i]));
        i = i + 1;
    }
    return 0;
}
```

The page executes a program with `ai_embed`, `cosine_similarity`, `ai_infer`,
`ai_stream`/`stream_next`, `tensor` and `matmul`, then visualizes the **real**
values: 8-dimensional vectors, the similarity matrix, a document ranking, the token
stream, and A(2×3)·B(3×2)=C(2×2). By default it uses the deterministic offline mock
from `interpreter-ai.js`; optionally you can connect an Ollama/OpenAI-compatible
gateway (for `ai_infer` only; the key is never stored).

Mock embeddings are a hash projection, not semantics. Streaming prints tokens that
the interpreter has already received, and `ai_generate!` is parsed by the Rust
parser (engine #2) but not executed by the JS interpreter. The page says this next
to the result rather than hiding it.

## 3. The compiler compiles itself

<iframe
  src="/latent/demos/selfhost/?embed=1"
  title="Latent — self-hosted compiler in the browser"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

```latent
// This sample is compiled by seed.wasm and executed in the demo.
fn main() -> int {
    print("hello from seed.wasm");
    return 42;
}
```

The demo fetches `seed.wasm` (41.5 KiB), checks its sha256 against `seed.json`, and
in a Web Worker compiles `selfhost/shc.lat` (164 KiB) three times: `seed → stage1′
→ stage2′ → stage3′`. Each stage shows its size, time and sha256; byte equality is
checked with `crypto.subtle` plus a byte-wise comparison. In the current build
`seed = stage1′ = stage2′ = stage3′` — a fixed point from the first step. Then the
same seed compiles and runs the selected sample through the ABI
`[len][utf8]` → `main()` → `[len][wasm]`.

Seed is the trusted starting point: the self-hosted compiler may reject some
host-only corpus programs, and a 30-second timeout terminates the Worker. That is
a reproducibility limit, not magic.

## 4. Sandbox for untrusted code

<iframe
  src="/latent/demos/sandbox/?embed=1"
  title="Latent — safe execution of untrusted code"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

You write Latent code, `compiler.wasm` compiles it to WASM, and a Worker
instantiates the module with **exactly one** import: `env.print`. The page shows
the real import list from `WebAssembly.Module.imports()` — the binary, not a
declaration.

Buttons: infinite loop (the host calls `worker.terminate()` on timeout), OOB access
(`memory access out of bounds`), `alloc(64 MiB)` (memory grows to 1025 pages), and
`alert`/`fetch` (a compile error: those names do not exist in the language). The
capability list, memory gauge and event log update live.

This is not an OS sandbox and not a boundary against browser bugs:
`compiler.wasm` is trusted, and the timeout lives on the host. What is and is not
isolated is covered in the page's limitations section and in the
[register](../specs/limitations.md).

## 5. A multi-file project

<iframe
  src="/latent/demos/modules/?embed=1"
  title="Latent — modules and linking in the browser"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

```latent
// Does not compile on its own: a module file (the project entry).
import { mean, square } from "./math.lat";
import { variance } from "./stats.lat";

fn main() -> int {
    let data = [2, 4, 6, 8];
    print("mean =", mean(data));
    print("variance =", variance(data));
    return square(9);
}
```

A four-file tree, an editor, an SVG import graph, two-phase linking, and a run. The
demo uses the real `resolveModuleGraph` / `linkModuleProject` from
`web-ide/compiler` and shows the mangled names (`m1$square`, `m3$variance`) — the
linker result, not a label. The "cycles allowed" project demonstrates a permitted
`a.lat ↔ b.lat` cycle, and "missing import" shows an error with a path and a line.

Build: the page checks `compiler.wasm` via `WebAssembly.Module.exports`. If
`latent_compile_files` is present, it encodes an `LPF1` manifest and compiles the
project to WASM (as in the current build); otherwise it runs on engine #1. Both
paths are real.

Modules v1 are named imports and relative `.lat` paths only; the editor lives in
tab memory; cycles are resolved by the linker, but recursion is still recursion.

## 6. Palette Studio: an app, not a showcase

<iframe
  src="/latent/demos/palette/?embed=1"
  title="Palette Studio — palette and CSS tokens from an image"
  loading="lazy"
  style={{width: '100%', height: '820px', border: 0, borderRadius: '12px'}}
/>

This is a working design-system tool: drop a logo or screenshot, get a palette,
edit the swatches, check WCAG contrast and copy CSS variables, JSON or a PNG. The
image never leaves the browser — the pixels are read by `palette.wasm`.

```latent
fn bin_of(r: int, g: int, b: int) -> int {
    // 3 bits per channel: 512 bins, enough for 5–8 brand colours.
    return (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
}
```

The app ships a JS twin of the same algorithm on `Uint32Array`. "Compare with JS"
runs both on identical pixels and reports the median: on a 480×293 image Latent is
consistently faster, and the palettes match. It is not a synthetic benchmark —
same file, same data, same result.

App limits: sRGB, 3-bit quantisation, alpha &lt; 128 is skipped, the image is
downscaled to 480 px, and contrast is computed on the host. For precise
colorimetry and OKLCH you need a different tool.

## Performance: benchmark, images, physics

Three demos about dense computation and predictable memory. They are not about CSP
or AI — they show that `int` is exactly `i32`, that `alloc` is explicit, and that a
hot loop does not depend on JIT mood.

<iframe
  src="/latent/demos/bench/?embed=1"
  title="Latent vs JavaScript — interactive benchmark"
  loading="lazy"
  style={{width: '100%', height: '780px', border: 0, borderRadius: '12px'}}
/>

```latent
// FNV-1a over a 1 MiB byte buffer, `rounds` passes.
fn main(n: int, rounds: int) -> int {
    let ptr = load32(8);
    if (ptr == 0) {
        ptr = alloc(n + 8);
        store32(8, ptr);
    }
    let h = 0 - 2128831035;
    let r = 0;
    while (r < rounds) {
        let i = 0;
        while (i < n) {
            h = (h ^ load8(ptr + i)) * 16777619;
            i = i + 1;
        }
        r = r + 1;
    }
    return h;
}
```

- <a href="/latent/demos/bench/">Benchmark</a>: five algorithms, identical inputs,
  checksum parity, median of three runs.
- <a href="/latent/demos/image/">Images</a>: grayscale, box blur, Sobel, threshold
  over `ImageData`; a WASM/JS switch and a comparison slider.
- <a href="/latent/demos/physics/">Physics</a>: up to 30,000 particles, three
  attractors, an FPS graph and bit-for-bit parity with the JS twin.

For short calls, JS↔WASM overhead can eat the win; the demos show that too. The
numbers are live and machine-dependent.

## How it works

```
docs/static/demos/
├── index.html                 # demo hub
├── assets/
│   ├── demo.css               # shared shell of the old demos
│   ├── killer.css             # design system for the five new demos
│   ├── killer.js              # highlighter, CodeViewer, EnhancedEditor, canvas
│   ├── wasm.js                # fetch/instantiate, compiler C ABI
│   └── bench.js / imaging.js / physics.js
├── vendor/compiler/           # engine #1 (ESM) copy — generated by build-demos
├── concurrency/               # index.html + killer-programs.js + killer-concurrency.js
├── ai/                        # index.html + killer-ai.js
├── selfhost/                  # index.html + killer-selfhost.js + seed.wasm + shc.lat
├── sandbox/                   # index.html + killer-sandbox.js
├── modules/                   # index.html + killer-modules.js
├── bench/  image/  physics/   # old demos (WASM modules built by build-demos)
├── compiler.wasm              # compiler for sandbox/modules
└── build-demos.mjs            # vendor copy + seed/shc + .lat → .wasm + smoke run
```

1. **Prepare artifacts.** `build-demos.mjs` copies `web-ide/compiler/**` to
   `demos/vendor/compiler/` (the ESM interpreter), and `selfhost/seed.wasm`,
   `seed.json`, `shc.lat` to `demos/selfhost/`; then it compiles the old demos'
   `.lat` files with `compiler.wasm` and smoke-runs them.
2. **Execute.** The new demos import the interpreter from vendor and execute
   Latent code in the browser; sandbox/modules take `compiler.wasm` (engine #2)
   and the `latent_compile` / `latent_compile_files` ABI.
3. **Isolate.** Sandbox runs wasm in a Web Worker with one import and terminates
   on timeout; selfhost also compiles in a Worker (30 s limit).
4. **Measure.** Time, sizes, sha256, imports, memory and events come from real
   calls; the animation only presents data that already exists.
5. **Stay offline.** No CDN, fonts or bundler: relative paths, local `fetch`, and
   browser APIs only.

The full ABI is in [WASM ABI](../reference/wasm-abi.md), modules in the
[modules guide](../guide/modules.md), self-host in the
[self-host spec](../specs/selfhost.md).

## Where Latent does not win

- **Parallelism.** Engine #1 is a cooperative single-threaded scheduler; it is not
  multi-threading and not a core-count speedup.
- **AI by default.** Embeddings and inference are mocks; a real gateway is optional
  and limited by CORS/provider.
- **Sandbox.** It isolates wasm capabilities, not the OS; the compiler and the
  browser are trusted.
- **Self-host.** Seed is a trusted point, part of the host-only corpus does not
  compile, and the timeout is protection, not infinite power.
- **Performance.** JS can win on short calls; the advantage is predictable memory
  and the absence of GC pauses, not "WASM is always faster".

## Running and checking

The demos need no build. Serve `docs/static/` with any static server:

```bash
# from the repo root
python -m http.server 8000 --directory docs/static
# open http://localhost:8000/demos/
```

Rebuild the artifacts after edits:

```bash
node docs/static/demos/build-demos.mjs            # vendor + seed/shc + .wasm + smoke
node docs/static/demos/build-demos.mjs --no-verify
node docs/scripts/validate-examples.mjs           # every ```latent block
cd docs && pnpm run build                         # site and broken links
```

`build-demos.mjs` uses `web-ide/compiler.wasm` (override with
`LATENT_COMPILER_WASM`). The five new demos do not depend on `demo.css` — they ship
their own `assets/killer.css`, so a hub redesign cannot break them.

## What to try

1. In **goroutines**, press "1000 goroutines" and watch the peak alive count vs the
   single running goroutine; then press "Deadlock" and let the runtime stop it.
2. In **AI**, change the prompt and documents, press "Recalculate", and hover a
   heatmap cell: the values come from the interpreter's `cosine_similarity`.
3. In **selfhost**, wait for FIXED POINT, compare the sha256 of all stages, then
   pick `fib.lat` and see `main() = 55`.
4. In the **sandbox**, run "infinite loop", then "OOB access" and `memory.grow`:
   the log shows terminate, trap and 1025 pages.
5. In **modules**, switch to "cycles allowed", run, and look at the `a.lat ↔ b.lat`
   cycle in the graph; then "missing import" for a path-level error.
6. In **Palette Studio**, upload your own screenshot, edit one swatch, copy the CSS,
   and press "Compare with JS" — you get the real median for your image, not a
   number from a slide.

## Related sections

- [WASM ABI](../reference/wasm-abi.md) — `main`, `memory`, strings, arrays, the
  compiler C ABI.
- [Modules](../guide/modules.md) — v1 syntax, semantics and linking.
- [Self-host](../specs/selfhost.md) — fixed point and bootstrap.
- [Concurrency](../guide/concurrency.md) — `spawn`, `channel`, `select`.
- [AI primitives](../guide/ai-features.md) — `ai_infer`, `ai_embed`, tensors.
- [Web IDE](../tooling/web-ide.md) — a playground with two engines.
