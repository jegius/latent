---
title: Why Latent
sidebar_label: Why Latent
sidebar_position: 1
description: What problems Latent solves, who it is for, and what is deliberately absent from the language.
---

# Why Latent

Latent is an experimental language that tests three hypotheses:

1. **AI primitives should be part of the language, not an SDK.** If inference,
   embeddings, and tensors are ordinary grammar constructs, programs are easier
   to read, and tooling (IDE, MCP, linters) can understand them statically.
2. **A compiler to WASM can be compact and comprehensible.** Latent does not
   use LLVM: it has its own WASM code generator (`src/codegen/`) that does
   exactly what the language needs — and that makes it possible to keep the
   whole compiler in one repository and even rewrite it in the language itself
   (`selfhost/`).
3. **Tests, contracts, and self-repair are not an add-on but part of the
   process.** `test` blocks, `assert`, `snapshot`, `@forall`, and `@ai_contract`
   are syntax, not libraries.

## What you get in practice

- **One source — two runtimes.** A `.lat` file can be executed by the
  interpreter (engine #1: most of the language + host features, but without
  `enum`, bitwise operators, and block comments) and compiled into a WASM
  module (engine #2: a "clean" subset of the language).
- **A comprehensible ABI.** A compiled module exports `main` and memory, and
  imports a single host function `env.print`. That is enough to run programs in
  the browser, in Node.js, and in any WASM host.
- **A small but self-sufficient language.** Classes, enum + pattern matching,
  lambdas and closures, arrays/strings, `async`/`await`, CSP concurrency,
  low-level memory primitives.

## Latent on the web

Latent compiles to a compact WASM module with a single import (`env.print`) and
two exports (`memory`, `main`), so it can be embedded into a browser page
without a bundler: `fetch` → `WebAssembly.instantiate` → call `main()`. That
makes the language practical for frontend work: computations, parsing, data
processing, and game logic run in WASM next to the UI instead of on a server.

The playground is a full browser IDE: host features (channels, `spawn`/`select`,
AI primitives, tensors, contracts) run on engine #1 with automatic fallback,
and lazy loading plus chunks (`engine2` / `ai` / `editor` / `examples` /
`core`) shrink the initial bundle. Start with
[Latent in the browser in 5 minutes](../getting-started/web-browser.md) and
[Latent on the frontend](../guide/web-and-frontend.md).

## Killer features and demos

What lets Latent beat JS/TS on the frontend has its own page,
[“Killer Features”](../guide/killer-features.md): CSP concurrency in the
language, AI primitives as syntax, a self-hosted compiler in the browser, a WASM
sandbox, deterministic GC-free memory, modules with chunks, and two engines.
Every feature can be tried live in the demos:
<a href="/latent/demos/">/latent/demos/</a> (goroutines, an AI pipeline,
self-host, the sandbox, modules, physics); the same page has an honest section on
the limits and on where JS/TS is still better.

## Who might find this interesting

- **Language and compiler researchers** — how a small yet complete toolchain is
  built: lexer → parser → Hindley–Milner-style typing → WASM.
- **AI agents and their developers** — the language has machine-readable
  documentation: `llms.txt`, an MCP documentation server, and code checking
  through `compiler.wasm`.
- **Those learning to write compilers** — all the code in Rust and in Latent
  itself is open, and the self-hosted compiler serves as a living example.

## What Latent deliberately does not do

Honesty matters more than marketing — here is what the language **does not
have**:

- no packages or package manager: file modules (`import`/`export`) exist, but
  there are no external dependencies and no `node_modules`;
- no inheritance or interfaces: classes are fields, methods, and the `init`
  constructor;
- no user-defined generics: `Name<T>` is parsed and used for built-in types,
  but custom generic classes are not supported;
- no `break`/`continue`, `switch`, ternary operator, string interpolation, or
  exceptions;
- no garbage collection: memory in WASM is a bump allocator, and nothing is
  freed;
- no full standard library: the built-in functions are listed in the
  [guide](../guide/functions.md) and the reference;
- engine #2 supports a subset of the language, and in it host features
  (channels, AI, tensors) produce an explicit `«требует host-рантайма»` error;
  for the user this boundary is transparent — the playground executes them on
  engine #1 with automatic fallback
  ([web IDE](../tooling/web-ide.md)).

This is not a list of future shortcomings but the **fixed scope** of the
language: the project explores how far one can go with such a core.

## A first look at the code

```latent
fn triple(x: int) -> int {
    return x * 3;
}

fn main() -> int {
    let values = [3, 1, 4, 1, 5];
    let total = 0;
    for (let v in values) {
        total = total + triple(v);
    }
    print("triple sum:", total);
    return total;
}
```

This code compiles with both engine #1 and engine #2. Next:

- [Language philosophy](./philosophy.md) — principles and trade-offs.
- [Comparison with Rust, TypeScript, and Go](./comparison.md) — what Latent can
  and cannot do, without embellishment.
- [Getting started](../getting-started/install.md) — build and run.
