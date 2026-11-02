---
title: Hello, world
sidebar_label: Hello, world
sidebar_position: 2
description: Your first Latent program — compiling to WASM and running it in Node.js and in the playground.
---

# Hello, world

Create a `hello.lat` file:

```latent
fn main() -> int {
    print("Hello, world!");
    return 0;
}
```

The entry point is the `main` function. It must return `int` (the exit code); if
`main` is not declared, the module will still compile, but it will have no
`main` export.

## Compilation

```bash
cargo build --bin latentc
./target/debug/latentc compile hello.lat hello.wasm
# hello.lat -> hello.wasm (NNN bytes)
```

On Windows the path to the binary is `target\debug\latentc.exe`:

```pwsh
cargo build --bin latentc
.\target\debug\latentc.exe compile hello.lat hello.wasm
```

A quick check without writing a file:

```bash
./target/debug/latentc check hello.lat
# ok: NNN bytes of wasm
```

## Running in Node.js

A compiled module imports `env.print(i32)` and exports `main` and `memory`.
`print` in a WASM module receives a **pointer to a string**; a string in linear
memory has the format `[length u32 LE][UTF-8 bytes]`.

Save a `run.mjs` file next to `hello.wasm`:

```javascript
// run.mjs — a minimal host runtime for a Latent WASM module.
import {readFileSync} from 'node:fs';

const bytes = readFileSync(process.argv[2] || 'hello.wasm');
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

if (typeof instance.exports.main !== 'function') {
  console.error('в модуле нет экспортированной main()');
  process.exit(2);
}
const code = instance.exports.main();
process.exitCode = typeof code === 'number' ? code : 0;
```

Running:

```bash
node run.mjs hello.wasm
# Hello, world!
```

`process.exitCode` will become `0` because `main` returned `0`.

There is also a ready-made debug script in the repository:

```bash
node scripts/verify-wasm.mjs hello.wasm --run
# validate: ok
# instantiate: ok
# Hello, world!
# main() = 0
```

## Running in the playground

In the browser, the same source can be executed with the **Run** button — that
is engine #1 (the JS interpreter). The **Compile / Engine #2** button runs the
Rust compiler and shows the WASM bytes but does not execute them: to run the
compiled module, use the host runtime from this chapter. Open the
[playground](./web-ide.mdx) and try both modes.

## What happened under the hood

1. The lexer split the source into tokens (`src/lexer/`).
2. The parser built an AST (`src/parser/`).
3. The type checker verified the program and inferred types (`src/typechecker/`).
4. The code generator assembled the binary WASM module (`src/codegen/`): the
   type, import, function, memory, export, code, and data sections.
5. The host instantiated the module, passing in `env.print`, and called `main`.

Note the strings: a string literal lives in the module's `data` section and is
encoded as `[length][UTF-8]`. That is exactly why `print` takes a pointer rather
than a JS string.

## Exercise

Compile a program that prints several values and returns a meaningful code:

```latent
fn main() -> int {
    let year = 2026;
    let language = "Latent";
    print(language + " ready in", year);
    return 42;
}
```

```bash
./target/debug/latentc compile hello.lat hello.wasm
node run.mjs hello.wasm
echo "exit code: $?"
# Latent ready in 2026
# exit code: 42
```

Next: [Compiler CLI](./cli.md) → [Web IDE](./web-ide.mdx) →
[Tutorial](../tutorial/index.md).
