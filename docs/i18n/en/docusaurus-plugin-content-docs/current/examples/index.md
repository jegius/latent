---
title: "Example walkthroughs"
sidebar_label: Walkthroughs
sidebar_position: 1
description: "Navigation through the walkthroughs of the Latent language examples: basics, algorithms, concurrency, AI, OOP, functional style. The code comes from web-ide/examples together with the output values shown in the web IDE."
---

# Example walkthroughs

The examples in this section are real files from `web-ide/examples/` (the single
source of truth for the web IDE, the tests, and the documentation). Each
walkthrough gives you the code, an explanation, what you will see in the web IDE
console on **Run** (engine #1), and the differences when compiling/running with
engine #2.

| Walkthrough | Examples from `web-ide/examples/` |
|---|---|
| [Basics](./basics.md) | `variables_types.lat`, `operators.lat`, `control_flow.lat`, `functions.lat`, `builtins_methods.lat`, `arrays.lat`, `strings.lat` |
| [Algorithms](./algorithms.md) | `recursion.lat`, `sorting.lat` |
| [Concurrency](./concurrency.md) | `channels.lat`, `parallel_sum.lat`, `select_yield.lat` |
| [AI and tensors](./ai.md) | `ai_infer.lat`, `ai_embed.lat`, `ai_streaming.lat`, `ai_pipeline.lat`, `tensors.lat`, `testing_contracts.lat` |
| [OOP](./oop.md) | `classes.lat` |
| [Functional style](./functional.md) | `fp_patterns.lat`, `lambdas.lat` |

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
| [Interactive demos](./frontend-showcase.md) | a JS-vs-WASM benchmark, image filters and particle physics; live metrics in the browser |

## Demos and performance

Three self-contained demos run right on the page and put Latent under a real
workload: [a benchmark against JS, canvas filters and particle physics](./frontend-showcase.md).
Each one ships its `.lat` source, live milliseconds and an honest comparison.

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
- Engine #1 does not support `enum`, bitwise operators, `str/int/float/sqrt`,
  block comments — some examples will only work in engine #2 (compilation) or
  only in #1 (execution).
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
line `// Does not compile with engine #2: ...`. If you change an example in
`web-ide/examples/`, update the walkthrough as well.

## Related sections

- [Web IDE](../tooling/web-ide.md) — how to open the playground.
- [Reference](../reference/index.md) — syntax and type details.
- [Engines](../specs/engines.md) — why the behavior differs.
