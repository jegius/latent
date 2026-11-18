---
title: "Parity Matrix: Rust Compiler vs Self-Hosted vs JS Interpreter"
description: "A comparison of the three Latent implementations based on the facts of the code and on verification: lexics, types, statements, expressions, classes, enums, builtins, host features, ABI; the final selfhost parity of 64/65 and 173 tests."
sidebar_position: 2
---

# Parity matrix

There are three implementations of the language in the repository:

| Designation | What it is | Where |
|---|---|---|
| **Rust** (engine #2) | the Latent → WASM compiler | `src/`, `latentc`, `web-ide/compiler.wasm` |
| **selfhost** | a Latent → WASM compiler written in Latent | `selfhost/src/*.lat`, `selfhost/shc.lat` |
| **JS** (engine #1) | a tree-walking interpreter | `web-ide/compiler/` |

How it was verified:

- **Rust**: every statement was checked by compiling and running programs through the
  shipped `web-ide/compiler.wasm` in Node (Node 24, `WebAssembly`). The artifact is up
  to date: it is built from the current `src/`, and the memory builtins are present in
  it.
- **JS**: the programs were run through `runLatent(src, withAI)` from
  `web-ide/compiler-loader.js`.
- **selfhost**: `node --test "selfhost/test/*.test.mjs"` — **173 tests, 0 failures**;
  `bootstrap.mjs` — `stage2 === stage3`; `latent-work/gap-matrix.mjs` — **64/65** cases
  match the Rust reference (the only divergence is float literals, where selfhost is
  stronger). For details see [selfhost](./selfhost.md).

Legend: ✅ works; ⚠️ works with limitations/defects; ❌ not supported; **host** — only
with a host runtime (engine #1).

## Lexics

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| `//` comments | ✅ | ✅ | ✅ |
| `/* */` (nested in Rust) | ✅ (nested) | ✅ (nested) | ❌ |
| decimal numbers | ✅ | ✅ | ✅ |
| exponent `1e3` | ✅ | ✅ | ❌ |
| escapes `\n \t \\ \"` | ✅ (only those) | ✅ | ✅ (any `\X` → `X`) |
| soft keywords as names | ✅ (`test`, `model`, ...) | ❌ (all are full keywords) | ✅ (`test`, `tensor`, ...) |
| `->`, `=>`, `<-` | ✅ | ✅ (`->`, `=>`; no `<-`) | ✅ |
| `::` | lexed, not used | ❌ | lexed as two `:` |
| bitwise `& \| ^ << >>` | ✅ | ✅ | ❌ (a lexical error) |
| `async`/`await` | ✅ | ✅ (the flag/value is ignored) | ✅ |
| `spawn`/`select`/`yield` | ✅ (syntax) | ✅ (inline / first arm / no-op) | ✅ |
| `channel` | ❌ host runtime error | ❌ host runtime error naming it | ✅ |

## Types and type checking

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| type inference | ✅ HM-like | ✅ simplified | ❌ none |
| annotations of `let`/parameters/return | ✅ | ✅ | ⚠️ parsed and ignored |
| `int`/`float` without a strict distinction | ✅ | ✅ | ⚠️ everything is a number |
| `null` | ✅ (comparisons) | ✅ (`0`, as in the reference) | ✅ |
| arrays `[T]` | ✅ | ✅ | ✅ |
| `fn(T...) -> R` | ✅ | ✅ | ✅ (lexically) |
| `Named` (class/enum) | ✅ | ✅ | ✅ |
| generic annotations `Name<A,B>` | ✅ (except `Name<[..]>`) | ⚠️ | ❌ (`Invalid type annotation`) |
| union `A \| B` | ❌ no grammar | ❌ | ❌ (`\|` is not lexed) |
| strict checking of arithmetic operands | ❌ (does not check) | ⚠️ | ❌ |
| `MissingReturn` | ❌ (not produced) | ⚠️ | ❌ |
| polymorphism of `let` lambdas | ✅ | ❌ | ❌ |

## Statements and expressions

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| `let`, `if/else if/else`, `while` | ✅ | ✅ | ✅ |
| C-style `for` | ✅ | ✅ | ✅ (needs a `let` in init) |
| `for (let x in arr)` | ✅ (array only) | ✅ | ✅ (array/string/instance) |
| `for (; c; )` empty parts | ✅ | ⚠️ | ❌ |
| `return` / `return;` | ✅ | ✅ | ✅ |
| `break`/`continue` | ❌ | ❌ | ❌ |
| assignment as an expression | ✅ | ⚠️ | ❌ |
| `+=`, `++` | ❌ | ❌ | ❌ |
| calls, recursion | ✅ | ✅ | ✅ |
| lambdas `fn(x) => e`, `fn(x){...}` | ✅ | ✅ | ✅ |
| closures/captures | ✅ | ✅ | ✅ |
| higher-order functions | ✅ | ✅ | ✅ |
| `await` | ✅ (passthrough) | ✅ (passthrough) | ✅ (Promise-like) |
| `async fn` | ✅ | ✅ (the flag is ignored) | ✅ |
| `match` | ✅ | ✅ | ✅ |
| `select` (channel waiting) | ⚠️ first arm | ✅ first arm (`default` — if there are no arms) | ✅ |
| `yield` | ⚠️ no-op | ✅ no-op | ✅ |
| `test "name" { … }` | ⚠️ compiles, is not executed | ✅ (not emitted at top level) | ✅ runs after `main` |
| top-level `let`/statements | ❌ not executed | ⚠️ an unused one compiles, using it gives `undefined variable` with the name | ❌ |

## Classes and enums

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| `class` with fields and methods | ✅ | ✅ | ✅ |
| `init`/`new` | ✅ (without `init` — ⚠️ invalid WASM) | ✅ | ✅ |
| `this` | ✅ | ✅ | ✅ |
| class methods | ⚠️ only on a variable with a class | ✅ | ✅ |
| inheritance | ❌ | ❌ | ❌ |
| `enum` | ✅ (float payload ⚠️) | ✅ | ✅ (v1: payload variants, `match`) |
| built-in `Ok/Err/Some/None` | ✅ | ✅ | ✅ |
| `match` over constructors | ✅ | ✅ | ✅ |
| float fields/float payload | ⚠️ codegen defects | ⚠️ | ✅ |
| file modules (`import`/`export`) | ✅ `compile_files` | ❌ (receives a `bundle`) | ✅ native linker |

## Modules and linking

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| `import { a, b as c } from "./x.lat"` | ✅ | ❌ (no file system) | ✅ |
| `import "./x.lat"` (connecting a file) | ✅ | ❌ | ✅ |
| `export fn`/`class`/`enum` | ✅ | ❌ | ✅ |
| import cycles | ✅ | ❌ | ✅ |
| mangling `m<idx>$<name>` | ✅ | receives it ready-made (`m1__name`) | ✅ (`m1$name`) |
| `latentc bundle` (flat source) | ✅ | input, not output | ❌ |
| multi-file ABI `latent_compile_files` | ✅ | ❌ (its own INPUT/OUTPUT ABI) | ❌ |

## Arrays, strings, builtins

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| array literal, `[]`, `.length` | ✅ | ✅ | ✅ |
| `push`/`pop` | ✅ | ✅ | ✅ |
| `len` | ✅ | ✅ | ✅ |
| string concatenation `+` | ✅ | ✅ | ✅ |
| string comparison `==`/`!=` | ✅ (by content) | ✅ | ✅ (by content) |
| `s[i]` | ✅ (a byte) | ✅ | ✅ (a UTF-16 code unit) |
| `str/int/float/sqrt` | ✅ | ✅ (float — beyond Rust) | ❌ no such names |
| `.to_str()`/`.to_int()` | ✅ (⚠️ print confuses the type) | ✅ (`to_str`/`to_int`) | ❌ |
| `print` | ✅ (arguments on separate lines) | ✅ | ✅ (one line joined by spaces) |
| `assert`/`assert_eq` | ✅ (trap; an `i32` comparison) | ✅ | ✅ (structural equality) |
| memory primitives (`alloc`, `load8`, `store8`, `load32`, `store32`, `memcopy`) | ✅ (also in the shipped `compiler.wasm`) | ✅ (the basis of selfhost) | ❌ |
| `range`, `unwrap`, `is_ok` | ❌ | ❌ | ✅ |
| array comparison `==` | ⚠️ pointers | ⚠️ | ✅ deep |

## Host features

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| `channel`, `ch.send/recv`, `<-` | ❌ host runtime error | ❌ host runtime error naming it | ✅ |
| `spawn`, `yield`, `select` | ⚠️ sequential/first arm | ✅ sequential/first arm (like the reference) | ✅ |
| `tensor`, `semantic`, `matmul`, `cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones` | ❌ error | ❌ error naming the builtin | ✅ |
| `ai_infer`, `ai_embed`, `ai_stream`, `stream_next` | ❌ error | ❌ host runtime error | ✅ (mock/gateway) |
| `ai_generate!("...")` | ⚠️ parses, but a codegen error | ❌ host runtime error | ❌ (does not parse) |
| `snapshot`, `ai_contract`, `enforce_contract` | ❌ error | ❌ host runtime error | ⚠️ simplified (snapshot is a stub, a contract is an object) |
| `@forall`, `@ai_contract`, `@test` decorators | ⚠️ parse, are inert | ❌ (`@` is not lexed) | ⚠️ inert (the target is registered anyway) |
| `test "name" { ... }` | ⚠️ compiles, is not executed | ✅ compiles, is not executed | ✅ runs after `main`, results are not in the UI |

## ABI / execution

| Capability | Rust | selfhost | JS |
|---|---|---|---|
| the result is a WASM module | ✅ | ✅ | ❌ (the source is the "bytecode") |
| executes the program | ❌ | ❌ | ✅ |
| imports `env.print(i32)` | ✅ (always) | ✅ | ❌ |
| exports `memory`, `main` | ✅ | ✅ | ❌ |
| 16 pages of memory, a heap global | ✅ | ✅ (`1024+data`) | ❌ |
| self-compile / fixed point | ✅ (builds `latentc`) | ✅ `stage2 === stage3` | ❌ |
| the compiler C-ABI (`latent_alloc/...`) in the browser | ✅ `web-ide/compiler.wasm` | ❌ (a different ABI: INPUT/OUTPUT) | ❌ |

## Known defects of the Rust codegen (summary)

Verified on the shipped `web-ide/compiler.wasm` build; for details see
[errors → known limitations of engine #2](../reference/errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm):

- `let x: float = 2;`, `fn f() -> float { return 5.0; }` — invalid WASM;
- `1 + 2.5`, `1 < 1.5`, `5.5 % 2.0` — invalid WASM;
- `print(sqrt(16))`/`int(sqrt(16))` — invalid WASM (in an f64 context
  `-> float { return sqrt(16); }` is valid);
- arrays with float, float class fields/parameters/captures, a float enum payload;
- `match` with void arms, `fn f() -> unit { return; }`, `let x = print("a");`;
- `new Class(...)` without `init` in reachable code;
- `print` of strings from `.to_str()` sometimes prints a pointer.

The shipped `web-ide/compiler.wasm` (651 473 bytes) **is built from the current
`src/`**: the memory builtins (`alloc`, `load8`, `store8`, `load32`, `store32`,
`memcopy`) are present in it, so that item has been removed from the former defect
list. The embedded copy in the IDEA plugin resources is synced with the same artifact
(`node scripts/check-embedded-wasm.mjs`); there are no separate old copies.

At the same time **selfhost is a strict superset of the reference with respect to
float**: according to `selfhost/README.md`, the cases `int(2.5 * 2.0)`,
`int(sqrt(16.0))`, `let x: float = 2.5`, `str(2.5)`, `2 < 2.5`, `1 + 0.5` produce valid
WASM and the correct result in selfhost, whereas `latentc` fails on them with invalid
WASM. This divergence is recorded honestly: the "reference" is not always a reference
when it comes to float; in the parity matrix (64/65) this is the only remaining case.

## Divergences between the documentation and the code

Recorded while preparing the reference (important for anyone relying on older
descriptions):

| Source | Claim | In reality |
|---|---|---|
| `web-ide/README.md` | "engine #1 implements all language constructs" | no bitwise operators, no `str/int/float/sqrt`, no block comments, no `Name<...>`; `enum` and modules are already supported |
| `web-ide/README.md` | engine #2 supports `ttest/assert_eq` | `test` blocks compile but are not executed; only `assert`/`assert_eq` are executed |
| `tooling/language-data/language.json` | `str/int/float/sqrt` — `engine: both` | engine #2 only |
| `tooling/language-data/language.json` | `alloc/load8/store8/load32/store32/memcopy` — `engine: both` | engine #2 only (the JS interpreter has no such builtins) |
| `tooling/language-data/language.json` | `ai.load/ai.infer/ai.embed/ai.agent` — syntax | the parser never creates such nodes (only the `ai_infer` functions and `ai_generate!`) |
| `tooling/language-data/language.json` | `& \| ^ << >>` — `engine: both` | in engine #1 the lexer fails on `& \| ^` |
| `src/types.rs` | `LatentType`/`AIType`/`ConcurrencyType` | the compiler uses `typechecker::Type`; the model is duplicated |
| `selfhost/README.md` | the Rust compiler is "the reference" | the reference itself sometimes produces invalid WASM (float) — selfhost is stricter |

The outdated claims about `compiler.wasm` ("older than `src/`", "no memory builtins")
have been **removed** from the documentation: the artifact has been rebuilt from the
current `src/`.

## Related sections

- [Web IDE engines](./engines.md) — how these implementations are used in the IDE.
- [Self-hosted compiler](./selfhost.md) — the final status, 173 tests, the memory
  budget.
- [Codegen internals](./internals-codegen.md).
- [Rust compiler architecture](./rust-architecture.md).
- [Web IDE architecture](./webide-architecture.md).
- [Reference](../reference/index.md).
