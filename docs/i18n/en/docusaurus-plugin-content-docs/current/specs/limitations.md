---
title: "Limitations and deferred work"
sidebar_label: "Limitations"
sidebar_position: 10
description: "The full register of Latent limitations and deferred work: codegen defects, memory, strings, engines, modules, concurrency, AI, self-host, sandbox and tooling. With P0–P3 priorities and roadmap links."
---

# Limitations and deferred work

This is not a wish list. It collects what actually limits Latent today: bugs we
would rather not show new users, workarounds, and work that was deliberately
postponed. Priorities describe the cost of the mistake, not when someone will get
to it.

- **P0** — breaks trust in the compiler or can corrupt data. Fix before inviting
  new users.
- **P1** — blocks real programs; a workaround exists, but it is not obvious.
- **P2** — a language or product limit; liveable, but visible.
- **P3** — a deliberate choice, or something that will not happen soon.

Each row has an ID (`Lxx`). The [roadmap](./roadmap.md) maps the same IDs to
phases. If you add a limitation to the docs, add it here too — otherwise the list
will drift from the code again.

## P0. Compiler trust and data safety

| ID | Limitation | What happens | Workaround | Next step |
|---|---|---|---|---|
| L01 | Engine #2 emits invalid WASM for some programs | float literals with zero fraction, annotations with a different type, `[1.5]`, mixed arithmetic, float fields/captures, `return;` in `unit`, void calls as values, `match` with void arms, `new` without `init`, void method as a statement | call `WebAssembly.validate()` on the host; docs mark such blocks as expected errors | validate the emitted module in the compiler; type-directed codegen |
| L02 | No bounds checks or safe mode | `a[N]` reads/writes out of bounds; `pop()` on an empty array reads `arr[-1]`; `push` on a string corrupts memory; `len()` with no argument reads address 0 | stay in bounds by hand; run untrusted code in a Worker | a `safe` mode with traps and messages, `raw` for low-level code |
| L03 | Strings and arrays compare differently than users expect | `< > <= >=` on strings compares pointers; `assert_eq` on strings/arrays compares i32 values | compare length and bytes manually | compare `string`/`[T]` by content; pointer comparison as a separate operation |
| L04 | BOM at the start of a file breaks the lexer | column `4294967295`, debug `latentc` may panic | save UTF-8 without BOM | skip `U+FEFF` and stop the column overflow |
| L05 | Builtin arity is not checked | extra arguments are ignored (`assert`, `len`, `str`, …); missing ones read garbage | read signatures in the reference | check arity and argument types in the type checker |
| L06 | Numeric edge cases and traps without diagnostics | `i32_to_str(i32::MIN)` overflows; `f64_to_str` traps at `|x| ≥ 2^31`; division/remainder by zero and `i32::MIN / -1` trap without a line | avoid edge values; check the divisor | correct formatting; trap with a position and a code |
| L07 | Engine #2 silently replaces concurrency semantics | `spawn` runs sequentially, `select` takes the first arm, `yield` is a no-op, `await` is passthrough, top-level code and `test` blocks are not emitted | do not compile host constructs with #2 | an error instead of a surrogate, or an explicit emulation flag |
| L08 | The engines diverge observably | `7 / 2` is `3.5` in #1 and `3` in #2; string length is UTF-16 vs UTF-8; `[1] == [1]` is `true` vs `false`; float; `enum` in #1 | the difference table and playground auto-fallback | one specification and parity tests for every example |
| L09 | No compiler diagnostic for an invalid module | only the host notices; the error is a `CompileError` without a source line | `validate()` in your loader | built-in validation plus error codes |

## P1. Real-world use

| ID | Limitation | What happens | Workaround | Next step |
|---|---|---|---|---|
| L10 | Only `main` is exported; only `print` is imported | no `parse()`/`sort()` for JS; no DOM, `fetch`, time or randomness | one entry point; JS wrappers | `export fn` with parameters/results; a versioned host import list |
| L11 | No free, arenas or GC | the bump allocator only grows; a long-lived page recreates the instance | reuse buffers; new instance | `arena`/`reset`, then freeing or ownership-lite |
| L12 | No exceptions and no ergonomic `Result` | errors are return codes, `assert` traps, there is no `?` | `Result`-like values by hand | `Result<T,E>` + `?`, a trap-free ABI boundary |
| L13 | Control flow is incomplete | no `break`/`continue`, `switch`, `if` expressions, ternary, compound assignment, `for (;;)` without `let` | `while` plus flags | `break`/`continue`, `if` expressions, `+=` and friends |
| L14 | Modules v1 are narrow | no `export *`, re-export, `import * as`, dynamic import, packages, directories in the IDE, namespace qualification | import names one by one; flat files | modules v2: re-export, namespaces, directories, packages |
| L15 | Concurrency is cooperative and has no cancellation | one thread, no preemption; a long loop blocks others; unbounded channels; non-blocking `send`; ordered `select`; no timeouts, cancellation, priorities or select-send | `yield`/`recv` in hot loops; an outer Worker | bounded channels, select send/default/timeout, cancellation, a fair queue, structured concurrency |
| L16 | AI primitives are host-only mocks | hash-based embeddings; no real embeddings endpoint; `ai_generate!` is not executed by the JS engine; no schemas, retries, token accounting or backpressure | the gateway handles `ai_infer` only; the demo runs offline | typed AI values, real embeddings, streaming with backpressure, `ai_generate!` as lowering |
| L17 | Self-host is a subset and is slow | part of the host-only corpus does not compile or hangs; no modules (bundle only); no source maps or optimisation; the seed is trusted; refreshing it needs Rust | verified samples; a Worker timeout | corpus coverage, bundle modules, a speed pass, Rust-free seed updates |
| L18 | No `i64` or `f64` arrays | embeddings, precise arithmetic and matrices live in fixed-point or JS | fixed-point, `i32` | `i64`, `[f64]`, `f64` vectors in the ABI |
| L19 | The sandbox does not limit CPU or memory | wasm runs until `terminate`; `memory.grow` is visible but not capped by the language; no fuel | Worker timeout and a host page limit | optional fuel/epoch, a helper with a memory cap |
| L20 | Web IDE: flat tree and tab memory | no directories; edits do not survive reload; engine #2 does not execute WASM | a single file level; manual export | directories/workspace, persistence, running the WASM module |
| L21 | Tooling drifts | the IDEA plugin ships an old `compiler.wasm`; LSP diagnostics only via compilation; no debugger | refresh the wasm; logs | artifact sync, semantic LSP, DAP |
| L22 | No standard library or collections | only `len/push/pop/...`; no map/set, sorting, richer strings | write it by hand | a small `std` in Latent after the core stabilises |
| L23 | No source maps, name section or symbols | debugging via pointers and `console.log`; traps without a function name | logging | name section, source maps, trap traces |
| L24 | `test` blocks are not emitted by engine #2 | tests run in engine #1; there is no CLI runner | run them in the IDE | a test runner and test support in both engines |
| L25 | The parity matrix is incomplete | 64/65 cases; differences are documented but not all automated | the manual table | a parity test for every documented example in CI |
| L41 | Type annotations are parsed but not checked | `let x: int = 1.5;` is not diagnosed; codegen gets the wrong valtype | do not rely on annotations | check annotations and use them in codegen |
| L42 | Decorators and top-level code are not registered/emitted | `@decorator fn` parses, but calling it gives `Unknown function`; top-level `let`/calls and `test` blocks do not reach the #2 module | avoid decorators in #2; run tests in the IDE | register decorators or reject them; emit top-level code |
| L43 | Scoping and return quirks | `return` inside `spawn` returns from the enclosing function; `return` inside a `match` arm does not parse; `obj.length` shadows a class field; `this` outside a method uses a heuristic; a non-bool `for` condition is not diagnosed | avoid these constructs | consistent return rules, a separate `length` for fields, diagnostics for `this`/`for` |
| L44 | `null` is `0`; no null safety | `null` is indistinguishable from a zero pointer/number; dereferencing traps or reads garbage | check by hand | `Option<T>`/nullable types and safe navigation |
| L45 | String length differs between engines | #1 uses UTF-16 code units, #2 uses UTF-8 bytes | use `len` for bytes in #2; test both engines | one definition plus `byte_len`/`chars` |
| L46 | No doc comments or docs generated from code | docs are written separately; symbols have no descriptions | Markdown by hand | `///` doc comments and extraction into LSP/site |
| L47 | `main` arguments are not a fixed ABI | passing i32/f64/pointers works but is not a contract | treat `main()` without arguments as portable | a versioned ABI for `main`/exports |

## P2. Language and product limits

| ID | Limitation | Comment |
|---|---|---|
| L26 | No packages, registry, npm package, TS types or Vite/Webpack plugins | modules v1 are project files only |
| L27 | No inheritance, interfaces, traits or user-defined generic types | classes are fields/methods/`init`; `Name<T>` is for built-ins |
| L28 | No function or operator overloading | duplicate `fn` is not diagnosed; the last signature wins |
| L29 | Lexical limits | ASCII identifiers; no hex/bin/underscore literals, `NaN`/`Infinity`, `\u{...}`, `\r`, `\0`; `1.` is not a number; integers above 2^53 lose precision |
| L30 | No string interpolation, `switch`, ternary, `const`, `defer`, named arguments or doc comments | all of these affect readability and tooling |
| L31 | No real `async` | #1 uses Promise-like values, #2 passes `await` through; there is no task scheduler |
| L32 | No WASI, threads, atomics or shared memory | only `wasm32` without an environment; Worker is a host feature |
| L33 | No incremental compilation or wasm-opt | small programs are fast, large ones are not; module size is not optimised |
| L34 | No error codes or single position format | messages are text, sometimes without `L:C`; runtime shows mangled names |
| L35 | The "small core" philosophy limits stdlib and ecosystem | deliberate; see [philosophy](../intro/philosophy.md) |

## P3. Deliberately out of scope

| ID | What | Why |
|---|---|---|
| L36 | Garbage collection | Latent explores deterministic memory; GC contradicts the niche |
| L37 | A full UI framework and DOM | that is JS/TS work; Latent is a computational core |
| L38 | A large "Go-sized" standard library | the core matters more than coverage; ABI stability first |
| L39 | Class inheritance | composition and `enum`/`match` cover the cases; inheritance complicates layout |
| L40 | An npm-style package registry | modules v2 and reproducible builds first |

## Deferred actions

| ID | Action | Related |
|---|---|---|
| D01 | Validate WASM inside the compiler and return a structured error with a position | L01, L09 |
| D02 | Add a `safe` mode with bounds checks and clear traps | L02 |
| D03 | Fix string/array comparison and `assert_eq` | L03 |
| D04 | Fix BOM and column overflow | L04 |
| D05 | Check builtin arity | L05 |
| D06 | Fix `i32::MIN`/large `f64` formatting; diagnose division by zero | L06 |
| D07 | Remove silent #2 surrogates or gate them behind a flag | L07 |
| D08 | Make parity tests mandatory for every documentation example | L08, L25 |
| D09 | Export functions and a versioned host ABI | L10, L18 |
| D10 | Arenas/`reset` and a free strategy | L11 |
| D11 | `Result` + `?`, errors at the ABI boundary | L12 |
| D12 | `break`/`continue`, `if` expressions, compound assignment | L13 |
| D13 | Modules v2: re-export, namespaces, directories, packages | L14, L26 |
| D14 | Bounded channels, select send/default/timeout, cancellation | L15 |
| D15 | Real embeddings, backpressure, `ai_generate!` | L16 |
| D16 | Self-host corpus coverage, bundle modules, a speed pass | L17 |
| D17 | `i64`/`[f64]` and the float ABI | L18, L29 |
| D18 | Fuel/epoch and a sandbox limits helper | L19 |
| D19 | A workspace with directories and persistence in the web IDE | L20 |
| D20 | Sync the IDEA `compiler.wasm`, semantic LSP, DAP | L21, L23 |
| D21 | A minimal `std` in Latent (collections, strings, sorting) | L22 |
| D22 | A test runner and tests in both engines | L24 |
| D23 | Error codes and one `path:line:col` format | L34 |
| D24 | npm package, TS types, Vite plugin, wasm-opt | L26, L33 |
| D25 | Check type annotations and use them in codegen | L41 |
| D26 | Decorators and top-level code: register or reject explicitly | L42 |
| D27 | One string-length semantics (`byte_len`/`chars`) | L45 |
| D28 | Fix the ABI for `main` arguments and exports | L47 |
| D29 | `Option`/nullable and safe navigation | L44 |
| D30 | Doc comments and docs generated from code | L46 |
| D31 | Rules for `return` in `spawn`/`match`, `this`, `for`, `obj.length` | L43 |

## Keeping the list honest

1. A new limitation first appears in the topic docs ("Engine #2 limitations" or
   "Limitations").
2. Then here, with `Lxx`, a priority and a workaround.
3. The [roadmap](./roadmap.md) maps `Lxx` to a phase and an exit criterion.
4. When a limitation is removed, the row moves to "Removed" with a version and a
   test — it is not deleted silently.
