---
title: Comparison with Rust, TypeScript, and Go
sidebar_label: Comparison
sidebar_position: 3
description: An honest comparison of Latent with Rust, TypeScript, and Go by mechanism — no marketing.
---

# Comparison with Rust, TypeScript, and Go

Latent is not a replacement for these languages. It is a small research
language; it is reasonable to compare it by **mechanisms** rather than by
maturity. Below is an honest table: where Latent is genuinely different, and
where it loses.

## In short

| Criterion | Latent | Rust | TypeScript | Go |
|---|---|---|---|---|
| Maturity | experimental, 0.1 | production | production | production |
| Ecosystem/packages | no modules | cargo/crates.io | npm | go modules |
| Typing | HM inference + annotations, dynamic leniency | strict, trait-based | structural, erased at compile time | nominal, interfaces |
| Execution | WASM (own code generator) or a JS interpreter | native code / WASM via LLVM | JS runtime | native code |
| Memory | WASM linear memory, bump allocator, no GC | ownership/borrow checker | engine GC | GC |
| Concurrency | CSP: spawn/channel/select (engine #1) | threads, async (tokio) | event loop, Worker | goroutines/channels |
| OOP | classes without inheritance | struct + trait | class/interface | struct + interface |
| Generics | limited, built-in types | full | full | since 1.18 |
| Tests | language syntax (`test`, `assert`) | `#[test]` + cargo | frameworks | `testing` |
| AI primitives | built in as syntax | libraries | libraries | libraries |

## Types and inference

**Latent.** Hindley–Milner-style type inference: functions are generalized, calls
are unified. Annotations are optional. `int` and `float` unify with each other,
which is why numbers are checked more loosely than in Rust:

```latent
fn add(a: int, b: int) -> int {
    return a + b;
}

fn main() -> int {
    let x = 40;
    let y: int = 2;
    print(add(x, y));
    return add(x, y);
}
```

**Rust.** Strict nominal typing, trait objects, borrowing. No implicit numeric
conversions.

**TypeScript.** Structural typing; types are erased when compiling to JS, so the
guarantees end at the runtime boundary.

**Go.** Nominal typing, implicitly implemented interfaces, generics since 1.18,
but without HM-style "smart" inference.

## Memory

| | Latent | Rust | TypeScript | Go |
|---|---|---|---|---|
| Model | WASM linear memory | stack/heap, ownership | heap + GC | heap + GC |
| Deallocation | none (bump allocator) | deterministic (Drop) | GC | GC |
| Bounds checking | no | yes (slices) | yes (JS arrays) | yes |
| Null | `null` = 0 | `Option<T>` | `null`/`undefined` | nil |

```latent
fn main() -> int {
    // Strings and arrays live in linear memory as [length][data].
    let name = "latent";
    let sizes = [1, 2, 3];
    print(name.length + sizes.length);
    return 0;
}
```

The absence of deallocation is a deliberate Latent trade-off: a long-lived
program gradually consumes memory. For educational and short programs this is
sufficient.

## Concurrency

**Latent (engine #1)** — CSP in the spirit of Go: goroutines `spawn`, channels
`channel()`, `select`, cooperative `yield`, sending `ch <- v`, and receiving
`<-ch`:

```latent
// Not compiled by engine #2: channels require the host runtime.
fn worker(ch, n) {
    ch.send(n * n);
}

fn main() -> int {
    let ch = channel();
    spawn worker(ch, 7);
    let result = ch.recv();
    print("result:", result);
    return result;
}
```

**Rust** — threads and async/await (usually through tokio), without a built-in
scheduler. **TypeScript** — a single event thread + `Promise`, parallelism only
through Workers/processes. **Go** — the closest analogue: goroutines and
channels, but with a real scheduler and without a host boundary.

Engine #2 of Latent does not support channels: `channel`, `ch.send`, `ch <- v`,
`<-ch` produce an explicit error. `spawn` and `select` do compile in it, but
execute sequentially (see [concurrency](../guide/concurrency.md)).

## OOP and data

**Latent.** A class is fields and methods; the constructor is called `init`;
there is no subtype polymorphism. Sum types are `enum` + `match`, as in Rust:

```latent
enum Shape { Circle(int), Rect(int, int) }

fn area(s: Shape) -> int {
    return match s {
        case Circle(r): 3 * r * r,
        case Rect(w, h): w * h,
    };
}

fn main() -> int {
    return area(Rect(3, 4));
}
```

**Rust** — `struct`/`enum` + `trait` (composition instead of inheritance).
**TypeScript** — `class`, inheritance, interfaces, but types are erased.
**Go** — `struct` + methods + `interface`, without inheritance; enum as a
user-defined type is not supported at the language level (constants + iota).

## Build and target

| | Latent | Rust | TypeScript | Go |
|---|---|---|---|---|
| Target | WASM (`wasm32`) | native, WASM | JS | native |
| Backend | own WASM code generator | LLVM | tsc/babel | own |
| Build time | milliseconds for small programs | depends on the project | fast | fast |
| Optimizations | almost none | aggressive | JIT | aggressive |

## AI primitives

**Latent.** `ai_infer("gpt-4", "промпт")`, `ai_embed(text)`,
`ai_stream`/`stream_next`, `tensor`/`matmul`/`cosine_similarity`,
`semantic(...)`, and `ai_generate!("...")` are part of the language. In engine
#1 they call the AI gateway and have a mock mode; in engine #2 they are an
explicit error.

**Rust/TypeScript/Go.** AI is libraries and HTTP clients; the language knows
nothing about them. Latent's advantage here is the syntax and a single
contract; its disadvantage is the lack of an ecosystem and the fact that
without a host these primitives do not work.

## When Latent is appropriate

- experiments with languages and compilers;
- education: a small, complete toolchain;
- browser playground scenarios;
- generating and checking code by AI agents (machine-readable documentation,
  MCP).

## When Latent is inappropriate

- production services and libraries;
- programs that need modules, packages, and an ecosystem;
- long-lived processes with a large amount of data (no GC);
- tasks that need Rust-level performance;
- anything that requires compatibility with existing code.

Next: [Getting started](../getting-started/install.md) →
[Tutorial](../tutorial/index.md) → [Guide](../guide/index.md).
