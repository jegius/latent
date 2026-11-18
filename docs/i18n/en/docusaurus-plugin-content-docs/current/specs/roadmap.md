---
title: "Latent roadmap"
sidebar_label: "Roadmap"
sidebar_position: 11
description: "The Latent plan: compiler stabilisation, language, ABI, concurrency, modules, self-host, AI and tooling. With exit criteria and links to the limitations register."
---

# Latent roadmap

This plan started from one question: what stops Latent from being used for work
rather than for a demo. The answer was boring — not "add more features", but first
stop silently emitting invalid WASM and losing memory past array bounds. So the
roadmap starts with stabilisation, not with new keywords.

Phases have no dates. A date appears when there is an owner and an exit criterion;
otherwise it is a wish list. `Lxx` IDs come from the
[limitations register](./limitations.md).

## Where we are

- **Language.** Classes, `enum` + `match`, lambdas, arrays/strings, `async`/`await`,
  CSP concurrency, AI primitives, tests/contracts, low-level memory.
- **Engines.** A JS interpreter (host features, fast start) and a Rust→WASM
  compiler (valid WASM for a subset, `main`/`memory`/`env.print` ABI).
- **Modules.** `import`/`export`, two-phase linking, `latentc compile/check/bundle`,
  the `latent_compile_files` C ABI in the browser, support in both web IDE engines.
- **Self-host.** `seed.wasm` (≈41 KiB) compiles `shc.lat` (≈164 KiB), fixed point,
  Rust-free bootstrap.
- **Tooling.** Web IDE, playground, VS Code, IntelliJ IDEA, LSP, MCP docs server,
  nine browser demos and an app.
- **Docs.** Two languages, compiler-verified examples, a limitations register and
  this plan.

The strengths are visible: a compact compiler that can be read end to end;
self-hosting as a living test; modules with deterministic mangling; demos that do
not fake execution. The weaknesses are visible too: codegen does not validate
itself, memory is unchecked, and the difference between engines is too large to
ignore.

## Principles

1. **An honest error beats a silent substitution.** If engine #2 cannot do
   `spawn`, it should say so rather than run it sequentially.
2. **One source — two runtimes.** Until that is true, the differences must be
   listed and tested.
3. **Small core, serious tooling.** The language does not have to grow a huge
   standard library; the tools must be predictable.
4. **ABI before optimisation.** There is no point speeding up code that JS cannot
   call with arguments.
5. **Every feature ships with a test and a limitations paragraph.** Otherwise the
   docs will promise more than the code does.

## Phases

### Phase 0. Compiler stabilisation

**Goal:** stop emitting invalid WASM and silently corrupting memory.

- Validate the result inside the compiler and return an error with a position
  (`L01`, `L09`, `D01`).
- A `safe` mode: bounds checks, `pop`/`push`, traps with messages
  (`L02`, `D02`).
- Array comparison and `assert_eq` by content (`L03`, `D03`).
- Numeric edges: `i32::MIN`/large `f64`, division by zero (`L06`, `D06`).
- Remove silent #2 surrogates (`L07`, `D07`).
- Parity tests for every documentation example (`L08`, `L25`, `D08`).

Closed in this iteration: BOM (`L04`, `D04`), builtin arity (`L05`, `D05`) and
string `==`/`<`/`>`/`assert_eq` (part of `L03`).

**Exit criterion:** `latentc compile` never returns an invalid module for any
example in `web-ide/examples` or `docs`; every studied defect is closed by a test
or explicitly marked.

### Phase 1. A language without workarounds

- `break`/`continue`, `if` expressions, compound assignment (`L13`, `D12`).
- `Result<T,E>` + `?` and trap-free errors at the ABI boundary (`L12`, `D11`).
- Lexing: hex/bin/underscore, escapes, large-integer precision (`L29`).
- `const`, doc comments, string interpolation — after the syntax settles (`L30`).

**Exit criterion:** the `web-ide/examples` programs can be rewritten without
`while`-flags and manual error codes; both engines cover the new constructs.

### Phase 2. ABI and memory

- `export fn` with parameters and results, a host import list (`L10`, `D09`).
- `arena`/`reset`, then a free strategy (`L11`, `D10`).
- `i64`, `[f64]`, float ABI (`L18`, `D17`).
- Source maps/name section for traps (`L23`, `D20`).

**Exit criterion:** JS can call `parse(ptr,len)` and get a `Result` without going
through `main`; a long-lived page does not grow without `reset`.

### Phase 3. Concurrency

- Bounded channels and backpressure (`L15`, `D14`).
- `select` with send, `default`, timeouts; cancellation.
- A fair queue, structured concurrency (`scope`/`join`), and an explicit
  "host runtime, not WASM" boundary.
- Either honest emulation in WASM (Worker + SharedArrayBuffer) or a documented
  refusal.

**Exit criterion:** a worker pool cannot drown in an unbounded queue; cancellation
actually stops a goroutine; CSP examples pass parity tests or are explicitly
marked host-only.

### Phase 4. Modules and packages

- Re-export, namespace, directories, `import * as` (`L14`, `D13`).
- Incremental linking and a graph cache, not a file cache.
- Packages/registry — after a stable v2, not earlier (`L26`).
- Web IDE: directory tree and workspace persistence (`L20`, `D19`).

**Exit criterion:** a 10+ module project builds without flat names and manual
aliases; self-host accepts the bundle of the same project.

### Phase 5. Self-host and performance

- Corpus coverage without hangs; compile speed; bundle modules (`L17`, `D16`).
- `wasm-opt`, name section, module size (`L33`, `D24`).
- Rust-free seed updates, reproducible builds.

**Exit criterion:** `node selfhost/bootstrap-wasm.mjs` passes on a clean checkout;
`shc.lat` compile time does not regress; every corpus example either compiles or
returns a clear error.

### Phase 6. AI runtime

- Real embeddings through a gateway, caching and offline fallback (`L16`, `D15`).
- `ai_generate!` as lowering to `ai_infer` + parsing, not a separate magic trick.
- Response schemas, retries, token accounting, streaming backpressure.
- Contracts and snapshots for AI functions.

**Exit criterion:** the demo works offline and with a real provider;
`ai_generate!` runs in at least one engine; network errors are visible.

### Phase 7. Tooling and ecosystem

- One `compiler.wasm` across plugins; IDEA does not lag behind (`L21`, `D20`).
- Semantic LSP, formatter, DAP, error codes (`L34`, `D23`).
- npm package, TS types, Vite plugin (`L26`, `D24`).
- Test runner and tests in both engines (`L24`, `D22`).

**Exit criterion:** `npm i @latent/core` + `import {compile}` works without
copying files from the repository; an IDE error points to a line, not an offset.

## New features

Ratings: **value** for real programs, **effort**, **risk** to stability. These are
proposals, not commitments.

| Feature | Why | Value | Effort | Risk | Phase |
|---|---|---|---|---|---|
| `export fn` + host ABI | a module as an API, not one `main` | high | medium | medium | 2 |
| `Result`/`?` | errors without traps | high | medium | low | 1 |
| `Option`/nullable | `null` is `0` today and indistinguishable from a number/pointer | medium | medium | medium | 1 |
| Bounds-checked `safe` | untrusted code without memory corruption | high | medium | medium | 0 |
| `break`/`continue`/`if`-expr | remove flags and `while(true)` | high | low | low | 1 |
| `i64`/`[f64]` | ML, precise arithmetic, ABI | high | high | high | 2 |
| Bounded channels + select send/timeout | predictable concurrency | high | medium | medium | 3 |
| Structured concurrency | cancellation and ownership of goroutines | medium | high | high | 3 |
| `arena`/`reset` | long-lived pages | high | medium | medium | 2 |
| Modules v2 + namespaces | larger projects | high | high | medium | 4 |
| Packages/registry | ecosystem | medium | very high | high | 5+ |
| `std` in Latent | collections and strings | medium | high | low | 6 |
| Test runner | CI without an IDE | medium | low | low | 7 |
| `const`, doc comments, interpolation | readability | medium | low | low | 1 |
| Debugger/DAP | real development | high | high | low | 7 |
| WASI/threads | server-side and parallel WASM | medium | very high | high | 8 |
| Incremental compilation | large projects | medium | high | medium | 5 |

### What to improve in what already exists

- **Type checker.** Annotations are parsed but not checked; use them for float
  context, arity and comparisons. That is cheaper than fixing codegen one case at
  a time.
- **Codegen.** Choose instructions by type, not by syntax; validate the module
  before returning it; emit a name section.
- **Memory.** Keep the bump allocator for frames, add an arena and `reset`; keep
  bounds checks in `safe`, out of the hot path.
- **Strings.** UTF-8 bytes today, but length in #1 is UTF-16; settle on one
  definition and provide `byte_len`/`chars`.
- **Modules.** The linker is already deterministic; the next step is namespaces
  and re-export, not a package manager.
- **Self-host.** It compiles itself but not the whole corpus; coverage and clear
  errors first, speed second.
- **AI.** Mocks are useful for tests, but users need a real provider and typed
  output; `ai_generate!` should become lowering, not a promise.
- **Tooling.** LSP diagnoses through the compiler but has no semantics; IDEA lags
  on `compiler.wasm`; there is no test runner.

## Out of scope

- Garbage collection — the niche is deterministic memory.
- A full UI framework and DOM — that is JS/TS.
- Class inheritance — composition and `match` cover the cases.
- An npm-style registry in phases 0–4.
- "WASM is always faster" — not the goal; predictability is.

## How progress is measured

- **Correctness:** share of examples that pass `validate()`; number of open P0s.
- **Parity:** share of examples with identical output in both engines.
- **ABI:** functions exported and callable from JS without wrappers.
- **Memory:** page/RSS growth over a long run without `reset`.
- **Speed:** `shc.lat` compile time, module size, p95 frame time in physics.
- **Docs:** every `latent` block compiles or is marked; every limitation has an
  `Lxx`.

## Mapping to the register

| Phase | Limitations |
|---|---|
| 0 | L01–L03, L06–L09 (L04, L05 closed) |
| 1 | L12–L13, L29–L30, L41–L42, L44, L46 |
| 2 | L10–L11, L18, L23, L47 |
| 3 | L15 |
| 4 | L14, L20, L26 |
| 5 | L17, L33 |
| 6 | L16, L22 |
| 7 | L19, L21, L24, L34, L43 |
| out of scope | L35–L40 |

If a limitation does not fit any phase, that is a plan bug, not "later".
