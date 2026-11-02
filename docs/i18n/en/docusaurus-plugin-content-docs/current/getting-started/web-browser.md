---
title: "Latent in the browser in 5 minutes"
sidebar_label: "Latent in the browser"
sidebar_position: 5
description: "Compiling .lat to .wasm, loading the module with fetch and WebAssembly.instantiate, the env.print import, reading main(), and a ready-to-use HTML file."
---

# Latent in the browser in 5 minutes

A compiled Latent module is an ordinary WebAssembly module with one import
(`env.print`) and two exports (`memory` and `main`). You can load it into any
page: no bundler, no `wasm-bindgen`, and no separate runtime library.

In five minutes we will walk the path: `.lat` → `.wasm` → `fetch` →
`WebAssembly.instantiate` → calling `main()` → output into a `pre`.

## What you will need

| What | Why |
|---|---|
| A compiled `hello.wasm` | the result of `latentc compile` (step 1) |
| Any HTTP server | over `file://` the browser will not serve `.wasm` through `fetch` |
| A modern browser | `WebAssembly`, `TextDecoder`, ES modules |

## Step 1. Compile `.lat` to `.wasm`

Create `hello.lat`:

```latent
fn main() -> int {
    print("Hello from Latent!");
    print("2 + 2 =", 2 + 2);
    return 42;
}
```

Compile it with the CLI compiler (building it is covered in
[the `latentc` CLI](./cli.md)):

```bash
cargo build --bin latentc
./target/debug/latentc compile hello.lat hello.wasm
# hello.lat -> hello.wasm (NNN bytes)
```

On Windows:

```pwsh
cargo build --bin latentc
.\target\debug\latentc.exe compile hello.lat hello.wasm
```

Put `hello.wasm` next to the HTML page.

:::note The web IDE does not save `.wasm` as a file
In the [playground](https://jegius.github.io/latent/playground/) the **Engine #2**
button and the **WASM** tab compile the program and show a hex dump of the bytes,
but there is no "download `.wasm`" button there. For a file, use `latentc`; if you
specifically need a browser compiler that saves the result, see
[Your own playground](../examples/frontend-compiler-playground.md).
:::

## Step 2. Load the module in the browser

Save an `index.html` file next to `hello.wasm`:

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Latent в браузере</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Latent в браузере</h1>
  <pre id="out"></pre>

  <script type="module">
    const out = document.getElementById('out');
    const log = (line) => { out.textContent += line + '\n'; };

    // A Latent string in memory: [len u32 LE][UTF-8 bytes]; the pointer points at len.
    function readString(memory, ptr) {
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
      return new TextDecoder().decode(bytes);
    }

    let instance; // needed inside env.print
    const imports = {
      env: {
        print(ptr) {
          log(readString(instance.exports.memory, ptr));
        },
      },
    };

    try {
      const response = await fetch('./hello.wasm');
      if (!response.ok) {
        throw new Error(`не удалось загрузить hello.wasm: HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      ({instance} = await WebAssembly.instantiate(bytes, imports));

      const result = instance.exports.main();
      log(`main() = ${result}`);
    } catch (error) {
      log(`Ошибка: ${error.message}`);
    }
  </script>
</body>
</html>
```

Start a static server from the directory with the files — for example:

```bash
npx serve .
# or: python3 -m http.server 8000
```

and open the page.

## What you will see

```
Hello from Latent!
2 + 2 =
4
main() = 42
```

Note that `print("2 + 2 =", 2 + 2)` in engine #2 calls `env.print` **for every
argument**, so the string and the number are printed on separate lines. A module
running in Node.js behaves the same way
([WASM and execution](../guide/wasm-and-execution.md)).

## How it works

- **One import.** The module always imports `env.print(i32)` — even if `print`
  is never called in the program. If you do not pass this import,
  `WebAssembly.instantiate` throws
  `Import #0 "env": module is not an object or function`.
- **Two exports.** `memory` and `main` (the latter only if `fn main` is
  declared). The module exports neither `alloc` nor `free` nor the runtime
  helpers, and it has no start section.
- **`print` receives a pointer.** The argument is the address of a
  `[len u32 LE][utf8]` string in linear memory. The host reads `len` and then
  `len` bytes of UTF-8. That is why `readString` always takes the **current**
  `memory.buffer`.
- **`main()` is called manually.** The module has no start section: until JS
  calls `exports.main()`, the program does not run. The result is an `i32`
  (`number`), an `f64` (`number`), or `undefined` if `main` returns nothing.

## Limitations in five minutes

- Only `main` is exported; there are no separate functions, classes, or structs
  on the outside. All communication goes through `main` and linear memory.
- The DOM/`fetch`/`localStorage` host API is not available from Latent: there is
  exactly one import.
- In this example `main` has no input arguments; for how to pass data, see
  [Latent in the frontend](../guide/web-and-frontend.md).
- The initial memory is 16 pages (1 MiB) with no upper limit; the allocator is a
  bump allocator, with no `free` and no GC.
- `float` in engine #2 is supported only partially and easily produces invalid
  WASM; check with `WebAssembly.validate`.
- The module is synchronous: a long `main` blocks the thread — use a Web Worker
  for heavy computations.

## Where to go next

- [Latent in the frontend](../guide/web-and-frontend.md) — the ABI, strings and
  arrays, React/Vue/Svelte, Workers, caching, patterns, and limitations.
- [Examples: calculator](../examples/frontend-calculator.md),
  [data](../examples/frontend-data-processing.md),
  [strings](../examples/frontend-strings.md),
  [React](../examples/frontend-react.md),
  [canvas](../examples/frontend-canvas.md),
  [your own playground](../examples/frontend-compiler-playground.md).
- [WASM and execution](../guide/wasm-and-execution.md) — running in Node.js and
  the differences between the engines.
- [WASM ABI](../reference/wasm-abi.md) — the exact contract of the module.

Open the playground: [jegius.github.io/latent/playground](https://jegius.github.io/latent/playground/).
