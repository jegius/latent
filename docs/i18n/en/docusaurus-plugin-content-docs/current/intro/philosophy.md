---
title: Language philosophy
sidebar_label: Philosophy
sidebar_position: 2
description: Latent's design principles, the honest status of its trade-offs, and code style.
---

# Language philosophy

Latent is designed as a **small language with a large runtime contract**:
complexity should live in the host (browser, Node.js), and the language should
contain only what can be explained and compiled without magic.

## Principles

### 1. One language — two engines, honest errors

Engine #1 (the JS interpreter) executes most of the language, including host
features: channels, goroutines, tensors, AI primitives. What it cannot do — for
example, `enum`, bitwise operators, and block comments — is visible at run time:
it is an engine #1 error, not "magic". Engine #2 (Rust → WASM) compiles a
subset and, for an unsupported construct, produces an **explicit error** naming
the construct rather than a silent no-op:

```text
Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)
```

That error applies to **engine #2 only**. For the user the boundary is
transparent: the playground executes host features on engine #1 and picks the
engine automatically (automatic fallback); engine #2 is the internal WASM
compiler for a subset. The same contract lets one source file be a teaching
example, a compiler test, and a specification at the same time. In the
documentation, every topic has an "Engine #2 limitations" section.

### 2. Types as help, not a barrier

The type system is Hindley–Milner-style: type inference, generalization of
functions, unification. But the language does not force you to annotate
everything: `int` and `float` unify with each other, arrays do not require
homogeneous elements, and methods of built-in types are typed dynamically.
Strict typing is enabled where it catches errors: `if`/`while` conditions must
be `bool`, and calls must match arity.

### 3. AI is grammar

`ai_infer`, `ai_embed`, `ai_stream`, `stream_next`, `tensor`, `semantic`,
`matmul`, `cosine_similarity`, `agent`, `embedding`, `ai_generate!`,
`ai_contract` are keywords and built-in functions. This is **language syntax**,
not a library: the primitives are parsed by the language and are available in
the browser runtime (engine #1) without bundlers or an SDK. The language does
not pretend to execute a model deterministically: an AI call is a request to a
gateway (or a mock), and the result depends on the provider.

### 4. Testability by default

The language has `test "name" { ... }`, `assert`, `assert_eq`, `snapshot`, and
the `@forall` and `@ai_contract` decorators. The idea: a Latent program is both
code and its checks. Test blocks are executed by engine #1 after `main`;
`assert` fails with a runtime error.

### 5. WASM as the only target

The compiler does not hide the memory model: linear memory, a bump allocator,
strings `[length u32 LE][UTF-8]`, arrays `[length][elements]`, classes as
structs with fixed offsets. This is what makes the low-level primitives
`alloc`/`load8`/`store8`/`load32`/`store32`/`memcopy` and self-hosting possible.

### 6. Self-sufficiency

The compiler is a single dependency-free Rust crate (`Cargo.toml` has only
`[package]` and `[lib]`) and does not use LLVM. The repository contains a
self-hosted compiler (`selfhost/`) with a bootstrap fixed point:
`stage2 === stage3`. Moreover, **Rust is not required for users**: the bootstrap
can run without Rust from `selfhost/seed.wasm`
(`node selfhost/bootstrap-wasm.mjs`), and Rust is needed only to refresh the
seed once. See [specs/selfhost](../specs/selfhost.md).

## Trade-offs and status

| Decision | What we get | Status |
|---|---|---|
| No modules/imports | A simple parser, one file — one program | **Remains** (roadmap: modules + chunks; lazy chunks for WASM bundles already exist) |
| No GC, bump allocator | Predictability, minimal runtime | **Remains** (roadmap) |
| Classes without inheritance | A simple object model | **Remains** |
| `int`/`float` unify | Fewer annotations | **Remains**; partially compensated by the type checker |
| Dynamic arrays | Convenience | **Remains** |
| Host boundary for AI/channels | A clear engine contract | **Removed for the user**: the browser runtime (engine #1) executes host features, the playground selects the engine automatically; engine #2 remains the WASM compiler for a subset (an internal implementation detail) |
| A custom code generator | Small, comprehensible, self-hosted | **The dependency on Rust is removed**: Rust-free self-hosted bootstrap (`seed.wasm`); Rust is needed only to refresh the seed once |
| Almost no optimizations | A simple code generator, fast for small programs | **Remains** (roadmap) |

### What has already been removed

Two limitations that used to be visible to users are no longer trade-offs:

- **Host features in the browser.** A normal Run no longer produces "requires a
  host runtime" errors: the playground executes channels, `spawn`/`select`, AI
  primitives, tensors, and contracts on engine #1, and picks the engine
  automatically (automatic fallback). The error above remains only in engine
  #2, the internal WASM compiler for a subset. See
  [tooling/web-ide](../tooling/web-ide.md).
- **The dependency on Rust.** The Latent compiler runs without Rust: the
  self-hosted bootstrap starts from `seed.wasm`, builds a stage, checks the
  fixed point, and provides a `compile/check/run/version` CLI; Rust is needed
  only to refresh the seed once. See
  [specs/selfhost](../specs/selfhost.md).

### Roadmap

- **Modules and chunks.** Modules/imports (today one file is one program); lazy
  chunks for WASM bundles already work in the playground: dynamic import +
  `manualChunks` (`engine2` / `ai` / `editor` / `examples` / `core`), a Vite
  production build — see [tooling/web-ide](../tooling/web-ide.md).
- **Memory.** GC/freeing or arena strategies on top of the bump allocator.
- **Codegen optimizations.** Basic WASM optimizations without giving up
  self-hosting.
- **Web and frontend.** New scenarios for using Latent in the browser —
  [guide/web-and-frontend](../guide/web-and-frontend.md).

## Code style

The repository follows these conventions:

- **identifiers are English** (`total`, `compute`, `Account`);
- **comments and documentation are in Russian**;
- UTF-8 without BOM; indentation is 4 spaces; a semicolon is mandatory after
  statements;
- type names are `CamelCase`, functions and variables are `snake_case`;
- `main` returns `int` (the exit code).

## See also

- [Why Latent](./why-latent.md) — goals and audience.
- [Comparison with other languages](./comparison.md) — the mechanisms side by
  side.
- [Language guide](../guide/index.md) — what all this looks like in code.
- [Latent on the web](../guide/web-and-frontend.md) — frontend scenarios.
