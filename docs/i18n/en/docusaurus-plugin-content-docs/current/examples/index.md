---
title: "Example walkthroughs"
sidebar_label: Walkthroughs
sidebar_position: 1
description: "Navigation through the walkthroughs of the Latent language examples: basics, algorithms, concurrency, AI, OOP, functional style. The code comes from web-ide/examples together with the output values shown in the web IDE."
---

# Example walkthroughs

The walkthroughs here cover the files in `web-ide/examples/` — the same files you
open in the web IDE. Each one gives the code, an explanation, the console output
on **Run** (engine #1) and the differences when compiling with engine #2. When an
example behaves differently from what you would expect, the reason is usually in
the [limitations register](../specs/limitations.md).

| Walkthrough | Examples from `web-ide/examples/` |
|---|---|
| [Basics](./basics.md) | `variables_types.lat`, `operators.lat`, `control_flow.lat`, `functions.lat`, `builtins_methods.lat`, `arrays.lat`, `strings.lat` |
| [Algorithms](./algorithms.md) | `recursion.lat`, `sorting.lat` |
| [Concurrency](./concurrency.md) | `channels.lat`, `parallel_sum.lat`, `select_yield.lat` |
| [AI and tensors](./ai.md) | `ai_infer.lat`, `ai_embed.lat`, `ai_streaming.lat`, `ai_pipeline.lat`, `tensors.lat`, `testing_contracts.lat` |
| [OOP](./oop.md) | `classes.lat` |
| [Functional style](./functional.md) | `fp_patterns.lat`, `lambdas.lat` |
| [Modules](./modules.md) | the multi-file project `math.lat` + `model.lat` + `main.lat` |

## Web and frontend

A separate series of self-contained cases — Latent as a WASM core in the browser
(each one contains the `.lat` module, the JS glue, and a walkthrough of what you
see on the page):

| Case | What it teaches |
|---|---|
| [Calculator](./frontend-calculator.md) | an expression parser in Latent; a constant in the source and on-the-fly compilation through `compiler.wasm` |
| [Data and arrays](./frontend-data-processing.md) | passing `[len][i32...]` through memory, sorting/aggregation, reading the result |
| [Strings and UTF-8](./frontend-strings.md) | `[len][utf8]`, byte length and indexing, `load8` |
| [React](./frontend-react.md) | a component in TypeScript, `useEffect` + `ref`, Vite |
| [Canvas](./frontend-canvas.md) | WASM computes a frame or a sorting step, canvas draws it |
| [Compiler in the browser](./frontend-compiler-playground.md) | `latent_alloc`/`latent_compile`/`latent_free`, your own playground |
| [Interactive demos](./frontend-showcase.md) | eight browser demos: goroutines and channels, AI primitives, self-host, sandbox, modules, benchmark, image filters and physics |

## Demos

Five new self-contained demos execute real Latent code right on the page; the older
ones put it under real load:

| Demo | What it shows |
|---|---|
| <a href="/latent/demos/concurrency/">Goroutines and channels</a> | `spawn`, `channel`, `select`, `yield`: scheduler trace, fan-in, worker pool, 1000 goroutines, deadlock |
| <a href="/latent/demos/ai/">AI-native</a> | `ai_embed`/`cosine_similarity`/`ai_infer`/`ai_stream`/`tensor`/`matmul`, heatmap and streaming |
| <a href="/latent/demos/selfhost/">Self-host</a> | `seed.wasm` compiles `shc.lat`: stages, sha256, FIXED POINT, sample run |
| <a href="/latent/demos/sandbox/">Sandbox</a> | untrusted code in a Worker with one import: timeout, OOB trap, memory.grow |
| <a href="/latent/demos/modules/">Modules</a> | four `.lat` files, import graph, two-phase linking, mangled names, cycles |
| <a href="/latent/demos/bench/">Benchmark</a> | JS vs Latent→WASM on five algorithms |
| <a href="/latent/demos/image/">Images</a> | filters over `ImageData` and a comparison slider |
| <a href="/latent/demos/physics/">Physics</a> | up to 30,000 particles, FPS graph, parity with JS |

Each one ships its `.lat` source, live metrics and honest limits. The detailed
walkthrough is [Eight interactive demos](./frontend-showcase.md).

The general theory is in [Latent in the frontend](../guide/web-and-frontend.md)
and [Latent in the browser in 5 minutes](../getting-started/web-browser.md).

## How to run them

1. Open the [Web IDE](../tooling/web-ide.md) — the playground is built from
   `web-ide/`.
2. `File → Examples → <group> → <example>` or the `examples/` folder in the
   project tree.
3. **Run** (`Ctrl/⌘+Enter`) — execute with engine #1; **Run with AI** — with the
   AI features and self-repair.
4. To check compilation with engine #2 — **Engine #2** or the **WASM** tab (the
   program is not executed).

## What to keep in mind

- **Run executes engine #1**, not the WASM. The behavior in the console is the
  semantics of the JS interpreter.
- Engine #1 does not support bitwise operators, `str/int/float/sqrt`, block
  comments — some examples will only work in engine #2 (compilation) or only in
  #1 (execution). `enum` and file modules are supported in both engines.
- Host-only examples (AI, tensors, channels, contracts) are marked in the
  walkthroughs: engine #2 reports "requires the host runtime" on them — that is
  expected.
- The shipped `web-ide/compiler.wasm` is up to date — it is built from the
  current `src/` and includes the memory builtins (see
  [bootstrap](../tooling/bootstrap.md)); Engine #2 accepts what is described in
  this section.

## Verifying the example code

All `latent` blocks in this section are verified by the compiler
(`docs/scripts/validate-examples.mjs`); host-only blocks are marked with the first
line `// Does not compile with engine #2: ...`. Multi-file examples (the
[Modules](./modules.md) walkthrough) are marked `// module-part <file>`: they do
not compile on their own, so the validator skips and counts them separately. If
you change an example in `web-ide/examples/`, update the walkthrough as well.

## Related sections

- [Web IDE](../tooling/web-ide.md) — how to open the playground.
- [Reference](../reference/index.md) — syntax and type details.
- [Engines](../specs/engines.md) — why the behavior differs.
