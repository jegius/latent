---
title: WASM and Execution
sidebar_label: WASM and Execution
sidebar_position: 16
description: The ABI of the compiled module, running it in Node.js, engine differences, and the complete list of engine #2 limitations.
---

# WASM and Execution

## What the compiler generates

`compile_source` (`src/lib.rs`) is a pure pipeline
lexer → parser → type checker → codegen, and the result is the bytes of a WASM
module.

### Imports

Exactly **one** import:

```text
env.print : (i32) -> ()
```

The `env.print` function receives a pointer to a string in linear memory. All the
functions of the module are shifted by 1 relative to the import index.

### Exports

- `memory` — the linear memory of the module (initial size 16 pages, no `max`);
- `main` — **only if** a top-level `fn main` is declared;
  the result type is `i32`, `f64` (with `-> float`), or void.

Without `main` the module is valid, but it exports memory only.

### Strings

In memory a string is `[len u32 LE][UTF-8 bytes]`, and the pointer points at `len`.
`print` is called separately for each argument; the host reads `len` and then `len`
bytes.

The reference host shim is `scripts/verify-wasm.mjs`; in the browser it is `web-ide/`.

### Module helpers (not exported)

`__latent_alloc`, `__latent_mem_copy`, `__latent_str_len`,
`__latent_str_concat`, `__latent_str_eq`, `__latent_str_char_at`,
`__latent_i32_to_str`, `__latent_f64_to_str`, `__latent_str_to_i32`.

## Running in Node.js

```javascript
// run.mjs — a minimal WASM host for Latent.
import {readFileSync} from 'node:fs';

const bytes = readFileSync(process.argv[2]);
let instance;

const imports = {
  env: {
    print: (ptr) => {
      const view = new DataView(instance.exports.memory.buffer);
      const len = view.getUint32(ptr, true);
      const text = new TextDecoder().decode(
        new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
      );
      console.log(text);
    },
  },
};

instance = await WebAssembly.instantiate(bytes, imports);
const code = instance.exports.main?.() ?? 0;
process.exitCode = typeof code === 'number' ? code : 0;
```

```bash
./target/debug/latentc compile hello.lat hello.wasm
node run.mjs hello.wasm
```

Ready-made checks:

```bash
node scripts/verify-wasm.mjs hello.wasm --run --expect=0
node scripts/integration.mjs         # end-to-end examples through latentc
```

## Engine differences

| Construct | #2 (Rust → WASM) | #1 (JS interpreter) |
|---|---|---|
| `7 / 2` | `3` (`i32` truncation) | `3.5` (all numbers are float) |
| `"привет".length` | `12` (UTF-8 bytes) | `6` (UTF-16 units) |
| `"abc"[1]` | `98` (a byte) | `"b"` (a character) |
| `[1] == [1]` | `0` (pointers) | `1` (structural) |
| `print(true)` | `1` | `true` |
| `print(null)` | `0` | `null` |
| `print([1,2])` | a pointer number | `[1, 2]` |
| `print(1.5)` | `1.500000` | `1.5` |
| `print("a", 1)` | two lines | one line `a 1` |
| `enum` | ✅ | ❌ `Unexpected token '{'` |
| bitwise operators | ✅ | ❌ lexer error |
| block comments | ✅ | ❌ `Unexpected token '/'` |
| `for (let c in "abc")` | ❌ type error | ✅ 3 iterations |
| `async`/`await` | surrogate (passthrough) | promises |
| `spawn`/`select`/`yield` | surrogates | scheduler |
| `channel`, AI, tensors | ❌ host runtime error | ✅ |
| `test` blocks | not executed | executed after `main` |
| `1e3` | `1000.0` | `1` (the exponent is not supported) |
| `1.2.3` | parse error | `1.2` |

## Host features in the browser: how to run them

Engine #2 is a **compiler of the host-free subset**; it deliberately rejects channels,
AI, tensors, and contracts. In the playground this does not mean the program cannot
run: the browser IDE selects engine #1 automatically.

1. `CompilerService.compileForRun()` looks for host features in the source tokens
   (`web-ide/compiler/host-features.js`): `channel`, `<-`, `send`/`recv`, `spawn`,
   `select`, `yield`, `tensor`, `semantic`, `matmul`, `ai_*`, `test`, `snapshot`,
   and contracts.
2. A host program is compiled and executed by engine #1; even if engine #2 was
   loaded, the status bar keeps showing `engine #1 (host runtime)`.
3. A host-free program is still compiled by engine #2 for the WASM tab.
4. If #2 returns a "requires host runtime" error (or any other error), Run falls back
   to #1; the #2 error is not shown as final.

Example: `web-ide/examples/channels.lat` runs with a normal Run and produces

```text
producing 1
...
consumer finished: 5 items, sum = 55
fan-in total: 730
Result: 730
```

AI examples in a normal Run automatically enable the **mock** (no network or key
required). For the real model use **Run with AI** — then the configured AI Gateway,
pre-fetch, and self-repair are active.

With an explicit **Engine #2** choice a host program is not compiled: the IDE shows an
explanation and a **Run in engine #1** button so the user can switch to the full
runtime immediately. Rewriting engine #2 to support host features is not required.

## Engine #2 limitations

### Host primitives: an error, not a stub

```text
Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)
Builtin 'ai_infer' не поддерживается движком №2 (требует host-рантайма)
Builtin 'tensor' не поддерживается движком №2 (требует host-рантайма)
Метод 'send' не поддерживается движком №2 (требует host-рантайма)
```

The full list: `channel`, `tensor`, `semantic`, `matmul`,
`cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones`, `snapshot`,
`ai_contract`, `enforce_contract`, `ai_infer`, `ai_embed`, `ai_stream`,
`stream_next`, the operators `ch <- v`/`<-ch`, and `ai_generate!`.

### Silent surrogates (they compile, but the semantics differ)

- `spawn { }` / `spawn f()` — sequential execution in the current function;
- `select` — channel expressions are not evaluated, the first branch runs;
- `yield` — no-op;
- `await` — passthrough; `async fn` is an ordinary function;
- top-level `let`/expressions — type-checked, but not emitted;
- nested `fn`, decorated `fn`/`class` — not registered;
- `test` blocks — type-checked, but not emitted.

### "Compiles, but the WASM is invalid"

Codegen selects instructions by syntactic type and performs no conversions.
The typical cases:

| Example | Why |
|---|---|
| `let x: float = 1.0;` | the literal `1.0` is `i32.const`, the slot is `f64` |
| `let x: int = 1.5;` | an `i32` slot, an `f64` value |
| `1.5 + 1` | mixed `f64`/`i32` operands |
| `if (a > 3.0)` when `a: float` | comparing `f64` with `i32` |
| `5.5 % 2.0` | `%` is always `i32.rem_s` |
| `[1.5, 2.5]` | elements are written with `i32.store` |
| `class P { v: float; ... }` | a float field/parameter in an i32 method signature |
| `let x = 1.5; let f = fn() => x;` | a float capture through `i32.store` |
| `fn f() -> float { return 5.0; }` | an i32 return for an f64 signature |
| `fn f() -> unit { return; }` | a signature with a result, `return` without a value |
| `let x = print("a");` | a void call used as a value |
| `print(sqrt(16))` | the static type of `sqrt` is considered `Int` |
| `match` with void branches | `if` expects an i32 result |
| void method in statement position | `drop` after a void call |

That is why the documentation validates **every** `latent` example through
`web-ide/compiler.wasm` and `WebAssembly.validate()`; the expected-invalid blocks are
checked separately (markers `// Does not compile with engine #2`, `// error`,
`// host-only`).

### Semantic limitations

- No packages, inheritance, or generic classes; file modules (`import`/`export`)
  exist, but they are linked at compile time — see [modules](./modules.md).
- No GC/deallocation and no bounds checking.
- No exceptions; `assert` is a trap, `assert_eq` compares numbers as i32 bits and
  strings by content.
- No function or operator overloading; duplicates are not diagnosed.
- No `break`/`continue`, no `if` expressions, no compound assignments.
- "Invalid WASM" errors are not detected by the compiler.

## Validating documentation examples

```bash
node docs/scripts/validate-examples.mjs
```

The script reads all `docs/docs/**/*.md(x)`, extracts the ```` ```latent ```` blocks,
compiles them through `web-ide/compiler.wasm` (ABI
`latent_alloc`/`latent_compile`), validates the WASM, and prints a summary. For the
expected-invalid blocks it checks that they do **not** produce a valid module.
