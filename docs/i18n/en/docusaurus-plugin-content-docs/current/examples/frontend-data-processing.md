---
title: "Processing an array in WASM"
sidebar_label: "Data and arrays"
sidebar_position: 11
description: "Passing an i32 array into a Latent module through linear memory, sorting and aggregating in place, reading the result out of memory; the variant without main parameters."
---

# Processing an array in WASM

The case: JS passes an array of numbers into a Latent module, the module sorts it
and computes statistics, and JS reads the result out of linear memory. This is the
basic scenario for filtering, aggregation, validation, and any "heavy" data
processing on the client.

## Data format

A Latent array in memory is `[len u32 LE][element0 i32][element1 i32]...`:

```text
address → +0  length N (u32 LE)
        +4  data[0]
        +8  data[1]
        ...
        +4+4·(N-1)  data[N-1]
```

The pointer points at the length. An element is always 4 bytes, which is why
`float` arrays are not supported in engine #2. Bounds are not checked: `data[N]`
reads past the end of the block.

To avoid touching the static area (string literals start at address 1024), the
input array is placed in a "mailbox" below 1024 — at address `16`, for example.
This is a convention between the host and the program, not part of the ABI; more
in [the guide, §3.4](../guide/web-and-frontend.md#34-where-to-put-the-input-data).

## The core: sorting and statistics

```latent
fn sort(arr: [int]) -> [int] {
    let n = arr.length;
    for (let i = 0; i < n; i = i + 1) {
        for (let j = 0; j < n - i - 1; j = j + 1) {
            if (arr[j] > arr[j + 1]) {
                let t = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = t;
            }
        }
    }
    return arr;
}

fn total(arr: [int]) -> int {
    let s = 0;
    for (let i = 0; i < arr.length; i = i + 1) {
        s = s + arr[i];
    }
    return s;
}

fn main(data: [int]) -> [int] {
    let ordered = sort(data);
    let sum = total(ordered);
    print("count:", ordered.length);
    print("sum:", sum);
    print("average:", sum / ordered.length);
    print("min:", ordered[0]);
    print("max:", ordered[ordered.length - 1]);
    return ordered;
}
```

Analysis:

- `data: [int]` is an `i32` pointer. JS passes it as the `main` argument; the
  export signature is `(i32) -> i32`.
- The sort happens **in place**: `arr[j] = ...` writes into the same memory JS
  read. The same pointer is returned.
- `sum / ordered.length` is integer division: the average of `245 / 8` is `30`.
- `print` after the sort is safe: the input array lives at address `16`, while the
  strings for the output are allocated on the heap (≥ 1024) and do not overlap it.
- If the array had been built with `push` on the heap, `print` could overwrite the
  elements: `push` does not reserve capacity. See
  [The bump allocator and `push`](../guide/arrays-and-strings.md#arrays).

## The JS host: writing the input and reading the result

```js
const INPUT = 16; // the "mailbox" below the static area

function ensureCapacity(memory, endByte) {
  const needPages = Math.ceil(endByte / 65536);
  const havePages = memory.buffer.byteLength / 65536;
  if (needPages > havePages) memory.grow(needPages - havePages);
}

function writeI32Array(memory, addr, values) {
  ensureCapacity(memory, addr + 4 + values.length * 4);
  const view = new DataView(memory.buffer);
  view.setUint32(addr, values.length, true);
  for (let i = 0; i < values.length; i += 1) {
    view.setInt32(addr + 4 + i * 4, values[i], true);
  }
  return addr;
}

function readI32Array(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return Array.from({length: len}, (_, i) => view.getInt32(ptr + 4 + i * 4, true));
}

function readString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

let instance;
const imports = {
  env: {
    print(ptr) {
      document.querySelector('#log').textContent +=
        readString(instance.exports.memory, ptr) + '\n';
    },
  },
};

const bytes = await (await fetch('./data.wasm')).arrayBuffer();
({instance} = await WebAssembly.instantiate(bytes, imports));

const memory = instance.exports.memory;
writeI32Array(memory, INPUT, [42, 7, 19, 3, 88, 21, 10, 55]);

const resultPtr = instance.exports.main(INPUT);
const sorted = readI32Array(memory, resultPtr);
console.log(sorted); // [3, 7, 10, 19, 21, 42, 55, 88]
```

**What you will see** in `#log`:

```
count:
8
sum:
245
average:
30
min:
3
max:
88
```

and in the console — `[3, 7, 10, 19, 21, 42, 55, 88]`. Each `print` argument is a
separate line: `"count:"` and `8` are printed separately.

Note that `readI32Array` reads `memory.buffer` **after** `main`. If JS had taken
the view before the call, it could have read it before the memory grew, but the
`DataView` is recreated on every read — that protects against the buffer being
detached after `memory.grow`.

## The variant without `main` parameters (strict ABI)

If the module has to work with a foreign host that calls `main()` without
arguments, the input is read from a fixed address with the built-in
`load32`/`store32`:

```latent
fn sort_raw(ptr: int, n: int) {
    let i = 0;
    while (i < n) {
        let j = 0;
        while (j < n - i - 1) {
            let a = load32(ptr + 4 + j * 4);
            let b = load32(ptr + 4 + (j + 1) * 4);
            if (a > b) {
                store32(ptr + 4 + j * 4, b);
                store32(ptr + 4 + (j + 1) * 4, a);
            }
            j = j + 1;
        }
        i = i + 1;
    }
}

fn main() -> int {
    let n = load32(16);
    let out = alloc(4 + n * 4);
    store32(out, n);
    let i = 0;
    while (i < n) {
        store32(out + 4 + i * 4, load32(20 + i * 4));
        i = i + 1;
    }
    sort_raw(out, n);
    print("count:", n);
    print("min:", load32(out + 4));
    print("max:", load32(out + 4 + (n - 1) * 4));
    return out;
}
```

In this variant JS writes the length at address `16` and the elements from `20`,
calls `main()` with no arguments, and reads the array through the returned
pointer:

```js
const values = [42, 7, 19, 3, 88, 21, 10, 55];
const view = new DataView(memory.buffer);
view.setUint32(16, values.length, true);
values.forEach((value, i) => view.setInt32(20 + i * 4, value, true));

const ptr = instance.exports.main();
console.log(readI32Array(memory, ptr));
```

Here `alloc` is a Latent builtin (not a module export): it allocates a block on the
heap and returns a pointer. The size `4 + n*4` is the header plus the elements.

## Limitations and pitfalls

- **4-byte elements only.** `[float]`, `[bool]` and arrays of pointers are
  representable, but a `float` in memory will be garbage: the elements are written
  as `i32`.
- **No bounds checking.** A wrong index means memory corruption or a trap, not an
  exception.
- **No `free`.** Every `alloc`/literal/`push` grows the heap; repeated `main` calls
  in a long-lived page should better not allocate.
- **`push` does not reserve capacity** — do not mix `push` into `[]` with later
  allocations before you read the array.
- **The average is integer.** For fractions either scale the values or compute in
  JS.
- **O(n²) sorting.** For large arrays, implement quicksort/mergesort or process the
  data in chunks in a Web Worker.

## Things to try

1. Replace bubble sort with selection sort and compare the number of operations.
2. Return two arrays from `main` (pack both pointers into a result array).
3. Add a `value >= threshold` filter and check the boundary values.
4. Pass 100,000 numbers and see how `memory.grow` behaves (and do not forget
   `ensureCapacity`).

## Related sections

- [Latent in the frontend](../guide/web-and-frontend.md) — the ABI and memory.
- [Arrays and strings](../guide/arrays-and-strings.md) — `push`, `pop`, indexing.
- [Memory and low level](../guide/memory-and-low-level.md) — the allocator.
- [Strings](./frontend-strings.md) · [Canvas](./frontend-canvas.md).
