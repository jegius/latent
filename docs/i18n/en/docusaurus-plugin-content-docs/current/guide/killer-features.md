---
title: "What Latent gives the frontend"
sidebar_label: "Features and limits"
sidebar_position: 16
description: "Seven things Latent brings to the frontend — CSP in the language, AI primitives, a self-hosted compiler, a WASM sandbox, GC-free memory, modules, and two engines — with code, live demos, and a sober look at the limits."
---

# What Latent gives the frontend

Latent does not replace React, Vue or TypeScript. Its niche is a computational
WASM core next to the UI: data, canvas/audio/physics, parsing, AI. No server is
needed: concurrency and AI are written in the grammar, the compiler can compile
itself, and memory is deterministic.

Below are seven things worth trying — and where they stop. Blocks marked
`// host-only` run in engine #1; the rest are checked by the engine #2 compiler
when the documentation is built.

:::note What this page is about

Latent is not "JS but better" and not a framework replacement. It is a language
for the core: a small WASM module with a single import, `env.print`, where CSP,
AI and self-hosting are part of the syntax; the UI, DOM, network and state stay in
JS/TS.

:::

## Seven things

| # | Feature | What it gives the frontend | Where it runs | Demo |
|---|---|---|---|---|
| 1 | [CSP in the language](#1-csp-concurrency-in-the-language) | `spawn`, channels, `select`, `yield` as syntax | engine #1 | <a href="/latent/demos/concurrency/">concurrency</a> |
| 2 | [AI primitives](#2-ai-primitives-as-syntax) | `ai_infer`, `ai_embed`, `ai_stream`, `tensor` | engine #1 (mock/gateway) | <a href="/latent/demos/ai/">ai</a> |
| 3 | [Self-host](#3-self-hosted-compiler-in-the-browser) | `seed.wasm` compiles Latent in the browser | WASM + Node.js | <a href="/latent/demos/selfhost/">selfhost</a> |
| 4 | [Sandbox](#4-a-wasm-sandbox-by-construction) | a single `env.print` import | engine #2 | <a href="/latent/demos/sandbox/">sandbox</a> |
| 5 | [GC-free memory](#5-deterministic-memory-without-gc) | bump allocator, stable frames | engine #2 | <a href="/latent/demos/physics/">physics</a> |
| 6 | [Modules and chunks](#6-modules-and-lazy-chunks) | multi-file projects + a small start | v1: Rust + IDE | <a href="/latent/demos/modules/">modules</a> |
| 7 | [Dual-engine](#7-two-engines-one-source) | host features in the browser + a WASM compiler | both engines | <a href="/latent/demos/">hub</a> |

## 1. CSP concurrency in the language

**How it works.** `spawn`, `channel()`, `select`, `yield`, `ch <- v`, and `<-ch` are keywords and
syntax, not an import from a package. Engine #1 runs them on a cooperative scheduler: `send` puts a
value into the channel queue, `recv` yields to the scheduler while the queue is empty, `select`
waits for the first ready channel, and `yield` voluntarily gives up control.

```latent
// host-only: channels and the scheduler belong to engine #1; engine #2 rejects channel.
fn worker(jobs: channel, results: channel, count: int) {
    for (let i = 0; i < count; i = i + 1) {
        let job = jobs.recv();
        results <- job * job;
    }
}

fn main() -> int {
    let jobs = channel();
    let results = channel();
    for (let w = 0; w < 4; w = w + 1) { spawn worker(jobs, results, 4); }
    for (let j = 1; j <= 16; j = j + 1) { jobs <- j; }
    let total = 0;
    for (let k = 0; k < 16; k = k + 1) { total = total + <-results; }
    return total;
}
```

**What it gives.** A worker pool, fan-out/fan-in, and `select` take a dozen lines with no
dependencies. JS has no channels: you need a library or a hand-rolled Promise queue with
`AbortController`, and `Promise.race` cannot "wait for the first ready channel" as naturally.

**Where the limit is.** This is concurrency, not parallelism: one thread, no preemption, and a long loop
without `yield`/`recv` blocks the other goroutines. There is no cancellation, timeouts, or
priorities; for real parallelism JS has Web Workers, and channels are executed only by engine #1 — a
host feature, not WASM code.

**Try it.** <a href="/latent/demos/concurrency/">/latent/demos/concurrency/</a> — the scheduler,
1,000 goroutines, a worker pool, a `select` race. Theory: [Concurrency](./concurrency.md), [example
walkthrough](../examples/concurrency.md).

## 2. AI primitives as syntax

**How it works.** `ai_infer`, `ai_embed`, `ai_stream`/`stream_next`, `tensor`, `semantic`, `matmul`,
`cosine_similarity`, `ai_generate!` are built-in functions and keywords. The parser sees them, and
so do the IDE, the MCP server, and the linter: this is not an SDK you have to install. In the
browser engine #1 runs them: with a provider — the real gateway, without one — a deterministic mock
(an 8-dimensional embedding).

```latent
// host-only: engine #1 runs the AI primitives (mock or gateway).
fn main() -> int {
    print(ai_infer("gpt-4", "Explain CSP in one sentence"));
    let query = ai_embed("CSP concurrency in a language");
    let docs = ["goroutines and channels", "promise chains in JavaScript"];
    for (let i = 0; i < docs.length; i = i + 1) {
        print("similarity:", cosine_similarity(query, ai_embed(docs[i])));
    }
    return 0;
}
```

**What it gives.** In JS an AI call is `fetch` + JSON + manual parsing: types are lost,
streaming is hand-written, and tooling sees nothing but a string. In Latent
`ai_stream`/`stream_next` are part of the language, and `ai_embed` returns a vector for
`cosine_similarity`/`matmul`. The mock is deterministic, so demos and tests work offline, without
keys or CORS.

**Where the limit is.** The call still goes to the host: engine #2 rejects these primitives with a
"requires a host runtime" error. There are no typed responses, schemas, retries, or token
accounting; streaming is an iterator without backpressure; keys and CORS are the host's concern. In
production the call is almost always made by JS or the backend.

**Try it.** <a href="/latent/demos/ai/">/latent/demos/ai/</a> — prompt → embedding → heatmap → infer
→ streaming, an offline mock. Theory: [AI primitives](./ai-features.md), [AI
walkthroughs](../examples/ai.md).

## 3. Self-hosted compiler in the browser

**How it works.** The Latent compiler is written in Latent itself (`selfhost/shc.lat`) and built to
WASM. `selfhost/seed.wasm` (≈41 KB) is a working self-hosted compiler that needs neither Rust,
nor `cargo`, nor a server. The bootstrap chain reaches a **fixed point**: the third stage is
byte-for-byte identical to the second.

```text
seed.wasm --(shc.lat)--> stage1' --(shc.lat)--> stage2' --(shc.lat)--> stage3'
stage2' === stage3'                         FIXED POINT (byte-for-byte)
```

So in the browser you can take `seed.wasm`, feed it a source file, and get a valid WASM module —
with no request to a compilation server:

```latent
fn main() -> int {
    print("compiled in the browser");
    return 0;
}
```

**What it gives.** The compiler is an asset, not a service: no backend, no queue, no source-code
leak, and it works offline. For a playground this is a full toolchain in a `.wasm` of a few dozen
kilobytes.

**Where the limit is.** The seed is a snapshot of the compiler: to add a new language construct you
still need Rust once (`--update-seed`). It compiles a subset (without host features), has no source
maps or optimizations, and caches by source only.

**Try it.** <a href="/latent/demos/selfhost/">/latent/demos/selfhost/</a> — loading the seed,
compiling, hashes, the fixed point. Theory: [self-host spec](../specs/selfhost.md), [WASM and
execution](./wasm-and-execution.md).

## 4. A WASM sandbox by construction

**How it works.** A compiled module exports `memory` and `main`, and imports **exactly one** function
— `env.print(i32)`. It has no access to the DOM, `fetch`, `localStorage`, timers, or random numbers:
those imports do not exist rather than being "forbidden by policy". All the module can do to the
world is ask the host to print a string from memory.

```js
// The host gives the module print only — nothing else.
const imports = {env: {print: (ptr) => readAndLog(instance, ptr)}};
const {instance} = await WebAssembly.instantiate(bytes, imports);
instance.exports.main();
```

```latent
fn main() -> int {
    let buf = alloc(16);
    store32(buf, 42);
    print("stored:", load32(buf));
    return 0;
}
```

**What it gives.** `eval` and `new Function` run code with full page privileges: DOM, cookies,
network, prototypes. A Latent module has no ambient authority by construction: to allow something,
the host must pass an import explicitly. For generated AI code and plugins that is a qualitatively
different security model.

**Where the limit is.** The sandbox does not limit CPU or memory by itself: an infinite loop must be
killed via a Worker + `terminate`, and `memory.grow` must be capped on the host (modules have no
fuel or timeouts). There is no capability API beyond `print`, and array bounds are not checked.

**Try it.** <a href="/latent/demos/sandbox/">/latent/demos/sandbox/</a> — editor → `compiler.wasm` →
Web Worker, "attacks", the capability list, and the isolation log. Theory: [Latent in the
frontend](./web-and-frontend.md), [WASM ABI](../reference/wasm-abi.md).

## 5. Deterministic memory without GC

**How it works.** A module has its own linear memory: 16 pages of 64 KiB at the start, growing through
`memory.grow`. The allocator is a **bump** allocator: its only operation is moving the heap pointer
forward. There is no garbage collection and no `free`, hence no unpredictable pauses.

```latent
// Bump allocator: allocation only moves forward, there is no deallocation.
fn main() -> int {
    let frame = alloc(64);
    let i = 0;
    while (i < 16) {
        store32(frame + i * 4, i * i);
        i = i + 1;
    }
    print("frame[15]:", load32(frame + 60));
    return 0;
}
```

For animation this is convenient: the frame buffer is allocated once and overwritten instead of
being recreated on every `requestAnimationFrame`. The physics demo shows this on a frame-time graph:
JS has GC spikes, the Latent core has a flat line.

**What it gives.** No GC pauses and no p99 growth; memory is predictable and laid out by hand;
the runtime is tiny. For audio (a dropped buffer is not an option), canvas, and physics, a stable
frame matters more than average speed.

**Where the limit is.** Memory only grows: a long-lived page must recreate the instance or reuse
buffers. `push` does not reserve capacity and may write past the allocated block; there is no `free`
or arenas — for a long-running CRUD app, JS GC is more convenient.

**Try it.** <a href="/latent/demos/physics/">/latent/demos/physics/</a> ·
<a href="/latent/demos/">/latent/demos/</a> · [Memory](./memory-and-low-level.md).

## 6. Modules and lazy chunks

**How it works.** Two related things. **Lazy chunks** already work in the playground: WASM is an
asset, not an entry point, so the loader hides behind `dynamic import()`, and `manualChunks` splits
the bundle into `engine2`, `ai`, `editor`, `examples`, and `core`. **Modules** — file-level
`import`/`export` with link-time resolution — are implemented in v1: `export` before a top-level
`fn`/`class`/`enum`, named imports with aliases, two-phase linking with name mangling, and import
cycles allowed.

```text
// math.lat
export fn square(x: int) -> int { return x * x; }

// main.lat
import { square as sq } from "./math.lat";
fn main() -> int { return sq(6); }
```

After linking, one program remains:

```latent
fn square(x: int) -> int { return x * x; }
fn main() -> int { return square(6); }
```

:::caution Module status

Modules v1 are already in the compiler: `latent::compile_files`,
`latentc compile/check/bundle`, and the `latent_compile_files` ABI for the
browser, plus support in both web IDE engines. Syntax, linking and the v1 limits
are on the [file modules](./modules.md) page. Lazy chunks are already in
production — see the [frontend guide](./web-and-frontend.md).

:::

**What it gives.** An import is part of the language, not a runtime loader: names are resolved
at link time, WASM needs no module resolver, and a project builds without a bundler. Lazy chunks
shrink the starting bundle: the core `.wasm` is not downloaded until the user runs a computation.

**Where the limit is.** v1 is deliberately narrow: named imports only, no `export *`, `import * as ns`,
dynamic imports, or a package manager. There is no ecosystem or npm; the self-hosted compiler
consumes a flat `bundle`, not a file tree.

**Try it.** <a href="/latent/demos/modules/">/latent/demos/modules/</a> — the file tree, module
graph, build, and run. Theory: [lazy chunks](./web-and-frontend.md), [web
IDE](../tooling/web-ide.md).

## 7. Two engines, one source

**How it works.** The same `.lat` can be executed and compiled. **Engine #1** is a tree-walking
interpreter in JS: a full browser runtime, including channels, `select`/`yield`, AI, tensors, and
contracts. **Engine #2** is a Rust compiler built to WASM: it turns a subset of the language into a
valid WASM module. The playground picks the engine itself: Run always executes #1, host features and
#2 errors fall back to #1 transparently, and #2 is responsible for the WASM tab and explicit
compilation.

| | Engine #1 | Engine #2 |
|---|---|---|
| What it does | **executes** the program | **compiles** it to WASM |
| Where it lives | `web-ide/compiler/` (JS) | `web-ide/compiler.wasm` (Rust) |
| Host features (channels, AI, tensors) | yes | no, a host-runtime error |
| `enum`, bitwise operators, block comments | no | yes |

```latent
fn main() -> int {
    print("same source, two engines");
    return 0;
}
```

**What it gives.** One source lives two lives: a teaching example in the browser and a WASM core
on the page. There is no separate toolchain for "play" and "deploy": the playground is the IDE, the
compiler, and the runtime, plus self-repair on errors.

**Where the limit is.** Two engines mean double semantics and double maintenance. The divergences are
real: `7 / 2` is `3.5` in #1 and `3` in #2, `"привет".length` is `6` versus `12`, `[1] == [1]` is
`true` versus `false`. #2 does not execute code, and `float` is fragile in it. Move code between
engines with the [difference table](./wasm-and-execution.md#engine-differences) at hand.

**Try it.** The hub is <a href="/latent/demos/">/latent/demos/</a>. Theory: [the two web IDE
engines](../specs/engines.md), [WASM and execution](./wasm-and-execution.md).

## Limits

**Where JS/TS is better.** UI, DOM, forms, routing, and state are the territory of React/Vue/Svelte
with DevTools, source maps, and a huge ecosystem. npm, types, ready-made components, and hiring:
Latent has almost no standard library and no packages, and modules are a narrow v1. Strings and `f64`:
in JS these are UTF-16 and `Float64Array` out of the box, in Latent they are UTF-8 bytes and an
invalid `[float]`. Long-lived applications: JS GC frees memory, while in Latent it only grows. And
JIT-friendly code: dense numeric loops in JS are already fast.

**Where WASM is not always faster.** Short calls: every boundary crossing is an `i32`/`f64` and
pointers, and thousands of small calls are slower than one JS loop. Small data: copying a
string/array into linear memory and back can cost more than the computation. Startup: `fetch` +
`compile` + `instantiate` takes tens of milliseconds. Latent wins on predictability, not on every
benchmark.

| Trade-off | Status |
|---|---|
| No GC and no `free`, bump allocator | **Stays**: predictability over reuse |
| Modules/imports | **v1 implemented** (Rust, CLI, ABI, engine #1); no `export *` or packages |
| Classes without inheritance; no exceptions, `break`/`continue`, generics | **Stays** (return codes, `Result`) |
| `float` is fragile in #2, `[float]` is invalid | **Stays**; use fixed point |
| Divergences between engines #1/#2 | **Mitigated** by auto-fallback, the difference table is relevant |
| Only `main` and `env.print` in the ABI | **Stays**; function exports are on the roadmap |

## How to choose

| Scenario | Latent? | Why |
|---|---|---|
| Computational core (parsing, aggregation, validation) | **Yes** | a small module, no GC, predictable memory |
| Canvas/audio/physics, stable frames | **Yes** | bump allocator and no GC pauses |
| AI features in the browser (mock/gateway, embeddings) | **Yes, as a prototype** | AI primitives in the syntax, offline demos |
| Untrusted or generated code | **Yes** | a WASM sandbox with a single import |
| Learning, playground, "code in the browser" | **Yes** | a self-hosted compiler with no server |
| SPA, CRUD, DOM, forms | **No** | that is JS/TS and framework work |
| Heavy ML, `f64` vectors, matrices | **Not yet** | no `f64` arrays or `i64`; compute in JS |
| npm libraries and a large team | **No** | no ecosystem or packages (modules are v1 only) |

## Task → why Latent

| Task | Feature | Demo and docs |
|---|---|---|
| Producer/consumer, worker pool, fan-in | CSP in the language | <a href="/latent/demos/concurrency/">concurrency</a> · [guide](./concurrency.md) |
| Prompt → embedding → similarity | AI primitives | <a href="/latent/demos/ai/">ai</a> · [guide](./ai-features.md) |
| Compiling code in the browser with no server | self-host + fixed point | <a href="/latent/demos/selfhost/">selfhost</a> · [spec](../specs/selfhost.md) |
| Running someone else's code safely | WASM sandbox | <a href="/latent/demos/sandbox/">sandbox</a> · [frontend](./web-and-frontend.md) |
| Stable 60 fps without GC spikes | GC-free memory | <a href="/latent/demos/physics/">physics</a> · [memory](./memory-and-low-level.md) |
| A multi-file project in the browser | modules + chunks | <a href="/latent/demos/modules/">modules</a> · [frontend](./web-and-frontend.md) |

The full list of limitations, with priorities and workarounds, is in the
[register](../specs/limitations.md); the order in which they will be removed is in
the [roadmap](../specs/roadmap.md).
