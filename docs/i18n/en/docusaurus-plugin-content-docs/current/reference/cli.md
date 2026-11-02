---
title: "CLI: latentc"
description: "The latentc compiler commands and arguments, exit codes, output format, running the produced WASM in Node, and the main/print ABI."
sidebar_position: 8
---

# CLI `latentc`

Source: `src/bin/latentc.rs`. `latentc` is the only binary of the package
(`Cargo.toml`, `[lib] crate-type = ["cdylib", "rlib"]`; the binary is declared in
`src/bin/latentc.rs`). The version is `0.1.0`.

## Build

```bash
cargo build --bin latentc
# binary: target/debug/latentc (or target/release/latentc)
```

On Windows without an MSVC linker, build for the GNU target (see
[tooling/bootstrap](../tooling/bootstrap.md)):

```powershell
cargo build --bin latentc --target x86_64-pc-windows-gnu
# C:\...\latent\target\x86_64-pc-windows-gnu\debug\latentc.exe
```

## Commands

```text
latentc compile <file.lat> [out.wasm]   — compile a file to WASM
latentc check <file.lat>                — lexing + parsing + typing + codegen
latentc version | --version | -v        — the compiler version
```

The usage line the binary prints on an error/without arguments:

```text
latentc 0.1.0
usage:
  latentc compile <file.lat> [out.wasm]
  latentc check <file.lat>
  latentc version
```

### `latentc compile`

- `out.wasm` is optional. By default the path is the input path without the trailing
  `.lat` plus `.wasm` (`path.trim_end_matches(".lat") + ".wasm"`). For example
  `examples/sorting.lat` → `examples/sorting.wasm`.
- On success stdout gets: `<input> -> <output> (<N> bytes)`.
- On a compilation error stderr gets: `error: <diagnostic>` (see
  [errors](./errors.md)); no file is created.
- I/O errors: `cannot read <path>: <reason>`, `cannot write <out>: <reason>`.

```bash
latentc compile examples/sorting.lat && node run.js examples/sorting.wasm
```

### `latentc check`

A full compilation pass (including codegen), but no file is written:

- success: `ok: <N> bytes of wasm`;
- error: `error: <diagnostic>`.

Despite the name, `check` is not just a syntax check: it compiles the program to the
end, so it catches codegen errors too (for example
`Builtin 'tensor' не поддерживается…` — builtin not supported…).

## Exit codes

| Code | When |
|---|---|
| `0` | success (`compile`, `check`, `version`) |
| `1` | a compile/read/write error, wrong arguments, an unknown command |
| `101` | a Rust panic (for example, a file with a UTF-8 BOM in a debug build) |

There are no other codes. On a broken file `check`/`compile` print
`error: <diagnostic>` and return `1`; no file is created on an error.

:::warning
**BOM is not supported.** A `UTF-8 with BOM` file breaks the lexer: the wasm build
reports an error with an incorrect column, and a debug build of `latentc` crashes
(exit 101). Save sources without a BOM.
:::

## Running the produced WASM in Node

The module of the program (not of the compiler!) imports `env.print(i32)` and exports
`memory` and `main` (if `main` is declared). A minimal host:

```js
import { readFileSync } from 'node:fs';

const bytes = readFileSync('examples/sorting.wasm');
const { instance } = await WebAssembly.instantiate(bytes, {
  env: {
    print: (ptr) => {
      const dv = new DataView(instance.exports.memory.buffer);
      const len = dv.getUint32(ptr, true);            // [len u32 LE][utf8]
      const text = new TextDecoder().decode(
        new Uint8Array(instance.exports.memory.buffer, ptr + 4, len));
      console.log(text);
    },
  },
});

const result = instance.exports.main();   // i32 (or f64 if main -> float)
console.log('main() =', result);
```

Specifics:

- `print` is called **once per argument**, so `print("x =", x)` in engine #2 produces
  two lines.
- If `main` is not declared, the module is valid but there is no `main` export — the
  host must account for that.
- If `main` is declared with parameters (`fn main(a: int)`), the export still has the
  type `(params...) -> i32`; a call without arguments passes zero values (this is valid
  WASM, but not a "normal" scenario).
- If the program uses host-only features, compilation fails — such WASM simply will not
  exist.

## Running the WASM compiler (engine #2)

`compiler.wasm` is the compiler itself, built for `wasm32-unknown-unknown`
(`cargo build --release --target wasm32-unknown-unknown`). Its ABI is not `env.print`
but `latent_alloc/latent_compile/latent_free/latent_version`:

```js
const bytes = readFileSync('web-ide/compiler.wasm');
const { instance } = await WebAssembly.instantiate(bytes, {});
const ex = instance.exports;

const enc = new TextEncoder().encode('fn main() -> int { return 42; }');
const srcPtr = ex.latent_alloc(enc.length);
new Uint8Array(ex.memory.buffer).set(enc, srcPtr);
const resPtr = ex.latent_compile(srcPtr, enc.length);

const dv = new DataView(ex.memory.buffer);
const status = dv.getUint32(resPtr, true);      // 1 — wasm, 0 — error
const len = dv.getUint32(resPtr + 4, true);
const payload = new Uint8Array(ex.memory.buffer, resPtr + 8, len).slice();
```

The detailed contract is in the [WASM ABI](./wasm-abi.md#compiler-c-abi-engine-2-in-the-browser).

## Related sections

- [WASM ABI](./wasm-abi.md) — what exactly the module exports/imports.
- [Diagnostics](./errors.md) — the texts the CLI prints.
- [tooling/bootstrap](../tooling/bootstrap.md) — building the compiler and the
  self-hosted chain.
