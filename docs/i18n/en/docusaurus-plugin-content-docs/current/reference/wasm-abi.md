---
title: "WASM ABI"
description: "The contract of a Latent WASM module: the env.print import, the memory/main exports, memory pages, the allocator and the heap global, the representation of strings/arrays/classes/enums/closures, calling conventions; the C-ABI of the compiler-as-WASM."
sidebar_position: 9
---

# WASM ABI

Sources: `src/codegen/module_builder/`, `sections.rs`, `memory.rs`,
`runtime_helpers/`, `emit_lambda.rs`, `emit_enum.rs`, `context.rs`,
`src/lib.rs` (the compiler C-ABI). The module is assembled manually byte by byte —
without `wasm-bindgen` and without WASI.

## What the program module imports and exports

### Import

```text
(import "env" "print" (func (param i32)))
```

- There is always exactly one import; it is **always** added (`WasmCodegen::new` →
  `add_import_print`), even if `print` is never called.
- The import occupies **function index 0**, so all user functions, methods, lambdas,
  and runtime helpers are shifted by 1.
- The parameter is a pointer to a string in linear memory in the format
  `[len u32 LE][utf8 bytes]`; the host reads the UTF-8 and prints it.

### Exports

| Name | Kind | When it exists |
|---|---|---|
| `memory` | memory | always |
| `main` | function | if `fn main` is declared in the program |

The `main` signature is determined by the annotation: `fn main() -> int` → `() -> i32`;
`fn main() -> float` → `() -> f64`; a function without an annotation but with
`return expr` → `() -> i32`; without `return` — `() -> void`. The host calls `main()`
and gets `i32`/`f64`/`undefined` (`src/codegen/sections.rs`).

Even if `main` is absent, the module is valid (useful for libraries), but there will be
no `main` export.

## Module sections

The order and composition (`emit_sections`):

| ID | Section | Condition |
|---:|---|---|
| 1 | Type | if there are types (always) |
| 2 | Import | always (`env.print`) |
| 3 | Function | if there are functions |
| 4 | Table | **only if there are lambdas**; `funcref`, min = `import_count + func_count` |
| 5 | Memory | always: `min = 16` pages (1 MiB), no max |
| 6 | Global | always: one **mutable i32** — `heap_ptr`, the initial value is `memory_offset` |
| 7 | Export | always (`memory`, optionally `main`) |
| 9 | Element | when there is a table: one active segment function per function index (`0..total_funcs`) |
| 10 | Code | if there are bodies |
| 11 | Data | if there are string literals |

There are no `start`, `data count`, or `custom` sections. All indices are u32 LEB128,
numbers are signed LEB128 (`ByteBuffer` in `src/codegen/bytecode.rs`).

## Memory and the allocator

- A **page** is 65 536 bytes; the **initial size** is 16 pages (1 MiB), set in
  `WasmCodegen::new` (`memory_pages: 16`). The memory section writes only `min` (no
  upper limit is set).
- **Static layer**: string literals are placed into the data section starting at
  address 1024 (`memory_offset` is initialized to 1024), with deduplication by content
  (`add_string`). Each literal is a separate active data segment:
  `[len u32 LE][utf8 bytes]`.
- **Heap**: global variable 0 (`heap_ptr`) is initialized with the value of
  `memory_offset` **after** all string literals have been placed (that is,
  `1024 + Σ sizes of the unique literals`). The heap grows upward thanks to the
  `__latent_alloc` bump allocator; memory is never reused.
- **Memory growth**: `__latent_alloc(size)` increments `heap_ptr` and, if `heap_ptr`
  has gone beyond `memory.size * 65536`, calls `memory.grow` for the required number of
  pages (`emit_alloc_body`). Growth errors (the limit) are not handled — when memory is
  exhausted the module gets `-1` from `memory.grow`, which is discarded (`drop`).

All multi-byte values are **little-endian**; `i32.load`/`i32.store` use align=2
(4 bytes), `f64` uses align=3 (8 bytes).

## Data layout

### String

```text
address → [len u32 LE][utf8 bytes ...]
```

- `len` is the length in **UTF-8 bytes**.
- `len(s)` = `i32.load(s)`; `s[i]` is the byte `i32.load8_u(s + 4 + i)` (0..255), out of
  bounds — `-1` (the `__latent_str_char_at` helper).
- Concatenation (`+`) creates a new string on the heap through `__latent_str_concat`;
  the `==` comparison is `__latent_str_eq` (pointers first, then lengths, then byte by
  byte).
- Number → string: `__latent_i32_to_str` (decimal, signed) and `__latent_f64_to_str`
  (a fixed 6 digits after the point, for example `3.140000`). String → int:
  `__latent_str_to_i32` (ASCII, an optional `-`, stops at the first non-digit
  character).
- String literals are deduplicated in the data-section pool.

### Array

```text
address → [len u32][elem0 i32][elem1 i32]...
```

- An element is always 4 bytes (`i32`/pointer/`f64` bits are not supported: a float
  array is not typed specially in engine #2).
- `arr[i]` = `i32.load(arr + 4 + i*4)`; `a[i] = v` = `i32.store`.
- The literal `[1, 2, 3]` is allocated on the heap (`__latent_alloc(4 + 4n)`) and `len`
  is written into the header; `push` writes at index `len` and increments the header;
  `pop` decrements the header and reads the element.
- `.length`/`len()` read the header.
- Arrays are passed by pointer (mutated in place); bounds are not checked.

### Class

```text
address → [field0][field1]...
```

- The layout is computed in `collect_class_layouts`: a field of type `float` occupies 8
  bytes (`f64`), **all the others** occupy 4 bytes (`i32`); each field is aligned to
  its size (a mask), and the final size is aligned to 4.
- The offsets are fixed, and there is no inheritance.
- Methods are not stored in the object: `obj.method(args)` compiles into a direct call
  of the function `Class_method(obj, args...)` with an implicit first parameter `this`.
  Function names are mangled as `Class_method` (for example `Point_init`,
  `Point_norm2`).
- `new Class(args)` allocates `size` on the heap, compiles the arguments, calls
  `Class_init`/`Class_new` (if it is declared), and returns the pointer.
- Fields default to zeros (WASM memory is initially zero and the heap is not reused),
  but this is not "null initialization" in the sense of the language.

```latent
class Point {
    x: int;
    y: int;

    fn init(x, y) {
        this.x = x;
        this.y = y;
    }
}

fn main() -> int {
    let p = new Point(1, 2);
    return p.x + p.y;
}
```

### Enum (a sum type)

```text
n-ary variant:     address → [tag i32][field0 i32][field1 i32]...
0-ary variant:     the value is the tag itself (i32), with no allocation
```

- Tags are assigned in declaration order of the variants (`0, 1, 2, ...`), and the
  built-in `Ok`/`Err`/`Some`/`None` are registered in advance (`Ok`=0, `Err`=1,
  `Some`=0, `None`=0 with 0 fields).
- The `enum_variants` table is **global by variant name**, not by enum name: variants
  with the same names in different enums overwrite each other.
- Fields are written with `i32.store` — that is why an enum with a `float` field
  produces invalid WASM.
- `match` compiles into a chain of `if/else`: a comparison of the tag (for 0-ary
  variants, with the value itself), then the binding of the fields.

### Closure (lambda)

```text
closure → [table_slot i32][env_ptr i32]      (8 bytes)
env     → [captured0 i32][captured1 i32]...  (4*n bytes)
```

- In the first pass (`collect_lambdas`) each lambda is registered as a function
  `__lambda_N` with the type `(env i32, params...) -> i32`.
- When a lambda is evaluated, an env is created on the heap along with a
  closure pair; the captured variables are copied into the env **by value**.
- A call is `call_indirect` through the table slot; before the call `env, args...` are
  pushed, with `table_slot` on top. The table element type is
  `(i32 env, i32...) -> i32`; the result is always `i32` (even if the lambda returns a
  float — see the defects).
- The function table is created only if the program has lambdas; the element section
  places **all** module functions starting from index 0 (slot = function index).

### Runtime helpers

Ordinary module functions (not imports), emitted after the user functions:

| Name | Signature | Purpose |
|---|---|---|
| `__latent_alloc` | `(i32 size) -> i32` | bump allocator + `memory.grow` |
| `__latent_mem_copy` | `(i32 dst, i32 src, i32 len)` | byte-wise copy |
| `__latent_str_len` | `(i32 ptr) -> i32` | string length |
| `__latent_str_concat` | `(i32 a, i32 b) -> i32` | concatenation |
| `__latent_str_eq` | `(i32 a, i32 b) -> i32` | content comparison |
| `__latent_str_char_at` | `(i32 ptr, i32 i) -> i32` | the byte at an index, or `-1` |
| `__latent_i32_to_str` | `(i32 n) -> i32` | int → string |
| `__latent_f64_to_str` | `(f64 n) -> i32` | float → string (6 digits) |
| `__latent_str_to_i32` | `(i32 ptr) -> i32` | string → int |

These names are visible in the WASM (they are not exported; they are called by index).

## Function index order

1. Index `0` — the `env.print` import.
2. User `fn`s in declaration order.
3. Class methods (`Class_method`) in the order of class/method declaration.
4. Lambdas (`__lambda_N`).
5. Runtime helpers (in registration order).

Adding a user function shifts only the indices of the entities registered later (as in
any WASM module); the element section and `call_indirect` use the current indices.

## Values and calling conventions

- All values are `i32` (`int`, `bool`, `string`, arrays, objects, enums, closures,
  `null`), except `float`, which is `f64`.
- A function without a return annotation has no result; a function with an annotation
  produces `i32`/`f64` (even `-> unit`: the result is `i32` and `i32.const 0` at the
  end).
- `void` calls (`print`, `assert`, `assert_eq`, `store8`, `store32`,
  `memcopy`, user functions without a result, methods without a `return` annotation) do
  not leave a value on the stack; in statement position `DROP` is not emitted for them
  (`expr_produces_value`).
- Function parameters default to `i32` if there is no `float`/`f64` annotation.
- A function without an annotation but with `return expr` gets the result `i32` — even
  if it returns a float expression (a defect).

## Compiler C-ABI (engine #2 in the browser)

The compiler built with `cargo build --release --target wasm32-unknown-unknown`
(`web-ide/compiler.wasm`) exports six functions (`src/lib.rs`):

| Export | Signature | Purpose |
|---|---|---|
| `latent_alloc` | `(i32 size) -> i32` | allocate a buffer from a Rust `Vec` (leaked until `latent_free`) |
| `latent_compile` | `(i32 src_ptr, i32 src_len) -> i32` | compile **one** source from linear memory |
| `latent_compile_files` | `(i32 manifest_ptr, i32 manifest_len) -> i32` | compile a project from an `LPF1` manifest |
| `latent_bundle_files` | `(i32 manifest_ptr, i32 manifest_len) -> i32` | build the flat Latent source of a project (`bundle`) |
| `latent_free` | `(i32 ptr, i32 size)` | free the buffer (`Vec::from_raw_parts(ptr, 0, size)`) |
| `latent_version` | `() -> i32` | return a buffer with the version |

The response buffer format of `latent_compile` (and of both module functions):

```text
[status u32 LE][len u32 LE][payload: len bytes]
status = 1 → the payload is the .wasm bytes (for latent_bundle_files — a UTF-8 source)
status = 0 → the payload is a UTF-8 error message
```

The `latent_version` buffer format:

```text
[len u32 LE][utf8: "latent 0.1.0"]
```

The order of use (see `web-ide/compiler/wasm-loader.js`):

1. `ptr = latent_alloc(len)`;
2. write the source into `memory[ptr..ptr+len]`;
3. `res = latent_compile(ptr, len)`;
4. read `status`/`len`/`payload` at `res`;
5. free both buffers with `latent_free`.

The compiler module is instantiated without imports
(`WebAssembly.instantiate(bytes, {})`); it is a pure `wasm32-unknown-unknown` module.

### Module ABI: the `LPF1` manifest

`latent_compile_files` and `latent_bundle_files` take a project manifest instead of
a source (little-endian):

```text
magic "LPF1" (4 bytes)
u32 file_count
file_count × { u32 path_len, path utf8, u32 src_len, src utf8 }
u32 entry_index
```

Paths are relative (`main.lat`, `lib/math.lat`), and the entry is given by its
index in the list. The response is the same `[status][len][payload]`. The
single-file `latent_compile` does not support imports and returns an error with a
hint about `compile_files`; the details and limitations are in
[modules](../guide/modules.md) and
[CLI](./cli.md#multi-file-abi-latent_compile_files).

## Limitations and defects

- There is no memory limit, but a failed `memory.grow` is not diagnosed.
- Data sections: one segment per string; with many literals the module grows quickly.
- There is no table if there are no lambdas; there is no start section; `env.print` is
  always instantiated.
- The enum table is global by variant names.
- A float in arrays/fields/lambdas has no full representation — invalid modules appear
  (see
  [defects](./errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm)).

## Related sections

- [Codegen internals](../specs/internals-codegen.md) — how this is emitted.
- [Instruction map](../specs/bytecode.md) — which opcodes are used.
- [self-hosted compiler](../specs/selfhost.md) — it has an INPUT/OUTPUT ABI
  (3145728 / 65536) that is a **different** contract; do not confuse it with the ABI of
  the program module.
