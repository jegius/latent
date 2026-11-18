---
title: Why Latent
sidebar_label: Why Latent
sidebar_position: 1
description: What problems Latent solves, who it is for, and what is deliberately absent from the language.
---

# Why Latent

Latent grew out of three questions we wanted to answer in code rather than in a
slide deck.

1. **Can AI primitives be part of the language?** When inference, embeddings and
   tensors are ordinary grammar constructs, programs read better, and IDEs, MCP
   servers and linters can understand them statically instead of guessing from
   strings.
2. **How small can a WASM compiler be?** Latent does not use LLVM: it has its own
   code generator (`src/codegen/`) that does what the language needs. That is why
   the whole compiler fits in this repository — and why it could be rewritten in
   Latent itself (`selfhost/`).
3. **What if tests and contracts are syntax, not a library?** `test` blocks,
   `assert`, `snapshot`, `@forall` and `@ai_contract` are written in the language,
   and that changes what checking an idea looks like.

## What you get in practice

- **One source — two runtimes.** A `.lat` file can be executed by the
  interpreter (engine #1: most of the language plus host features, but without
  `enum`, bitwise operators and block comments) and compiled into a WASM module
  (engine #2: a subset of the language).
- **A small ABI.** A compiled module exports `main` and memory and imports a
  single host function `env.print`. That is enough to run programs in the
  browser, in Node.js and in any WASM host.
- **A small but self-sufficient language.** Classes, `enum` and `match`, lambdas
  and closures, arrays/strings, `async`/`await`, CSP concurrency and low-level
  memory primitives.

## Latent on the web

Latent compiles to a compact WASM module with a single import (`env.print`) and
two exports (`memory`, `main`), so it can be embedded into a browser page
without a bundler: `fetch` → `WebAssembly.instantiate` → call `main()`.
Computations, parsing, data processing and game logic run in WASM next to the UI
instead of on a server.

The playground is a browser IDE: host features (channels, `spawn`/`select`, AI
primitives, tensors, contracts) run on engine #1 with automatic fallback, and
lazy loading plus chunks (`engine2` / `ai` / `editor` / `examples` / `core`)
shrink the initial bundle. Start with
[Latent in the browser in 5 minutes](../getting-started/web-browser.md) and
[Latent on the frontend](../guide/web-and-frontend.md).

## What to look at

What Latent gives the frontend has its own page,
[“Features and limits”](../guide/killer-features.md): CSP concurrency in the
language, AI primitives as syntax, a self-hosted compiler in the browser, a WASM
sandbox, deterministic GC-free memory, modules and two engines. Every feature can
be tried live: <a href="/latent/demos/">/latent/demos/</a> (goroutines, an AI
pipeline, self-host, the sandbox, modules, physics). The same page has a section
on the limits and on where JS/TS is still better.

## Who might find this interesting

- **Language and compiler researchers** — how a small yet complete toolchain is
  built: lexer → parser → Hindley–Milner-style typing → WASM.
- **AI agents and their developers** — the language has machine-readable
  documentation: `llms.txt`, an MCP documentation server, and code checking
  through `compiler.wasm`.
- **Those learning to write compilers** — all the code in Rust and in Latent
  itself is open, and the self-hosted compiler serves as a living example.

## What Latent deliberately does not do

Here is what the language **does not have** — at least for now:

- packages or a package manager: file modules (`import`/`export`) exist, but
  there are no external dependencies and no `node_modules`;
- inheritance or interfaces: classes are fields, methods and the `init`
  constructor;
- user-defined generics: `Name<T>` is parsed and used for built-in types, but
  custom generic classes are not supported;
- `break`/`continue`, `switch`, the ternary operator, string interpolation or
  exceptions;
- garbage collection: memory in WASM is a bump allocator, and nothing is freed;
- a full standard library: the built-in functions are listed in the
  [guide](../guide/functions.md) and the reference;
- host features in engine #2: channels, AI and tensors produce an explicit
  “requires the host runtime” error; the playground executes them on engine #1
  with automatic fallback ([web IDE](../tooling/web-ide.md)).

Some of this is a deliberate choice (GC, inheritance), some is unfinished work
(packages, `break`/`continue`, float ABI). The [limitations
register](../specs/limitations.md) and the [roadmap](../specs/roadmap.md) show
where the boundary is, what the workaround is, and in what order it will move.

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
