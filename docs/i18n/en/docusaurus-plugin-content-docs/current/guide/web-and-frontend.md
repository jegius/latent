---
title: "Latent in the frontend"
sidebar_label: "Latent in the frontend"
sidebar_position: 17
description: "The execution model of a Latent module in the browser: the main/memory/env.print ABI, passing strings and arrays through linear memory, patterns for JS/React/Vue/Svelte, Web Workers, caching, a comparison with alternatives, and limitations."
---

# Latent in the frontend

Latent does not try to replace JavaScript. Its niche in the frontend is a **pure
computational core**: a small WASM module that runs an algorithm, parses a
string, validates data, or prepares a frame, while all the UI, DOM, network, and
storage stay in JS/React/Vue.

This guide describes the real contract of such a module: what it imports and
exports, how to pass data through linear memory, which architectural patterns
work, and which limitations you will have to work around. All examples are
verified by the `web-ide/compiler.wasm` compiler; the cases are in the
[Examples](../examples/index.md) section.

## 1. Execution model: a module + a JS host

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│ JS / React / Vue (UI)        │        │ WebAssembly.Instance (Latent) │
│                              │        │                               │
│  fetch / DOM / state         │        │  main() -> i32 | f64 | void   │
│  DataView ←→ memory.buffer   │◀──────▶│  memory: 16 pages (1 MiB)     │
│  env.print(ptr) ◀────────────┼────────┤  print(...) → env.print(ptr)  │
└──────────────────────────────┘        └───────────────────────────────┘
```

Key properties of the model:

- **The module is synchronous.** It has no event loop, timers, `fetch`, or DOM.
  `main()` runs to completion and returns a value; everything that has to happen
  afterwards is done by the host.
- **One instance means one linear memory.** Memory is preserved between `main()`
  calls, so it can be used as state (the language has no global variables).
- **No start section.** Until JS calls `exports.main()`, nothing happens.
- **No GC and no `free`.** The allocator is a bump allocator: memory only grows.
  A long-lived page must either reuse buffers or recreate the instance.
- **The JS↔WASM boundary is cheap**, but every value is an `i32`/`f64`; "objects"
  are passed as pointers into linear memory.

## 2. The ABI: what the module imports and exports

### 2.1. Imports: only `env.print`

```text
(import "env" "print" (func (param i32)))
```

- The import is **always** present, even if `print` is never called in the
  program. If you do not pass it to `instantiate`, you get the error
  `Import #0 "env": module is not an object or function`.
- `print` receives a pointer to a `[len u32 LE][utf8]` string; the module has no
  other imports — no `memory`, no `abort`, no `now`.
- Every `print(...)` argument calls `env.print` separately.

### 2.2. Exports: `memory` and, as a rule, `main`

| Name | Kind | When it exists |
|---|---|---|
| `memory` | memory | always |
| `main` | function | if `fn main` is declared in the program |

Neither `alloc`, nor `free`, nor the runtime helpers, nor user functions are
exported. A module without `main` is valid, but it exports memory only.

### 2.3. `main` signature

| Declaration | Export | What JS gets |
|---|---|---|
| `fn main() -> int` | `() -> i32` | `number` |
| `fn main() -> float` | `() -> f64` | `number` |
| `fn main()` with no `return` | `() -> void` | `undefined` |
| `fn main()` with `return expr` and no annotation | `() -> i32` | `number` |
| `fn main() -> string` | `() -> i32` | a pointer to a string |
| `fn main() -> [int]` | `() -> i32` | a pointer to an array |

You can return a pointer to a string or an array as long as you do not specify
`int`: `-> string` and `-> [int]` compile to an `i32` result. This is the main
way to hand a structured result back to the host.

:::caution `main` parameters are a working but informal feature
The canonical ABI is `main()` **without arguments**. But if you declare
parameters, the export keeps their signature, and JS can pass values:

```latent
fn main(n: int) -> int {
    return n * 2;
}
```

```js
instance.exports.main(21); // 42
```

Strings and arrays are passed as `i32` pointers to `[len][...]` (see §3).
This is verified on the current compiler and is convenient when the host and the
module are written together. The downside: a foreign host that calls `main()`
with no arguments will pass zeros — the program will get the pointer `0` and see
an empty string/a zero-length array (or zeros, if it reads through `load32`).
So in "general-purpose" modules use `main()` with no parameters and a fixed
memory area, and keep parameters for your own pages and workers, where the
contract is known to both sides.
:::

### 2.4. Repeated `main` calls

`main()` can be called many times: local variables are created anew, while the
heap and the memory persist. The language provides no global variables, so state
between calls is kept in linear memory:

```latent
fn main(pass: int) -> int {
    let state = load32(20);
    if (state == 0) {
        state = alloc(64);
        store32(20, state);
    }
    store32(state, load32(state) + 1);
    return load32(state);
}
```

The same property means that every call that allocates something **grows** the
heap: memory is never reused.

## 3. Data through linear memory

All multi-byte values are little-endian. `i32.load`/`i32.store` in codegen use
an alignment of 4, and `f64` uses 8.

### 3.1. Numbers

| Latent type | WASM | In memory | Note |
|---|---|---|---|
| `int` | `i32` | 4 bytes | signed, 32-bit; overflow wraps around |
| `bool` | `i32` | 4 bytes | `0`/`1` |
| `null` | `i32` | 4 bytes | `0` |
| `float` | `f64` | 8 bytes | scalar only; poorly representable in arrays/fields |
| `string` | `i32` | pointer | see §3.2 |
| `[T]` | `i32` | pointer | elements are 4 bytes each |
| class/enum/closure | `i32` | pointer | layout — in [WASM ABI](../reference/wasm-abi.md) |

There is no `i64` in the language. Engine #2 cannot represent `[float]` arrays:
the elements are always written with a 4-byte `i32.store`, so `[1.5, 2.5]`
produces invalid WASM. For real vectors use fixed point (scale the numbers to
`int`), compute in JS, or wait for full `f64` array support.

### 3.2. Strings: `[len u32 LE][utf8]`

```text
address → +0: length in bytes (u32 LE)
          +4: UTF-8 bytes
```

- The string pointer points at the length, not at the first byte.
- `len(s)` and `s.length` return the length in **UTF-8 bytes**, not in
  characters. `"привет".length` = 12, `"Latent".length` = 6.
- `s[i]` returns a **byte** (`0..255`), not a character: `"abc"[0]` = 97.
- `+` concatenates strings, and `==` compares their contents; `<`/`>` compare
  pointers (do not use them for strings).
- Strings are immutable; concatenation allocates a new string every time.

JS helpers:

```js
function readString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

function writeString(memory, ptr, text) {
  const bytes = new TextEncoder().encode(text); // length in UTF-8 bytes
  ensureCapacity(memory, ptr + 4 + bytes.length);
  new DataView(memory.buffer).setUint32(ptr, bytes.length, true);
  new Uint8Array(memory.buffer).set(bytes, ptr + 4);
  return ptr;
}
```

`TextEncoder`/`TextDecoder` work with UTF-8 — exactly the Latent format. Do not
use `text.length` for the length: in JS it counts UTF-16 code units.

Building a string from raw bytes inside Latent itself is impossible: there is no
"string from a buffer" builtin. So an input string is either passed by pointer
(JS writes `[len][utf8]`) or is a literal in the source; bytes can be read
through indexing and `load8`.

### 3.3. Arrays: `[len u32][i32...]`

```text
address → +0: length (u32 LE)
          +4: element 0 (i32)
          +8: element 1 (i32)
          ...
```

- The element is always 4 bytes; there are no `float` arrays.
- `arr[i]` = `i32.load(arr + 4 + i*4)`; `a[i] = v` writes in place.
- Bounds are not checked: going out of range means memory corruption or a trap.
- Arrays are passed by pointer and mutated in place.
- `push` does **not reserve** capacity: it writes past the current length, even
  if the block was allocated smaller. That is safe only while there are no other
  allocations (strings, new arrays, `new`) between `push` and the read. In
  detail — [Bump allocator and `push`](./arrays-and-strings.md#arrays).

JS helpers:

```js
function readI32Array(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return Array.from({length: len}, (_, i) => view.getInt32(ptr + 4 + i * 4, true));
}

function writeI32Array(memory, ptr, values) {
  ensureCapacity(memory, ptr + 4 + values.length * 4);
  const view = new DataView(memory.buffer);
  view.setUint32(ptr, values.length, true);
  for (let i = 0; i < values.length; i += 1) {
    view.setInt32(ptr + 4 + i * 4, values[i], true);
  }
  return ptr;
}
```

### 3.4. Where to put the input data

The compiler places string literals in the data section starting at address
1024, and the heap begins after them. The `0..1023` area is not used in the
current implementation, and it is convenient to take it over as a "mailbox"
between the host and the module: for example, address `16` for a header and `20`
for an array. This is a **convention, not part of the ABI**: do not rely on it
if the compiler changes the layout, and do not write to the area from 1024
upward without knowing that the literals and the heap live there.

```js
function ensureCapacity(memory, endByte) {
  const needPages = Math.ceil(endByte / 65536);
  const havePages = memory.buffer.byteLength / 65536;
  if (needPages > havePages) memory.grow(needPages - havePages);
}
```

There are three ways to pass the input:

| Way | How | When |
|---|---|---|
| A constant in the source | `let expr = "2 + 3";` and compiling for every input | rare inputs, demos, tests |
| A `main` parameter | `fn main(data: [int])`, JS writes `[len][i32...]` and calls `main(ptr)` | your own host/worker, the contract is known |
| A fixed area | `main()` with no arguments reads `load32(16)`/`load8(20+i)` | a strict ABI, foreign hosts, minimal coupling |

The third way also works without `main` parameters, but it requires the program
to know the address of the "mailbox". The second is shorter and more type-safe
inside Latent, but it relies on informal parameter passing (see §2.3).

### 3.5. How to read the result

- `i32`/`f64` — an ordinary JS number (`typeof result === 'number'`).
- `void` — `undefined`.
- A string/array — an `i32` pointer: read `[len]` and the data as in §3.2–3.3.
- The result type is not visible at runtime: `WebAssembly` does not keep it in
  the export for JS. Record the contract (what exactly `main` returned) in the
  page code.

```js
const result = instance.exports.main();
if (typeof result === 'number') {
  // i32 or f64 — depends on the main declaration
}
```

## 4. How to call `main` and what to catch

```js
let instance;
const imports = {
  env: {
    print(ptr) {
      console.log(readString(instance.exports.memory, ptr));
    },
  },
};

const bytes = await (await fetch('/core.wasm')).arrayBuffer();
({instance} = await WebAssembly.instantiate(bytes, imports));

if (typeof instance.exports.main !== 'function') {
  throw new Error('в модуле нет экспортированной main()');
}

try {
  const result = instance.exports.main();
  console.log('main() =', result);
} catch (error) {
  // WebAssembly.RuntimeError: a trap (unreachable from assert, division by 0,
  // out-of-bounds memory) — the program did not "return an error", it aborted.
  console.error('Latent trap:', error);
}
```

- `assert(false)` and division by zero produce a **trap**, not an error code. If
  you need soft handling, return `-1`/`enum Result` and check the result.
- Compilation errors (`latentc`) and instantiation errors (`Import ...`) are
  different stages; the first comes as text from the compiler, the second as a
  JS exception.
- `main` is synchronous: there are no timeouts and no interrupts. For untrusted
  code, use only a Web Worker with `terminate()` (see §6.5).

## 5. Architectural patterns

### 5.1. A pure computational core

The most reliable pattern: Latent computes a function of numbers, and the UI
stays in JS.

```latent
// The number of primes <= n.
fn is_prime(n: int) -> bool {
    if (n < 2) {
        return false;
    }
    let d = 2;
    while (d * d <= n) {
        if (n % d == 0) {
            return false;
        }
        d = d + 1;
    }
    return true;
}

fn main(n: int) -> int {
    let count = 0;
    let i = 2;
    while (i <= n) {
        if (is_prime(i)) {
            count = count + 1;
        }
        i = i + 1;
    }
    return count;
}
```

```js
const result = instance.exports.main(1000); // 168
```

Pluses: no allocations, no state, reproducible, easy to test. Minuses: all
communication is numbers; strings and arrays require the ABI from §3.

### 5.2. Data and processing

The array lives in memory, and the module sorts/filters/aggregates it in place.

```latent
// The sum of the elements that are not less than the threshold.
fn main(data: [int], threshold: int) -> int {
    let total = 0;
    for (let value in data) {
        if (value >= threshold) {
            total = total + value;
        }
    }
    return total;
}
```

```js
writeI32Array(memory, 16, [42, 7, 19, 3, 88, 21, 10, 55]);
const sum = instance.exports.main(16, 10); // 235
```

For sorting, return the same pointer (`fn main(data: [int]) -> [int]`) or build
a new array. Remember: `push` does not reserve capacity, and memory is never
freed. Process large data in chunks or in a worker.

### 5.3. AI features in the browser

Here it is important not to confuse the engines:

| | Engine #1 (JS interpreter) | Engine #2 (Rust → WASM) |
|---|---|---|
| `ai_infer`, `ai_embed`, `ai_stream` | executes through the host gateway | the "requires the host runtime" error |
| `tensor`, `semantic`, `matmul`, `cosine_similarity` | JS host objects | an error |
| "Run with AI" / self-repair | yes | no |
| Execution in the browser (in the web IDE) | yes (the interpreter) | no: compilation only |

That is, Latent's AI primitives in the browser are **host features of engine
#1**: they are implemented in JS (`web-ide/compiler/ai-gateway.js`), require a
configured provider (Ollama or an OpenAI-compatible endpoint), CORS on the
gateway, and a key (if the provider needs one; it is stored in `localStorage`).
Without "Run with AI" they throw
`AI is not enabled. Use "Compile & Run with AI" button.`

```latent
// host-only: this block is compiled only by engine #1.
fn main() -> int {
    let answer = ai_infer("gpt-4", "ping");
    print(answer);
    return 0;
}
```

In a production frontend the AI call is almost always made by JS/the backend,
and Latent receives numbers: probabilities, counters, fixed point. Embeddings
are `float` vectors, and `[float]` is not representable in engine #2, so cosine
similarity on Latent in WASM cannot be done today without manual fixed point.

### 5.4. An interactive playground as a learning environment

A playground is the same "compiler + run" pattern, but with an editor and output.
It is useful for:

- showing the difference between engines #1 and #2 on the same source;
- letting people try the language without installing anything;
- sharing a link to the code (base64 in the URL);
- demonstrating compiler errors and the WASM bytes.

Limitations: in the playground engine #2 only compiles (it does not execute), and
host features are available only in engine #1. In detail —
[Web IDE](../tooling/web-ide.md) and [engines](../specs/engines.md).

### 5.5. The compiler in the browser (code-in-browser)

The Latent compiler itself is built to WASM (`web-ide/compiler.wasm`, 465,435
bytes) and exports a C ABI:

| Export | Signature | Purpose |
|---|---|---|
| `latent_alloc` | `(i32 size) -> i32` | allocate a buffer for the source |
| `latent_compile` | `(i32 src_ptr, i32 src_len) -> i32` | compile |
| `latent_free` | `(i32 ptr, i32 size)` | free the buffer |
| `latent_version` | `() -> i32` | `[len][utf8]` with the version |

The `latent_compile` response is `[status u32][len u32][payload]`, where
`status = 1` means WASM bytes and `status = 0` means a UTF-8 error text. The
compiler is instantiated without imports: `WebAssembly.instantiate(bytes, {})`.

You can build your own playground on this ABI: a text editor → `latent_compile`
→ `WebAssembly.instantiate` of the result → `main()` → output. A ready-made
self-contained example is
[Your own playground](../examples/frontend-compiler-playground.md); the reference
loader is `web-ide/compiler/wasm-loader.js` in the repository.

## 6. Integration

### 6.1. Vanilla JS

The minimal recipe is in
[Latent in the browser in 5 minutes](../getting-started/web-browser.md): `fetch`
→ `arrayBuffer` → `instantiate` → `main()`. Load the module once and reuse the
instance, unless state gets in the way.

### 6.2. React: `useEffect` + `ref`

The component below loads `sum.wasm`, calls `main(n)` when `n` changes, and
displays the string that the core returned.

```latent
fn main(n: int) -> string {
    let total = 0;
    let i = 1;
    while (i <= n) {
        total = total + i;
        i = i + 1;
    }
    return "sum 1.." + str(n) + " = " + str(total);
}
```

```tsx
// src/SumPanel.tsx
import {useEffect, useRef, useState} from 'react';
import wasmUrl from './sum.wasm?url'; // Vite: an asset URL

let modulePromise: Promise<WebAssembly.Module> | null = null;

function loadModule() {
  modulePromise ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`wasm: HTTP ${response.status}`);
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  return modulePromise;
}

function readString(memory: WebAssembly.Memory, ptr: number) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

export function SumPanel({initial = 100}: {initial?: number}) {
  const [n, setN] = useState(initial);
  const [text, setText] = useState('…');
  const [error, setError] = useState<string | null>(null);
  const instanceRef = useRef<WebAssembly.Instance | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!instanceRef.current) {
          const module = await loadModule();
          let inst: WebAssembly.Instance | null = null;
          const imports = {
            env: {
              print(ptr: number) {
                if (inst) {
                  console.log('[latent]', readString(inst.exports.memory as WebAssembly.Memory, ptr));
                }
              },
            },
          };
          inst = await WebAssembly.instantiate(module, imports);
          instanceRef.current = inst;
        }

        if (cancelled) return;
        const instance = instanceRef.current!;
        const main = instance.exports.main as (value: number) => number;
        const ptr = main(n);
        setText(readString(instance.exports.memory as WebAssembly.Memory, ptr));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [n]);

  return (
    <div>
      <input
        type="range" min={1} max={1000} value={n}
        onChange={(event) => setN(Number(event.target.value))}
      />
      <output>{text}</output>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

What matters in this code:

- **The module is cached at module level.** `modulePromise` outlives the
  component; a remount does not download the `.wasm` again.
- **The instance lives in a `ref`.** `useState` for the instance would cause
  extra re-renders, and the effect itself runs twice in Strict Mode — the module
  cache survives that.
- **`cancelled`** protects against `setState` after unmounting.
- **`main` is called in the effect**, not in render: a WASM call is a side
  effect and can be expensive.
- **`memory.buffer` is re-read** on every read: after `memory.grow` the old
  `ArrayBuffer` is detached.

If the project uses Next.js/Nuxt and renders on the server, this component must
mount on the client only (`useEffect`/`onMounted` already give you that), and do
not call `WebAssembly` in the SSR build.

### 6.3. Vue and Svelte

Vue 3 (`<script setup>`):

```vue
<script setup>
import {onMounted, ref} from 'vue';
import wasmUrl from './sum.wasm?url';

const text = ref('');
let instance;

onMounted(async () => {
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  ({instance} = await WebAssembly.instantiate(bytes, {env: {print() {}}}));
  const ptr = instance.exports.main(100);
  const view = new DataView(instance.exports.memory.buffer);
  const len = view.getUint32(ptr, true);
  text.value = new TextDecoder().decode(
    new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
  );
});
</script>

<template><output>{{ text }}</output></template>
```

Svelte:

```svelte
<script>
  import {onMount} from 'svelte';
  let text = '';

  onMount(async () => {
    const bytes = await (await fetch('/sum.wasm')).arrayBuffer();
    const {instance} = await WebAssembly.instantiate(bytes, {env: {print() {}}});
    const ptr = instance.exports.main(100);
    const view = new DataView(instance.exports.memory.buffer);
    const len = view.getUint32(ptr, true);
    text = new TextDecoder().decode(
      new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
    );
  });
</script>

<output>{text}</output>
```

In both cases the logic is the same as in React: the module is loaded once for
the lifetime of the application, the instance is created on mount, and `main` is
called in a lifecycle hook.

### 6.4. Vite and Webpack: where to put the `.wasm`

**Vite, the `public/` option** — the file is not hashed and the URL is stable:

```text
public/core.wasm
```

```js
const url = `${import.meta.env.BASE_URL}core.wasm`;
const bytes = await (await fetch(url)).arrayBuffer();
```

**Vite, the `?url` option** — the asset goes through the build and gets a hash:

```js
import wasmUrl from './core.wasm?url';
```

For TypeScript add `/// <reference types="vite/client" />` (it is usually already
present in `src/vite-env.d.ts`).

**Webpack 5** — the `asset/resource` rule:

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [{test: /\.wasm$/, type: 'asset/resource'}],
  },
};
```

```js
import wasmUrl from './core.wasm';
const bytes = await (await fetch(wasmUrl)).arrayBuffer();
```

Do not import `.wasm` as an ES module: a Latent module is not an ESM module but a
binary for `WebAssembly.instantiate`.

About MIME types: `WebAssembly.instantiateStreaming` has strict requirements on
`Content-Type: application/wasm`, while dev servers often serve
`application/octet-stream`. It is more reliable to download an `arrayBuffer` and
call `WebAssembly.instantiate(bytes, imports)` — that is what the web IDE loader
does too.

### 6.5. Web Worker

A synchronous `main` blocks the thread. For heavy computations or untrusted
code, move the module into a worker:

```js
// core.worker.js
let instance;

self.onmessage = async (event) => {
  const {type, payload} = event.data;

  if (type === 'init') {
    const bytes = await (await fetch(payload.url)).arrayBuffer();
    const imports = {
      env: {
        print(ptr) {
          const view = new DataView(instance.exports.memory.buffer);
          const len = view.getUint32(ptr, true);
          const line = new TextDecoder().decode(
            new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
          );
          self.postMessage({type: 'print', line});
        },
      },
    };
    instance = await WebAssembly.instantiate(bytes, imports);
    self.postMessage({type: 'ready'});
  }

  if (type === 'run') {
    try {
      const result = instance.exports.main(payload);
      self.postMessage({type: 'result', result});
    } catch (error) {
      self.postMessage({type: 'error', message: String(error)});
    }
  }
};
```

```js
const worker = new Worker(new URL('./core.worker.js', import.meta.url), {type: 'module'});
worker.postMessage({type: 'init', payload: {url: '/core.wasm'}});

// a safeguard against an infinite loop: WASM cannot be interrupted from inside
const timer = setTimeout(() => worker.terminate(), 2000);
worker.onmessage = ({data}) => {
  if (data.type === 'result') {
    clearTimeout(timer);
    console.log('result:', data.result);
  }
};
worker.postMessage({type: 'run', payload: 1000});
```

The worker has its own memory: `SharedArrayBuffer` and shared memory are neither
needed nor supported by the module. Results are copied through `postMessage`;
large arrays are better passed as a transferable `ArrayBuffer` rather than as a
JS array.

### 6.6. Caching

Three levels are worth distinguishing:

1. **The HTTP cache** — for hashed names (`core.abc123.wasm`) set
   `Cache-Control: public, max-age=31536000, immutable`.
2. **The Cache API** — if the file name is stable, cache the response manually
   and change the cache name when you update it (a secure context is required:
   HTTPS or `localhost`):

```js
async function loadWasmBytes(url, cacheName = 'latent-wasm-v1') {
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
  if (!response.ok) throw new Error(`wasm: HTTP ${response.status}`);
  return response.arrayBuffer();
}
```

3. **A compiled `WebAssembly.Module`** — in the memory of the page:

```js
const modulePromise = WebAssembly.compile(await loadWasmBytes('/core.wasm'));
// next: WebAssembly.instantiate(await modulePromise, imports)
```

Compilation is more expensive than instantiation: if you need many instances,
compile one module and instantiate it repeatedly. That is exactly what
`wasm-loader.js` in the web IDE does (it also has a Cache API cache named
`latent-compiler-v1`).

### 6.7. Performance and memory

| What | Cost | How not to pay twice |
|---|---|---|
| `fetch` + `compile` | tens of milliseconds or more | the module cache, the HTTP cache |
| `instantiate` | ~1 MiB of memory per instance | reuse the instance |
| the JS→WASM transition | cheap | do not split one operation into thousands of calls |
| `main` with allocations | the heap grows, there is no `free` | recreate the instance or cache buffers |
| `memory.grow` | detaches the old `buffer` | always take `memory.buffer` anew |
| `print` | a string allocation + a JS call per argument | do not print in a hot loop |
| string concatenation in a loop | O(n²) in memory | build a single array/buffer |
| `push` into `[]` | does not reserve capacity | a literal of the right size or `alloc` |

The rules that pay off:

- Compute in `int` (i32) when the task allows it; `float` in engine #2 is
  fragile.
- Keep the data in a single buffer and return a pointer instead of copying it
  back and forth.
- For animation, cache the frame buffer in memory (the "mailbox" address) and
  overwrite it instead of allocating on every frame.
- Do not call `main` more often than necessary (for example, from
  `requestAnimationFrame` only when the state actually changed).
- Check `WebAssembly.validate(bytes)` at build/test time.

### 6.8. Lazy loading and chunks

A WASM module is an **asset**, not an entry point. If you put it in the initial
bundle, the user downloads hundreds of kilobytes before the first computation.
The working pattern is a `dynamic import()` around the loader plus a separate
`.wasm` file:

```js
// engine.js — a lazy loader that caches the promise
let enginePromise = null;

export function loadEngine() {
  enginePromise ??= (async () => {
    // Vite/Rollup/webpack rewrite new URL into a hashed asset URL.
    const wasmUrl = new URL('./core.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`wasm: HTTP ${response.status}`);
    const { instance } = await WebAssembly.instantiate(
      await response.arrayBuffer(), {env: {print() {}}});
    return instance;
  })();
  return enginePromise;
}
```

```js
// UI: the module loads only on a user action
button.addEventListener('click', async () => {
  const { loadEngine } = await import('./engine.js');
  const instance = await loadEngine();
  console.log(instance.exports.main(100));
});
```

How to serve `.wasm` across bundlers:

| Bundler | Technique | Note |
|---|---|---|
| Vite | `import wasmUrl from './core.wasm?url'` | a hashed asset; a direct URL in dev |
| Vite / Rollup | `new URL('./core.wasm', import.meta.url)` | works with no plugins and in dev |
| Rollup | `@rollup/plugin-url` or `public/core.wasm` + `BASE_URL` | without a plugin, copying only |
| Webpack 5 | `{test: /\.wasm$/, type: 'asset/resource'}` | the import gives a URL, not an ES module |

Do not import `.wasm` as an ES module: a Latent module is a binary for
`WebAssembly.instantiate`. `instantiateStreaming` requires a correct
`Content-Type: application/wasm`; dev servers often send
`application/octet-stream`, so `arrayBuffer()` is more reliable.

**How to split your runtime.** Use the moment the code is needed as the guide:

| Chunk | What | Loaded |
|---|---|---|
| entry | UI, routing, state | start |
| core | parsers/validators the first screen needs | start |
| engine | `.wasm` + loader/ABI wrappers | first computation |
| examples/fixtures | demo code, large tables | click/route |

```js
// vite.config.js: the same approach as web-ide/vite.config.js
export default {
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/engine/')) return 'engine';
          if (id.includes('/examples/')) return 'examples';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
};
```

`manualChunks` groups modules, while `import()` decides **when** a chunk loads:
without a dynamic import the group still lands in the initial graph if anything
imports it statically. Verify via the entry file: a lazy chunk's name must not
be there (only `import("./engine-…")`).

**Metrics.** Sources: the `vite build` output (raw + gzip), `ls -lh
dist/assets` or `du -sh`, and DevTools → Network on a cold load. Practical
budgets for a small core: entry < 50 kB gzip, `.wasm` < 200 kB gzip (a Latent
module is a few KB; the compiler is ~135 kB gzip), lazy chunks are unbounded but
each must pay for itself. Reference numbers and config: see
[Web IDE](../tooling/web-ide.md#lazy-loading-and-chunks).

## 7. Comparison with alternatives

| Criterion | JS/TS | Rust → WASM (`wasm-bindgen`) | AssemblyScript | Latent (engine #2) |
|---|---|---|---|---|
| DOM access | native | through `web-sys`/bindings | through bindings | **no** |
| Function exports | any | any, with types | any | `main` only |
| Importing host functions | any | any | any | `env.print` only |
| Module size | — | tens to hundreds of KB | small + a runtime | ~1–3 KB |
| Garbage collection | yes | no (its own rules) | yes | **no** |
| String format | UTF-16 | UTF-8 + bindings | UTF-16 | UTF-8 by hand |
| `f64` arrays | `Float64Array` | yes | yes | **no** |
| Tooling | everything | mature | average | the CLI, the web IDE, plugins |
| Ecosystem | huge | large | medium | almost none |
| When to choose it | all the UI and logic | heavy cores, ML | TS-like WASM | a tiny core with no dependencies |

Honestly about Latent's place:

- **Against JS/TS**, Latent does not give you speed out of the box: the JIT
  optimizes loops well, and the transition into WASM adds data copying. The gain
  is in predictability, the absence of GC pauses, isolation, and a small module.
- **Against Rust→WASM**, Latent is simpler and lighter (a ~1 KB module versus
  tens of KB, no `wasm-bindgen` and no JS glue), but Rust has arbitrary exports,
  DOM access through `web-sys`, an ecosystem, and mature tooling. For a complex
  frontend, Rust is more practical.
- **Against AssemblyScript**, Latent has no GC runtime and almost no standard
  library; AssemblyScript is closer to TS and can do more, but it drags a
  runtime along. Latent is interesting where you need a minimal deterministic
  module.

## 8. Limitations and what a "real" frontend needs

### 8.1. What exists today

- Compiling `.lat` → valid WASM, exporting `main` + `memory`, importing
  `env.print`.
- Strings `[len][utf8]`, arrays `[len][i32]`, classes/enums/closures — by
  pointer; the layout is described in [WASM ABI](../reference/wasm-abi.md).
- Passing parameters to `main` (i32/f64/pointers) — it works, but it is not
  fixed as an ABI.
- `alloc`/`load8`/`store8`/`load32`/`store32`/`memcopy` — for manual memory
  work.
- A compiler-in-WASM with the C ABI `latent_alloc`/`latent_compile`/`latent_free`.
- Running in Node.js, the web IDE, VS Code, IntelliJ IDEA.

### 8.2. What is missing

| Limitation | Consequence for the frontend |
|---|---|
| No function exports other than `main` | you cannot have `exports.parse()`/`exports.sort()`; one entry point per module |
| No imports other than `print` | no DOM, `fetch`, `console`, time, or random numbers |
| No `i64` and no `f64` arrays | embeddings/vectors and exact arithmetic only in JS or fixed-point |
| No `free`/GC/arena | a long-lived page means growing memory; an instance reset is required |
| No packages/dependency manager | modules (`import`/`export`) exist, but there are no external packages and no npm |
| No exceptions | errors are return codes or a trap |
| No source maps or name section | debugging through pointers and `console.log` |
| No timeouts or fuel | an infinite loop hangs the thread; only a Worker + `terminate` |
| No npm package, TS types, or build plugins | integration is manual, as in §6 |
| `float` is fragile | invalid WASM on mixed expressions; check with `validate` |

### 8.3. What Latent needs to become a "real" frontend tool

A list of directions, not promises:

1. **Exporting arbitrary functions** (`export fn parse(...)`) with parameters and
   multiple results — so that a module provides an API instead of a single
   `main`.
2. **A stable data ABI**: exported `alloc`/`reset`, a versioned header for
   strings/arrays, documented calling conventions.
3. **Importing host functions** besides `print`: logging, time, random numbers,
   possibly resource reading; with an explicit list and a version.
4. **Full-fledged `f64` arrays and `i64`** — without them, ML/vector scenarios
   stay in JS.
5. **Packages and multi-file builds** — file modules already exist
   ([guide/modules](./modules.md)); packages/registry and dependency
   distribution are next.
6. **Tooling**: an npm package, TypeScript types, Vite/Webpack plugins,
   `wasm-opt`, a name section, source maps, trap traces.
7. **Memory management for SPAs**: an arena/reset so that a page can live for
   hours without memory growth.
8. **Security/isolation**: a standard helper for running in a Worker with a
   timeout and a memory limit.
9. **Errors without traps**: a `Result`-oriented ABI for the boundary with JS.
10. **ABI recipes and tests** — as in this section: examples that are verified by
    the compiler and by a real run.

Until these items appear, Latent in the frontend is a **small core for pure
computations** with manual data passing. In that role it already works.

## 9. Related sections

- [Latent in the browser in 5 minutes](../getting-started/web-browser.md) — the
  first working HTML page.
- [WASM ABI](../reference/wasm-abi.md) — the exact contract of the module and
  of the compiler.
- [WASM and execution](./wasm-and-execution.md) — Node.js, the `env.print`
  import, and the differences between the engines.
- [Memory and low level](./memory-and-low-level.md) — the bump allocator and the
  primitives.
- [Web IDE](../tooling/web-ide.md) ·
  [engines](../specs/engines.md) ·
  [the architecture of the web IDE](../specs/webide-architecture.md).
- Examples: [calculator](../examples/frontend-calculator.md),
  [data](../examples/frontend-data-processing.md),
  [strings](../examples/frontend-strings.md),
  [React](../examples/frontend-react.md),
  [canvas](../examples/frontend-canvas.md),
  [your own playground](../examples/frontend-compiler-playground.md).
