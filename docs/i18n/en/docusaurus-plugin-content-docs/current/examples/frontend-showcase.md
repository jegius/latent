---
title: "Interactive demos: Latent vs JS"
sidebar_label: "Demos and performance"
sidebar_position: 15
description: "Three browser demos for Latent: a benchmark against JS, canvas image filters, and physics with tens of thousands of particles. Architecture, sources, iframes, and an honest comparison with JavaScript."
---

# Interactive demos: Latent vs JS

This section is not about "hello world". Here Latent compiles to WebAssembly and
runs real workloads directly on the page: millions of integer operations,
`ImageData` pixels, and gravity for tens of thousands of particles. Every demo
ships its `.lat` source next to it, and the numbers are measured by **your**
browser, not by the author of this page.

The demos are static pages with no bundler and no external dependencies. They
live in `docs/static/demos/` and are published at `/latent/demos/...`.

## Benchmark: five algorithms, two runtimes

The most revealing demo: the same algorithms in JavaScript and in Latent→WASM,
the same input data, a checksum comparison, and the median of three runs.

<iframe
  src="/latent/demos/bench/?embed=1"
  title="Latent vs JavaScript — interactive benchmark"
  loading="lazy"
  style={{width: '100%', height: '780px', border: 0, borderRadius: '12px'}}
/>

If the embedded page does not load (for example, because of an iframe policy),
open it directly: <a href="/latent/demos/bench/">latent/demos/bench</a>.

| Demo | What it shows | Why Latent fits |
|---|---|---|
| <a href="/latent/demos/bench/">Benchmark</a> | FNV-1a over bytes, sieve of Eratosthenes, matrix multiply, quicksort, UTF-8 scan; live milliseconds and parity | dense loops over `i32` in linear memory, zero allocations in the hot path |
| <a href="/latent/demos/image/">Images</a> | grayscale, box blur, Sobel and threshold over `ImageData`; WASM/JS switch, an original/filtered split slider | pointers instead of copies, integer math, stable frame time |
| <a href="/latent/demos/physics/">Physics</a> | up to 30,000 particles, three rotating attractors, integrator, collisions with cores and walls, FPS graph | one linear buffer, fixed point, no GC pauses |
| <a href="/latent/demos/bench/#compile">Compiler in the browser</a> | a button compiles `sieve.lat` with `compiler.wasm` and runs the result immediately | compiler-as-WASM: source → module without a server |

## Physics: 10,000+ particles in one buffer

<iframe
  src="/latent/demos/physics/?embed=1"
  title="Latent — gravity simulation with 30,000 particles"
  loading="lazy"
  style={{width: '100%', height: '760px', border: 0, borderRadius: '12px'}}
/>

The whole simulation lives in the module's memory: four `i32` arrays (x, y, vx,
vy) at fixed offsets, with no object per particle. The JS host reads those
numbers as `Int32Array` and draws them on a canvas — no serialization and no
`postMessage`.

## Key fragments

### FNV-1a: bytes and i32 overflow

```latent
// FNV-1a over a 1 MiB byte buffer, `rounds` passes.
fn main(n: int, rounds: int) -> int {
    let ptr = load32(8);
    if (ptr == 0) {
        ptr = alloc(n + 8);
        store32(8, ptr);
        let s = 123456789;
        let g = 0;
        while (g < n) {
            s = (s * 1103515245 + 12345) & 2147483647;
            store8(ptr + g, (s >> 8) & 255);
            g = g + 1;
        }
    }

    // 0x811c9dc5 as a signed i32: literals above 2^31 - 1 wrap.
    let h = 0 - 2128831035;
    let r = 0;
    while (r < rounds) {
        let i = 0;
        while (i < n) {
            h = (h ^ load8(ptr + i)) * 16777619;
            i = i + 1;
        }
        r = r + 1;
    }
    return h;
}
```

Note `0 - 2128831035` instead of `2166136261`: a literal above `2^31 - 1`
wraps on the i32 path, and writing it as a signed value makes the behaviour
obvious. The JS twin uses `Math.imul` with the same signed seed — the checksums
match.

### Pixels: `load8`/`store8` instead of objects

```latent
fn luma(r: int, g: int, b: int) -> int {
    return (77 * r + 150 * g + 29 * b) >> 8;
}

fn gray(src: int, dst: int, size: int) {
    let i = 0;
    while (i < size) {
        let v = luma(load8(src + i), load8(src + i + 1), load8(src + i + 2));
        store8(dst + i, v);
        store8(dst + i + 1, v);
        store8(dst + i + 2, v);
        store8(dst + i + 3, 255);
        i = i + 4;
    }
}
```

`src` and `dst` are ordinary `i32` addresses in linear memory. The host copies
`ImageData` into the module's memory once, then wraps the result pointer in
`new ImageData(view)` — `putImageData` reads WASM memory directly.

### Gravity: fixed point without `sqrt`

```latent
// A simplified fragment of particles.lat: the force of one attractor.
fn attractor_force(x: int, y: int, ax: int, ay: int, gravity: int, vx: int, vy: int) -> int {
    let dx = ax - x;
    let dy = ay - y;
    let d2 = dx * dx + dy * dy;
    if (d2 < 90000) {
        return vx;
    }
    let f = (gravity << 24) / (d2 + 40000);
    return vx + ((dx * f) >> 13) - ((dy * f) >> 13);
}
```

Positions are stored in 1/16 of a pixel, velocities in 1/256 of a pixel per
step. The force is a softened inverse square, but with no `sqrt` and no
`float`: just `i32`, division, and shifts. That is why the JS twin can
reproduce the trajectories bit for bit — the **Parity** button checks exactly
that.

## How it works

```
docs/static/demos/
├── index.html              # demo hub
├── assets/
│   ├── demo.css            # shared dark shell
│   ├── wasm.js             # fetch/instantiate, compiler C ABI
│   ├── bench.js            # JS twins of the five benchmarks
│   ├── imaging.js          # JS twins of the filters
│   ├── physics.js          # JS twin of the integrator
│   └── highlight.js        # .lat syntax highlighting
├── bench/                  # index.html + 5 *.lat + 5 *.wasm
├── image/                  # index.html + filter.lat + filter.wasm
├── physics/                # index.html + particles.lat + particles.wasm
├── compiler.wasm           # copy used by "compile in browser"
└── build-demos.mjs         # .lat → .wasm + smoke run
```

1. **Building the modules.** `build-demos.mjs` loads `web-ide/compiler.wasm`,
   calls the C ABI `latent_alloc` / `latent_compile` / `latent_free`, and writes
   a ready `.wasm` next to every `.lat`. It then instantiates and runs each
   module once as a smoke test.
2. **Loading on the page.** `wasm.js` fetches the `.wasm`, creates a
   `WebAssembly.Instance` with a single import, `env.print(i32)`, and exposes
   `exports.main` and `exports.memory`.
3. **Passing data.** Arrays and strings are bytes behind a pointer:
   `[len u32][i32…]` and `[len u32][utf8…]`. No JSON and no serialization: JS
   writes into a `Uint8Array` over `memory.buffer`, and the module reads the same
   bytes.
4. **Compiling in the browser.** The button on the benchmark page downloads
   `sieve.lat`, compiles it with the same `compiler.wasm` in a few milliseconds,
   and runs the result. It is the same compiler as in the playground, called
   from an ordinary static page.

The full ABI is described in [WASM ABI](../reference/wasm-abi.md), and the basic
"JS host + `.wasm`" scenario is in [Canvas and frames](./frontend-canvas.md).

## Why Latent instead of plain JS

The honest answer: **not always**. JavaScript engines are excellent at typed
arrays and integer loops today, and on short calls the JS↔WASM transition can
eat the win. The demo shows that too — if JavaScript is faster, you will see the
matching label instead of a hidden number.

Where the win is real:

- **Memory control.** `alloc` is an explicit allocation in linear memory. No
  object per particle, no hidden allocations in the loop, no garbage collector.
  For canvas, audio, and games, what matters is not average speed but the
  absence of rare GC pauses and a stable p95 frame time.
- **Predictable integers.** `int` is exactly `i32`: overflow, shifts, and
  division are defined. The result does not depend on how the JIT happened to
  optimize a branch this time.
- **One buffer instead of an object graph.** 30,000 particles are 480 KB of
  memory and four `Int32Array` views. Cache locality and no pointer chasing
  produce an even simulation step.
- **Sandboxing.** The module has no access to the DOM, the network, or cookies.
  If you execute generated or untrusted code, WASM limits it to exactly the
  memory you allocated.
- **Compiler-as-WASM.** The Latent compiler is built to WebAssembly. A source
  file can become a module on the client, with no server and no installed
  toolchain.

What the demos do **not** do:

- pairwise particle collisions (the demo uses collisions with attractor cores
  and walls) — that is O(N·3), not O(N²);
- a background Worker: everything runs on the main thread, so the comparison is
  honest and measurable;
- a promise that "WASM is always faster". The numbers on the page are live.

## Running and checking

The demos need no build. Serve `docs/static/` with any static server:

```bash
# from the repository root
python -m http.server 8000 --directory docs/static
# open http://localhost:8000/demos/
```

Rebuild the `.wasm` files after editing `.lat`:

```bash
node docs/static/demos/build-demos.mjs            # compile + smoke run
node docs/static/demos/build-demos.mjs --no-verify
```

The script uses `web-ide/compiler.wasm` (override it with the
`LATENT_COMPILER_WASM` environment variable). The "compile in browser" button
uses `docs/static/demos/compiler.wasm`, and if that file is missing it tries
`/latent/playground/compiler.wasm`; on the published site the playground is
synced by `scripts/sync-playground.mjs`.

All ```latent blocks on this page are checked by
`docs/scripts/validate-examples.mjs`; the site build is `pnpm run build` in
`docs/`.

## Things to try

1. In the benchmark, press **"Run all 5"** and compare the orders of magnitude
   on your machine. Then switch tabs and come back — the numbers are not
   hard-coded.
2. In the image demo, select **Sobel** and drag the original/filtered slider:
   the filter works over RGBA, not over CSS.
3. In physics, set 30,000 particles and gravity 50 — the simulation step is
   still measured in microseconds, and the canvas stays at 60 fps.
4. Press **Parity** in physics: the JS twin and WASM run 120 steps and must
   match bit for bit. If the implementations diverge, the badge turns red.

## Related sections

- [WASM ABI](../reference/wasm-abi.md) — `main`, `memory`, strings, arrays,
  the compiler C ABI.
- [Canvas and frames](./frontend-canvas.md) — the minimal "WASM computes, canvas
  draws" example.
- [Compiler in the browser](./frontend-compiler-playground.md) —
  `latent_alloc`, `latent_compile`, `latent_free`.
- [Latent in the frontend](../guide/web-and-frontend.md) — React, Worker, Vite.
- [Web IDE](../tooling/web-ide.md) — the playground with two engines.
