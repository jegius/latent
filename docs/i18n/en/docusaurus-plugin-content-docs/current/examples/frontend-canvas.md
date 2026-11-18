---
title: "Canvas: a fractal and sorting"
sidebar_label: "Canvas and frames"
sidebar_position: 13
description: "Latent computes a frame (the Sierpinski triangle) or a sorting step, JS draws it through ImageData on a canvas; caching the buffer in memory and repeated main calls."
---

# Canvas: a fractal and sorting

WASM is a good fit for pixel and computational frames: the module computes an
array of bytes or numbers and JS draws it on a `<canvas>`. There are two cases
here:

1. **A fractal** — the Sierpinski triangle, one frame per `main` call, with a
   moving vertical bar.
2. **A sorting visualization** — the module performs one bubble-sort pass per
   frame, and JS draws the bars.

Both use the same trick: the state (a pointer to the buffer) is stored in linear
memory, because the language has no global variables.

## Case 1: the Sierpinski triangle

The rule: the pixel `(x, y)` is painted if `(x & y) == 0` — the classic bitwise
fractal. Plus a vertical bar at `x == frame % 256` so that the frame changes. No
`float`, only `int` and bitwise operators.

```latent
// A 256x256 frame: 0 — background, 1 — a dot. The buffer pointer is cached
// at address 20 because the language has no global variables.
fn main(frame: int) -> int {
    let w = 256;
    let h = 256;
    let ptr = load32(20);
    if (ptr == 0) {
        ptr = alloc(4 + w * h);
        store32(ptr, w * h);
        store32(20, ptr);
    }
    let beam = frame % w;
    let y = 0;
    while (y < h) {
        let x = 0;
        while (x < w) {
            let v = 0;
            if ((x & y) == 0) {
                v = 1;
            }
            if (x == beam) {
                v = 1;
            }
            store8(ptr + 4 + y * w + x, v);
            x = x + 1;
        }
        y = y + 1;
    }
    return ptr;
}
```

- `alloc(4 + w*h)` allocates the header and 65,536 bytes of pixels **once**.
- `store32(20, ptr)` is the "global variable": the next `main` call reads the
  pointer through `load32(20)` and does not allocate again.
- `store8` writes a byte at `ptr + 4 + y*w + x`.
- What is returned is a pointer to `[len][bytes]`; `len` = 65,536.

### HTML and rendering

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Latent: фрактал</title>
  <style>
    body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #111; }
    canvas { image-rendering: pixelated; width: 512px; height: 512px; }
  </style>
</head>
<body>
  <canvas id="frame" width="256" height="256"></canvas>

  <script type="module">
    const W = 256;
    const H = 256;
    const canvas = document.getElementById('frame');
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(W, H);

    let instance;
    const imports = {env: {print() {}}}; // print is not used in this program

    const bytes = await (await fetch('./fractal.wasm')).arrayBuffer();
    ({instance} = await WebAssembly.instantiate(bytes, imports));

    let frameIndex = 0;

    function draw() {
      // main is synchronous: while it computes a frame, the tab is busy.
      const ptr = instance.exports.main(frameIndex);

      const memory = instance.exports.memory; // buffer may have changed after grow
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      const pixels = new Uint8Array(memory.buffer, ptr + 4, len);

      const data = image.data;
      for (let i = 0; i < W * H; i += 1) {
        const on = pixels[i] !== 0;
        data[i * 4] = on ? 40 : 245;
        data[i * 4 + 1] = on ? 220 : 245;
        data[i * 4 + 2] = on ? 180 : 245;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);

      frameIndex += 1;
      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  </script>
</body>
</html>
```

**What you will see:** a light Sierpinski triangle on a dark background and a
vertical bar that sweeps from left to right over 256 frames. The frame is computed
entirely in `main`; at 256×256 that is 65,536 iterations — enough for 60 fps.

Important: `pixels` is a **view** into memory, not a copy. If the memory grows,
the old `ArrayBuffer` is detached and the view becomes invalid. In this example
the buffer fits into the initial 1 MiB and there is no growth, but the rule “take
`memory.buffer` on every frame” remains mandatory for large frames.

## Case 2: a sorting visualization

Another pattern: `main` performs **one pass** of the sort and returns an array of
heights `[len][i32...]`. JS draws the bars and calls `main` with the next pass
number.

```latent
fn generate(n: int, ptr: int) {
    store32(ptr, n);
    let i = 0;
    let seed = 12345;
    while (i < n) {
        seed = (seed * 75 + 74) % 65537;
        store32(ptr + 4 + i * 4, seed % 100);
        i = i + 1;
    }
}

fn step(ptr: int, pass: int) {
    let n = load32(ptr);
    let j = 0;
    while (j < n - pass - 1) {
        let a = load32(ptr + 4 + j * 4);
        let b = load32(ptr + 4 + (j + 1) * 4);
        if (a > b) {
            store32(ptr + 4 + j * 4, b);
            store32(ptr + 4 + (j + 1) * 4, a);
        }
        j = j + 1;
    }
}

fn main(pass: int) -> int {
    let n = 48;
    let ptr = load32(20);
    if (ptr == 0) {
        ptr = alloc(4 + n * 4);
        store32(20, ptr);
        generate(n, ptr);
    }
    if (pass < n) {
        step(ptr, pass);
    }
    return ptr;
}
```

- `generate` fills 48 bars with a deterministic LCG (no `random`, no overflow:
  `seed < 65537`, so `seed * 75` fits into `i32`).
- `main(pass)` — one pass; after 48 calls the array is sorted.
- To reset, write `0` at address `20`; the next call allocates and generates the
  array again.

```html
<canvas id="bars" width="500" height="240"></canvas>
<button id="reset">Заново</button>
```

```js
const N = 48;
const BAR_W = 8;
const GAP = 2;
const canvas = document.getElementById('bars');
const ctx = canvas.getContext('2d');

let pass = 0;

function drawBars() {
  const ptr = instance.exports.main(pass);
  const memory = instance.exports.memory;
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < len; i += 1) {
    const value = view.getUint32(ptr + 4 + i * 4, true); // 0..99
    const height = Math.round((value / 99) * (canvas.height - 10));
    ctx.fillStyle = `hsl(${200 - value} 80% 60%)`;
    ctx.fillRect(i * (BAR_W + GAP), canvas.height - height, BAR_W, height);
  }

  pass += 1;
  if (pass < N) {
    requestAnimationFrame(drawBars);
  }
}

document.getElementById('reset').addEventListener('click', () => {
  // reset the state: the next main(0) allocates the buffer again
  new DataView(instance.exports.memory.buffer).setUint32(20, 0, true);
  pass = 0;
  requestAnimationFrame(drawBars);
});

requestAnimationFrame(drawBars);
```

**What you will see:** 48 colored bars that line up in ascending order over 48
frames. The “Again” button reshuffles them and restarts the sorting from the
beginning.

## Limitations and pitfalls

- **`main` is synchronous.** On large frames (1920×1080, for example) the tab will
  freeze; move the computation into a Web Worker or lower the resolution.
- **Memory is never freed.** The first frame allocates the buffer, and it is reused
  afterwards. Allocating on every frame would grow the heap by `W*H*fps` bytes per
  second.
- **`memory.buffer` is detached after `grow`.** Do not cache a `Uint8Array`
  forever; take a view of the current `buffer` (or create it per frame).
- **There is no `requestAnimationFrame` in Latent.** Frames and timing are entirely
  up to JS.
- **No `float`.** A fractal built on bitwise operations is not a limitation but a
  convenient way to stay in integers; for smooth gradients compute in JS or use
  fixed-point.
- **`store8` does not check bounds.** An `x`/`y` outside `w`/`h` will corrupt
  neighbouring memory.

## Things to try

1. Change the rule to `(x ^ y) < 128` and look at a different fractal.
2. Make the frame 64×64 and compare the FPS with 512×512.
3. Highlight the pair being compared in the sort (return the indices as well).
4. Move the frame computation into a Web Worker and pass `ImageData.data` to the
   main thread.

## Related sections

- [Latent in the frontend](../guide/web-and-frontend.md) — Worker and memory.
- [Data and arrays](./frontend-data-processing.md) — `[len][i32]` arrays.
- [Strings](./frontend-strings.md) — `[len][utf8]`.
- [WASM ABI](../reference/wasm-abi.md) — memory and exports.
