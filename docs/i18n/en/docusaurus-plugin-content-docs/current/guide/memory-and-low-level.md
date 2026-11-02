---
title: Memory and Low Level
sidebar_label: Memory and Low Level
sidebar_position: 15
description: WASM linear memory, the bump allocator, the layout of strings/arrays/classes/enums, and the alloc/load/store primitives.
---

# Memory and Low Level

## Memory model

Engine #2 compiles Latent into a WASM module with **its own linear memory**:

- pages of 64 KiB, the initial size is **16 pages** (1 MiB), `max` is not set;
  memory grows via `memory.grow` in the allocator;
- below address `1024` is a service area with the string constants from the data
  section;
- above it is the heap: a **bump allocator**. Its only operation is "move the heap
  pointer forward"; there is **no** deallocation (`free`) and no garbage collection;
- block boundaries are not checked.

Consequences: long-running programs grow constantly; an out-of-bounds access to an
array or a string means memory corruption or a trap; `push` into an array writes past
the end of the allocated block (see the caveat in
[arrays](./arrays-and-strings.md)).

## Value layout

| Value | Format in memory |
|---|---|
| string | `[len u32 LE][UTF-8 bytes]`; the pointer points at `len` |
| array | `[len u32][element0][element1]...`; 4-byte elements |
| class | fields at offsets with 4-byte alignment (all 4 bytes, `float` — 8) |
| enum variant with fields | `[tag i32][field0][field1]...` |
| 0-ary enum variant | a tag number (`i32`), not a pointer |
| `bool` | `i32` `0`/`1` |
| `null` | `0` |
| closure | 8 bytes: `[function index in the table][env pointer]` |

You can inspect the layout through `len`/indexing:

```latent
fn main() -> int {
    let data = [10, 20, 30];
    print("array length:", len(data));
    print("element[2]:", data[2]);

    let text = "abc";
    print("string bytes:", len(text));
    print("byte[0]:", text[0]); // 97 — the code of 'a'
    return 0;
}
```

## Linear memory primitives

The compiler (engine #2, `src/`) provides six builtins for self-hosting, and they
**are present in the shipped `web-ide/compiler.wasm`** — the example below compiles
and runs:

| Function | Arity | Meaning |
|---|---|---|
| `alloc(size) -> int` | 1 | allocate `size` bytes, return a pointer (bump + grow) |
| `load8(addr) -> int` | 1 | unsigned byte at an address |
| `store8(addr, value)` | 2 | write the low byte |
| `load32(addr) -> int` | 1 | 32-bit word (little-endian) |
| `store32(addr, value)` | 2 | write a 32-bit word |
| `memcopy(dst, src, len)` | 3 | byte-by-byte copy |

```latent
fn main() -> int {
    let p = alloc(8);
    store8(p, 65);          // p[0] = 65 ('A')
    store32(p + 4, 12345);  // p[4..8] = 12345, little-endian
    print(load8(p));        // 65
    print(load32(p + 4));   // 12345
    memcopy(p + 16, p, 8);  // copy 8 bytes
    print(load8(p + 16));   // 65
    return 0;
}
```

The program prints `65`, `12345`, `65` (one line per `print` argument).

:::note
The builtin sources are in `src/codegen/emit_call/direct.rs`
(`compile_memory_builtin`), and call registration is in `emit_call/mod.rs`.
If you work with an **old** build of `compiler.wasm`, `alloc` reports
`Неопределённая переменная 'alloc'`; the current build (465,435 bytes, built from
the current `src/`) supports them. Rebuilding is described in
[bootstrap](../tooling/bootstrap.md).
:::

## Why this is needed

- **Self-hosting**: the compiler written in Latent itself (`selfhost/`) writes WASM
  bytes through `store8`/`store32` and copies buffers through `memcopy`.
- **Manual data structures**: if you want, you can implement your own allocator,
  linked lists, fixed-length strings, and so on.
- **Layout debugging**: understanding the formats helps when reading memory dumps
  and the ABI.

## Engine #2 limitations

- No `free`/GC: all allocated memory stays occupied.
- No bounds checking: `arr[i]` and `load8(addr)` are not validated.
- `push` extends an array beyond the allocated block (a bump allocator without a
  separate capacity) — see the warning in [arrays](./arrays-and-strings.md).
- `pop()` on an empty array reads `arr[-1]`.
- `float` arrays are invalid (elements are written with `i32.store`).
- The `memory` builtins may be missing from a prebuilt WASM — rebuild it.
- `f64_to_str` is limited to the `i32` range for the integer part; extreme floats
  may produce a trap.

Next: [WASM and execution](./wasm-and-execution.md).
