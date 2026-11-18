---
title: "Latent Language Reference"
description: "Navigation for the precise Latent reference: lexics, grammar, types, operators, builtins, diagnostics, CLI, and the WASM ABI."
sidebar_position: 1
---

# Latent Language Reference

This section is a **precise** reference for the Latent language: it describes how the
language is implemented in the sources, not how it was intended. Every fact here can be
verified against `src/` (the Rust compiler, "engine #2") or `web-ide/compiler/` (the JS
interpreter, "engine #1").

**Version:** `0.1.0` (`Cargo.toml`, `src/lib.rs`). Branch: `part10-toolchain`.

## What is Latent

Latent is an imperative language with C-like syntax that compiles to WebAssembly:

- static typing "in the Hindley–Milner style" with type inference and local
  generalization (`src/typechecker/`);
- integers (`int`), floating-point numbers (`float`), `bool`, `string`, `null`,
  `unit`/`void`, arrays `[T]`, functions `fn(T) -> R`, classes and enums (`src/ast/`);
- the `latentc` compiler turns a program into a WASM module that exports `main` and
  imports `env.print(i32)` ([WASM ABI](./wasm-abi.md));
- the branch has a **self-hosted** compiler written in Latent itself
  ([self-hosted compiler](../specs/selfhost.md)).

## Reference sections

| Document | What is inside |
|---|---|
| [Lexical structure](./lexical.md) | literals, escaping, comments, "soft" keywords, the `;` rules |
| [Grammar](./grammar.md) | the full EBNF grammar matching the parser + the precedence table |
| [Types](./types.md) | the type system, type inference, annotations, what the type checker really checks |
| [Operators](./operators.md) | all operators: precedence, associativity, semantics, WASM instructions |
| [Builtins](./builtins.md) | `print`, `len`, `push`, `sqrt`, `assert`, memory, constructors; host functions |
| [Diagnostics](./errors.md) | a catalog of lexer/parser/type checker/codegen error texts |
| [CLI `latentc`](./cli.md) | commands, arguments, exit codes, running WASM in Node |
| [WASM ABI](./wasm-abi.md) | imports/exports, memory layout, strings, arrays, classes, enums, closures |
| [Latent in one page](./complete-language.md) | an "everything essential" summary for AI and a quick start |

Related sections:

- specifications: [web IDE engines](../specs/engines.md),
  [AI runtime](../specs/ai-runtime.md),
  [codegen internals](../specs/internals-codegen.md),
  [instruction map](../specs/bytecode.md),
  [self-hosted compiler](../specs/selfhost.md),
  [selfhost functional style](../specs/selfhost-style.md),
  [parity matrix](../specs/parity-matrix.md);
- implementation architecture:
  [Rust compiler](../specs/rust-architecture.md),
  [web IDE](../specs/webide-architecture.md);
- practical walkthroughs: [examples](../examples/index.md);
- tooling: [web IDE](../tooling/web-ide.md), [VS Code](../tooling/vscode.md),
  [IntelliJ IDEA](../tooling/idea.md), [documentation MCP server](../tooling/mcp.md).

## Two engines: read this before the examples

The repository contains **two implementations** of the language, and they differ:

| | Engine #2 | Engine #1 |
|---|---|---|
| what it is | the Rust compiler to WASM (`src/`, `web-ide/compiler.wasm`) | a JavaScript interpreter (`web-ide/compiler/`) |
| what it does | compiles to WASM but **does not execute** the program | executes the program directly |
| AI primitives, channels, tensors | ❌ "requires host runtime" error | ✅ full semantics (mock/gateway) |
| strings, arrays, classes, enums, `match`, lambdas, `async` | ✅ | ✅ |

In the documentation the engine is always named when describing behavior. If it just
says "the compiler", engine #2 (Rust) is meant. That is the one
`docs/scripts/validate-examples.mjs` uses to check every ```latent block.

:::warning
All ```latent code blocks in this section are checked by the real compiler
(`web-ide/compiler.wasm`), except for blocks whose **first line** is
`// Does not compile with engine #2: ...`. Such blocks are marked deliberately: they
illustrate a diagnostic or a host-only feature that engine #2 does not support.
:::

## Notation

- "engine #1" is the JS interpreter; "engine #2" is the Rust→WASM compiler.
- `L:C` is a "line:column" position, numbered from 1 (see `src/lexer/position.rs`).
- Links of the form `src/...` are paths inside the repository.

## Reference status

The reference describes the **current state of the** `part10-toolchain` branch. Known
limitations (invalid WASM on float expressions, loss of the static type of a method
result, and so on) are collected in the
[parity matrix](../specs/parity-matrix.md) and in the
[diagnostics](./errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm) section.
The shipped `web-ide/compiler.wasm` is up to date (built from the current `src/`, and it
does include the memory builtins), so the descriptions no longer contain "old builds".
