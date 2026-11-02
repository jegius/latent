---
title: Language Guide
sidebar_label: Overview
sidebar_position: 1
description: How the Latent language guide is organized, how engine limitations are marked, and what order to read it in.
---

# Language Guide

This section is a systematic description of the Latent language: from lexis to the
WASM ABI. The tutorial answers the question "how do I write a program"; the guide
answers "how the language is put together and what exactly it guarantees".

## Reading order

| Topic | What is inside |
|---|---|
| [Syntax](./syntax.md) | literals, identifiers, comments, keywords, `;` |
| [Variables and types](./variables-and-types.md) | `let`, type inference, primitive types, memory |
| [Operators](./operators.md) | precedence, arithmetic, comparisons, bitwise |
| [Control flow](./control-flow.md) | `if`/`else`, `while`, both `for` forms, `spawn`/`select`/`yield` |
| [Functions](./functions.md) | parameters, return, hoisting, recursion, `main` |
| [Arrays and strings](./arrays-and-strings.md) | representation, indexing, methods, builtins |
| [Classes](./classes.md) | fields, methods, `init`, `this`, layout |
| [Enums and pattern matching](./enums-and-pattern-matching.md) | sum types, tags, `match` |
| [Lambdas and closures](./lambdas-and-closures.md) | two forms, captures, indirect calls |
| [Error handling](./error-handling.md) | no exceptions; codes, `Result`, `assert` |
| [Concurrency](./concurrency.md) | channels, goroutines, `select` (engine #1) |
| [AI primitives](./ai-features.md) | inference, embeddings, tensors (engine #1) |
| [Tests and contracts](./testing-and-contracts.md) | `test`, `assert`, `snapshot`, decorators |
| [Memory and low level](./memory-and-low-level.md) | linear memory, bump allocator, `alloc`/`load*` |
| [WASM and execution](./wasm-and-execution.md) | ABI, exports/imports, engine differences |

## Notation

- Example blocks are tagged `latent` and **checked by the compiler** when the
  documentation is built.
- An example that is known not to compile with engine #2 is marked with the comment
  `// Does not compile with engine #2: ...` or `// error`.
- Every topic ends with an **"Engine #2 limitations"** section: which parts of the
  described behavior do not work in the Rust → WASM compiler.
- The differences between the two engines are collected in
  [wasm-and-execution](./wasm-and-execution.md#engine-differences).

## Two engines in one paragraph

- **Engine #1** — the JS interpreter in the web IDE: it runs programs, including
  channels, AI, and tensors; it does not know `enum`, bitwise operators, or block
  comments.
- **Engine #2** — the Rust compiler in WASM: it compiles a subset into a
  WASM module; for host features it reports an explicit error
  `Builtin '...' не поддерживается движком №2 (требует host-рантайма)`.

Latent has no modules: one program is one `.lat` file.
