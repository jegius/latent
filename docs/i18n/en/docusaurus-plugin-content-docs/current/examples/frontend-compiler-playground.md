---
title: "Your own playground: the Latent compiler as WASM"
sidebar_label: "Compiler in the browser"
sidebar_position: 15
description: "How to embed the Latent compiler (latent_alloc/latent_compile/latent_free) into your own page: an editor, compilation, running the result, downloading the .wasm, and protecting the page with a Worker."
---

# Your own playground: the Latent compiler as WASM

The Latent compiler is itself compiled to WebAssembly: `web-ide/compiler.wasm`
(465,435 bytes) exports the C ABI `latent_alloc` / `latent_compile` /
`latent_free` / `latent_version` and requires no imports. On top of it you can
build your own playground: a text area → compilation in the browser → running the
result → downloading the `.wasm`.

This case is a minimal but working version of such a page. For the reference
implementation of the loader and the caching, see
`web-ide/compiler/wasm-loader.js` in the repository.

## The compiler ABI

| Export | Signature | Purpose |
|---|---|---|
| `latent_alloc` | `(i32 size) -> i32` | allocate a buffer for the source |
| `latent_compile` | `(i32 src_ptr, i32 src_len) -> i32` | compile |
| `latent_free` | `(i32 ptr, i32 size)` | free the buffer |
| `latent_version` | `() -> i32` | `[len][utf8]` with the version |

The format of the `latent_compile` response:

```text
[status u32 LE][len u32 LE][payload: len bytes]
status = 1 → payload holds the .wasm bytes
status = 0 → payload holds a UTF-8 compiler error message
```

The compiler is instantiated without imports: `WebAssembly.instantiate(bytes, {})`.
Compilation errors are a plain `status = 0` with Russian text, not a WASM
exception.

## A sample program for the editor

```latent
fn main() -> int {
    let total = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        total = total + i;
    }
    print("sum 1..10 =", total);
    return total;
}
```

## The complete page

Put `compiler.wasm` next to it and open the page through an HTTP server (not
`file://`).

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Latent playground</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; max-width: 900px; }
    textarea { width: 100%; height: 220px; font: 13px/1.5 ui-monospace, monospace; }
    .row { display: flex; gap: .5rem; margin: .75rem 0; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 8px; min-height: 4rem; }
    button:disabled { opacity: .5; }
  </style>
</head>
<body>
  <h1>Latent playground</h1>

  <textarea id="src" spellcheck="false">fn main() -> int {
    let total = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        total = total + i;
    }
    print("sum 1..10 =", total);
    return total;
}</textarea>

  <div class="row">
    <button id="run">Скомпилировать и запустить</button>
    <button id="download" disabled>Скачать .wasm</button>
  </div>

  <pre id="out"></pre>

  <script type="module">
    const COMPILER_URL = './compiler.wasm';

    const srcEl = document.getElementById('src');
    const outEl = document.getElementById('out');
    const runBtn = document.getElementById('run');
    const downloadBtn = document.getElementById('download');

    let compilerPromise = null;
    let lastWasm = null;

    const log = (line) => { outEl.textContent += line + '\n'; };

    function loadCompiler() {
      compilerPromise ??= (async () => {
        const response = await fetch(COMPILER_URL);
        if (!response.ok) {
          throw new Error(`compiler.wasm: HTTP ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        const {instance} = await WebAssembly.instantiate(bytes, {});
        return instance.exports;
      })();
      return compilerPromise;
    }

    function compile(compiler, source) {
      const encoded = new TextEncoder().encode(source);
      const srcPtr = compiler.latent_alloc(Math.max(encoded.length, 1));
      new Uint8Array(compiler.memory.buffer).set(encoded, srcPtr);

      const resPtr = compiler.latent_compile(srcPtr, encoded.length);
      const view = new DataView(compiler.memory.buffer);
      const status = view.getUint32(resPtr, true);
      const len = view.getUint32(resPtr + 4, true);
      const payload = new Uint8Array(
        compiler.memory.buffer, resPtr + 8, len,
      ).slice();

      compiler.latent_free(srcPtr, Math.max(encoded.length, 1));
      compiler.latent_free(resPtr, 8 + len);

      if (status !== 1) {
        throw new Error(new TextDecoder().decode(payload));
      }
      return payload;
    }

    async function run(source) {
      const compiler = await loadCompiler();
      const wasm = compile(compiler, source);
      lastWasm = wasm;
      downloadBtn.disabled = false;

      let instance;
      const imports = {
        env: {
          print(ptr) {
            const memory = instance.exports.memory;
            const view = new DataView(memory.buffer);
            const len = view.getUint32(ptr, true);
            log(new TextDecoder().decode(
              new Uint8Array(memory.buffer, ptr + 4, len),
            ));
          },
        },
      };

      ({instance} = await WebAssembly.instantiate(wasm, imports));

      if (typeof instance.exports.main !== 'function') {
        log('В модуле нет экспортированной main().');
        return;
      }
      const result = instance.exports.main();
      log(`main() = ${result}`);
    }

    runBtn.addEventListener('click', async () => {
      outEl.textContent = '';
      lastWasm = null;
      downloadBtn.disabled = true;
      try {
        await run(srcEl.value);
      } catch (error) {
        log(`Ошибка: ${error.message}`);
      }
    });

    downloadBtn.addEventListener('click', () => {
      if (!lastWasm) return;
      const blob = new Blob([lastWasm], {type: 'application/wasm'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'program.wasm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  </script>
</body>
</html>
```

**What you will see:** `sum 1..10 =` and `55` appear in the `<pre>` (two lines,
because `print` calls `env.print` for each argument), then `main() = 55`. The
`Скачать .wasm` button becomes active and saves the compiled module — you can open
it in [Latent in the browser](../getting-started/web-browser.md).

## Caching the compiler

`compiler.wasm` is 465 KB; downloading it on every page open is wasteful. The web
IDE loader uses the Cache API (`latent-compiler-v1`):

```js
async function loadCompilerBytes(url, cacheName = 'latent-compiler-v1') {
  if ('caches' in window) {
    const cache = await caches.open(cacheName);
    let response = await cache.match(url);
    if (!response) {
      response = await fetch(url);
      if (response.ok) await cache.put(url, response.clone());
    }
    if (response) return response.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}
```

Change the cache name when you update the compiler, otherwise the browser keeps
serving the old version.

## Safety: a Worker and a timeout

The compiled module runs in the WASM sandbox, but:

- **an infinite loop cannot be interrupted** — `main()` is synchronous and the page
  hangs;
- **memory is not limited by `max`** — a program can grow up to the browser's
  limit;
- **a trap** (for example `assert(false)`) kills only the call, not the page.

For untrusted code, compile and run inside a Web Worker and put a timeout on the
outside:

```js
const worker = new Worker(new URL('./compile-worker.js', import.meta.url), {
  type: 'module',
});
const timer = setTimeout(() => worker.terminate(), 3000);

worker.onmessage = ({data}) => {
  clearTimeout(timer);
  if (data.ok) {
    console.log('output:', data.output, 'result:', data.result);
  } else {
    console.error(data.error);
  }
};

worker.postMessage({source: 'fn main() -> int { return 1; }'});
```

```js
// compile-worker.js — compilation and execution in the worker.
self.onmessage = async ({data}) => {
  try {
    const compilerBytes = await (await fetch('./compiler.wasm')).arrayBuffer();
    const {instance: compiler} = await WebAssembly.instantiate(compilerBytes, {});
    // ... compile() from the full example above ...
    const wasm = compile(compiler, data.source);

    let instance;
    const output = [];
    const imports = {env: {print(ptr) {
      const memory = instance.exports.memory;
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      output.push(new TextDecoder().decode(
        new Uint8Array(memory.buffer, ptr + 4, len),
      ));
    }}};
    ({instance} = await WebAssembly.instantiate(wasm, imports));
    const result = instance.exports.main?.();
    self.postMessage({ok: true, output, result});
  } catch (error) {
    self.postMessage({ok: false, error: String(error)});
  }
};
```

`worker.terminate()` is the only way to interrupt `main`; after it, the instance
(and the compiler) have to be created again.

## Limitations of the case

- **The compiler is 465 KB.** That is noticeable for a lightweight page; cache it
  or move it into a separate lazy module.
- **No error highlighting by line.** The compiler returns text
  (`Неожиданный символ ... на строке N:M`); parsing it for highlighting is manual
  work.
- **No `wasm-opt`, no source maps.** What you compile is what you run.
- **The compiler and the result share the compiler's memory.** The source and
  response buffers are released with `latent_free`; the compiler itself lives in
  its own memory and does not overlap the memory of the compiled module (which is
  a separate instance).
- **Do not use `instantiateStreaming`.** It requires `Content-Type:
  application/wasm`; `arrayBuffer` + `instantiate` is more reliable.
- **A long `main` freezes the tab.** See the Worker above.
- **Nothing checks that the module is safe.** WASM is isolated from the DOM, but
  not from CPU and memory.

## Things to try

1. Highlight the line from the error text (`на строке (\d+):(\d+)`).
2. Build a list of examples (`<select>`) and insert the source into the editor.
3. Show a hex dump of the WASM (like the WASM tab in the web IDE).
4. Save the source in `localStorage` and restore it on load.
5. Compare the size of `compiler.wasm` with that of a compiled program (~1 KB).

## Related sections

- [WASM ABI](../reference/wasm-abi.md#compiler-c-abi-engine-2-in-the-browser) —
  the compiler contract.
- [Web IDE](../tooling/web-ide.md) — a ready-made playground.
- [Latent in the browser](../getting-started/web-browser.md) — running the result.
- [Engines](../specs/engines.md) — how the compiler differs from the interpreter.
