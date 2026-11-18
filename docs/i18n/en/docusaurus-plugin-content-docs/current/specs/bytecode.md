---
title: "WASM Instruction Map"
description: "Which WASM opcodes the Latent codegen uses, for which constructs, how LEB128 and types are encoded; the construct → instructions map."
sidebar_position: 6
---

# Instruction map

The codegen does not use a ready-made encoder: it writes bytes through `ByteBuffer`
(`src/codegen/bytecode.rs`). The opcode set is limited to the constants in
`bytecode::op`; below is what is emitted and why.

## Encoding

- The module header: `00 61 73 6D 01 00 00 00`.
- `u32`/`i32` — LEB128 (`write_u32`, `write_i32`); there are `write_u64`/`write_i64`
  (for future 64-bit values; barely used now).
- An `f64` constant — `f64.const` + **8 little-endian bytes**
  (`ctx.body.extend(&n.to_le_bytes())`).
- `memarg`: `align` (the log2 of the alignment) and `offset`. For `i32` — align=2
  (4 bytes), for `f64` — align=3 (8 bytes), for bytes — align=0.
- `valtype`: `I32=0x7F`, `I64=0x7E`, `F32=0x7D`, `F64=0x7C`, `VOID=0x40`.

## Opcodes in use

### Control flow

| Opcode | Code | Where |
|---|---|---|
| `unreachable` | `0x00` | `assert`/`assert_eq` on failure |
| `block` | `0x02` | loops (`while`, `for`), memcopy/str_eq |
| `loop` | `0x03` | loops, helpers |
| `if` | `0x04` | `if`/`else`, `&&`/`\|\|`, `match`, assert |
| `else` | `0x05` | `if`/`else`, short-circuiting |
| `end` | `0x0B` | the end of blocks/bodies/sections |
| `br` | `0x0C` | the end of a loop iteration |
| `br_if` | `0x0D` | the loop exit condition |
| `return` | `0x0F` | `return` |
| `call` | `0x10` | calls of functions/helpers/the import |
| `call_indirect` | `0x11` | closure calls (through the table) |
| `drop` | `0x1A` | removing the value of an expression statement |

### Variables and globals

| Opcode | Code | Where |
|---|---|---|
| `local.get` | `0x20` | reading a local/a parameter |
| `local.set` | `0x21` | writing a local |
| `local.tee` | `0x22` | "write and keep" (arrays, `new`, closure) |
| `global.get` | `0x23` | reading the heap pointer |
| `global.set` | `0x24` | writing the heap pointer |

### Memory

| Opcode | Code | Where |
|---|---|---|
| `i32.load` | `0x28` | string/array headers, fields, elements |
| `f64.load` | `0x2B` | float object fields |
| `i32.load8_u` | `0x2D` | string bytes, `load8`, memcopy |
| `i32.store` | `0x36` | headers, elements, fields, enum tags |
| `f64.store` | `0x39` | float object fields |
| `i32.store8` | `0x3A` | string bytes, `store8` |
| `memory.size` | `0x3F` | inside `__latent_alloc` |
| `memory.grow` | `0x40` | inside `__latent_alloc` |
| `i32.const` | `0x41` | all integer constants and offsets |
| `f64.const` | `0x44` | float literals (non-integer ones) |

### Comparisons/logic (i32)

| Opcode | Code | Where |
|---|---|---|
| `i32.eqz` | `0x45` | `!`, `assert`, loop exit, `&&`/`\|\|` |
| `i32.eq` | `0x46` | `==`, `assert_eq`, enum tags, match literals |
| `i32.ne` | `0x47` | `!=` |
| `i32.lt_s` / `gt_s` / `le_s` / `ge_s` | `0x48/0x4A/0x4C/0x4E` | `< > <= >=` |
| `i32.ge_u` | `0x4F` | loops (`for-in`), memcopy, str_eq |

### f64 comparisons

| Opcode | Code | Where |
|---|---|---|
| `f64.eq`/`ne`/`lt`/`gt`/`le`/`ge` | `0x61..0x66` | float comparisons |

### i32 arithmetic

| Opcode | Code | Where |
|---|---|---|
| `i32.add` | `0x6A` | `+`, address arithmetic |
| `i32.sub` | `0x6B` | `-`, unary minus |
| `i32.mul` | `0x6C` | `*`, indexing (`i*4`) |
| `i32.div_s` | `0x6D` | `/` for int |
| `i32.div_u` | `0x6E` | helpers (the digits of `i32_to_str`) |
| `i32.rem_s` | `0x6F` | `%` |
| `i32.rem_u` | `0x70` | the `i32_to_str` helper |
| `i32.and` | `0x71` | `&`, `&&` (not for the latter — `if` is used there) |
| `i32.or` | `0x72` | `\|` |
| `i32.xor` | `0x73` | `^` |
| `i32.shl` | `0x74` | `<<` |
| `i32.shr_s` | `0x75` | `>>` |
| `i32.shr_u` | `0x76` | selfhost (LEB128) |

### f64 arithmetic/math

| Opcode | Code | Where |
|---|---|---|
| `f64.add`/`sub`/`mul`/`div` | `0xA0..0xA3` | float arithmetic |
| `f64.neg` | `0x9A` | unary minus on float |
| `f64.sqrt` | `0x9F` | the `sqrt` builtin |

### Conversions

| Opcode | Code | Where |
|---|---|---|
| `i32.trunc_f64_s` | `0xAA` | `int(float)` |
| `f64.convert_i32_s` | `0xB7` | `float(int)`, `sqrt(int)`, `float(str)` |
| `i32.wrap_i64` | `0xA7` | reserved |

## The construct → instructions map

| Construct | Emission |
|---|---|
| `let x = e;` | the code of `e` + `local.set` |
| `x = e;` | the code of `e` + `local.set` + `local.get` (the result is the value) |
| `a[i] = v` | the code of `v` → temp; `a`, `i`, `i32.const 4`, `i32.mul`, `i32.add`, `i32.const 4`, `i32.add`, `local.get temp`, `i32.store`; the result is temp |
| `o.f = v` | the code of `v` → temp; `o + offset`; `local.get temp`; `i32.store`/`f64.store` |
| `if` | `cond`, `if void`, then, `else`, else, `end` |
| `while` | `block void`, `loop void`, `cond`, `i32.eqz`, `br_if 1`, body, `br 0`, `end`, `end` |
| C-style `for` | init; `block/loop`; `cond`, `i32.eqz`, `br_if 1`; body; step, `drop`; `br 0`; `end`×2 |
| `for (x in arr)` | arr → local; idx=0; `block/loop`; the check idx < len; `br_if`; `arr[idx]` → var; body; idx++; `br 0` |
| `spawn { ... }` | the body as ordinary statements (sequentially) |
| `select` | the body of the first arm (or default), the variable = 0 |
| `yield` | nothing |
| `print(x)` | the code of `x` → conversion to a string (`i32_to_str`/`f64_to_str`) → `call import0`; separately for each argument |
| `len(x)` | the code of `x`, `i32.load` |
| `str/int/float/sqrt` | the code of `x` + the required conversions (see `emit_call/direct.rs`) |
| `assert(c)` | the code of `c`, `i32.eqz`, `if void`, `unreachable`, `end` |
| `assert_eq(a,b)` | the code of `a`, `b`, `i32.eq`, `i32.eqz`, `if void`, `unreachable`, `end` |
| `arr.push(v)` | arr → local; v → local; `arr[len]=v`; `arr.len=len+1`; push arr |
| `arr.pop()` | `arr.len--`; `i32.load(arr+4+len*4)` |
| an array literal | `alloc(4+4n)`; `len`; the elements via `i32.store` |
| `new Class(args)` | `global.get heap`, temp, `+size`, `global.set heap`; args; `call Class_init` (if present); `local.get temp` |
| `obj.method(args)` | `obj`, args, `call Class_method` |
| a 0-ary enum variant | `i32.const tag` |
| an n-ary enum variant | `alloc(4+4n)`, `tee`, tag, fields |
| `match` | scrutinee → local; an `if/else` chain over the patterns |
| a lambda | env-alloc, copying the captures, closure-alloc (8 bytes) |
| a closure call | `env`, args, `table_slot`, `call_indirect (env,args)->i32` |
| `await e` | the code of `e` (passthrough) |
| a function body | locals declarations, the capture prologue, the statements, and with `has_result` a `const 0` if there is no `return`, then `end` |

## What is missing

- The `select` opcode (not to be confused with the language's `select`) is not used.
- `br_table`, loops with a result, and `block` with a type are not used.
- `memory.copy`/`memory.fill` (bulk memory) — a manual `loop` and the `memcopy` helper
  are used instead.
- f32, i64 arithmetic, reference types, SIMD, and GC instructions — none.
- A `start` section, data count, and passive segments — none.

## Reading the bytecode

In the web IDE the WASM tab shows a hex dump via `formatBytecode`
(`web-ide/services/compiler-service.js`): the offset, 16 hex bytes, ASCII. Sections can
be found by ID (`0x01` type, `0x02` import, `0x03` func, `0x04` table,
`0x05` memory, `0x06` global, `0x07` export, `0x09` element, `0x0A` code,
`0x0B` data). Strings in the data section appear as `[len][utf8]`.

## Related sections

- [Codegen internals](./internals-codegen.md) — the passes and structures.
- [WASM ABI](../reference/wasm-abi.md) — the data layout.
- [Diagnostics](../reference/errors.md) — the codegen error texts.
