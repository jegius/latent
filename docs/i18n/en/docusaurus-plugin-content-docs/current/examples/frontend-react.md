---
title: "A React component with a Latent core"
sidebar_label: "React"
sidebar_position: 14
description: "A ready-made React component in TypeScript: loading the .wasm through Vite, calling main in useEffect, reading a string out of memory, the build, and the typical mistakes."
---

# A React component with a Latent core

The case: a React application loads `sum.wasm`, calls `main(n)` as the slider
moves, and shows the string the Latent core returned. The component is written in
TypeScript and built with Vite; the same code moves to CRA/Next.js with minimal
changes.

## The core

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

- `main(n: int)` takes a number — the export gets the signature `(i32) -> i32`.
- `str(n)` turns a number into a string, and `+` concatenates.
- What is returned is a pointer to `[len][utf8]`; React reads it through `DataView`.

## The component

```tsx
// src/SumPanel.tsx
import {useEffect, useRef, useState} from 'react';
import wasmUrl from './sum.wasm?url'; // Vite: the file lives in src/sum.wasm

// The module is compiled once per application lifetime.
let modulePromise: Promise<WebAssembly.Module> | null = null;

function loadModule(): Promise<WebAssembly.Module> {
  modulePromise ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`sum.wasm: HTTP ${response.status}`);
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  return modulePromise;
}

function readString(memory: WebAssembly.Memory, ptr: number): string {
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
                  console.log(
                    '[latent]',
                    readString(inst.exports.memory as WebAssembly.Memory, ptr),
                  );
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

    return () => {
      cancelled = true;
    };
  }, [n]);

  return (
    <section>
      <label>
        n = {n}
        <input
          type="range"
          min={1}
          max={1000}
          value={n}
          onChange={(event) => setN(Number(event.target.value))}
        />
      </label>
      <output>{text}</output>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

## The Vite build

```bash
npm create vite@latest latent-react -- --template react-ts
cd latent-react
npm install
```

Compile the core (from the root of the Latent repository) and put the `.wasm` into
`src/` — the import is `./sum.wasm?url`:

```bash
# in a separate terminal, from the root of the latent repository
./target/debug/latentc compile sum.lat sum.wasm
cp sum.wasm latent-react/src/sum.wasm
```

If the project already exists and you are in its directory, the path is
`cp ../sum.wasm src/sum.wasm`.

`src/main.tsx`:

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {SumPanel} from './SumPanel';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SumPanel initial={100} />
  </StrictMode>,
);
```

If the file has to live in `public/`, the `?url` import is not needed:

```ts
const response = await fetch(`${import.meta.env.BASE_URL}sum.wasm`);
```

Then `sum.wasm` is copied to `public/sum.wasm`, but it is not hashed at build time.
More about both variants in
[the guide, §6.4](../guide/web-and-frontend.md#64-vite-and-webpack-where-to-put-the-wasm).

Running and building:

```bash
npm run dev      # http://localhost:5173
npm run build    # dist/ with a hashed sum.<hash>.wasm
npm run preview
```

## What you will see

A slider from 1 to 1000 and the string `sum 1..100 = 5050`. As the slider moves,
the string updates: `main(n)` is called again, and the module's memory is reused
(each call allocates a string, so the heap grows — fine for a demo).

If you call `print(...)` in the core, the lines appear in the browser console with
the `[latent]` prefix; here `print` is not used.

## Pitfalls

- **StrictMode in dev runs the effect twice.** `modulePromise` caches the
  compilation and `instanceRef` the instance, so a repeated run does not break the
  component. Without the cache you would see two `fetch` calls and two
  compilations.
- **`cancelled` is mandatory.** Otherwise, after unmounting (or a quick slider
  change) a `setState` lands on a dead component.
- **Do not create the instance in render.** `new WebAssembly.Instance` in the
  component body would run on every re-render; only `useEffect`/`ref`.
- **`memory.buffer` is detached after `memory.grow`.** `readString` takes
  `memory.buffer` at read time instead of caching a `Uint8Array`.
- **The type of `main`'s result is not inferred.** In TypeScript you have to cast
  `instance.exports.main` to a function with the right signature; fix the contract
  (`number` or a pointer) by hand.
- **SSR.** In Next.js/Nuxt the component must only run on the client;
  `useEffect`/`onMounted` provide that, but `import wasmUrl` and `fetch` must not
  end up in the server bundle without a dynamic import.
- **`?url` and types.** Without `vite/client` TypeScript does not know about
  `*.wasm?url` — add `/// <reference types="vite/client" />` to
  `src/vite-env.d.ts`.
- **CORS and the base path.** When deploying to a subpath, use
  `import.meta.env.BASE_URL`, otherwise `fetch('/sum.wasm')` goes to the domain
  root.

## Things to try

1. Swap the core for `main(n: int) -> [int]` returning an array of squares and draw
   bars (reading an array is covered in
   [the data case](./frontend-data-processing.md)).
2. Add a “Reset” button that recreates the instance.
3. Move the computation into a Web Worker so the slider does not stutter at large
   `n`.
4. Compare `?url` and `public/`: look at which file names end up in `dist/`.

## Related sections

- [Latent in the frontend](../guide/web-and-frontend.md) — the ABI and integration.
- [Strings](./frontend-strings.md) — reading `[len][utf8]`.
- [Data and arrays](./frontend-data-processing.md) — arrays in memory.
- [Your own playground](./frontend-compiler-playground.md) — the compiler in the
  browser.
