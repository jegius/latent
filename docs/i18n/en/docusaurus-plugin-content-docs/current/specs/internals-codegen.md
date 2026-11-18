---
title: "Codegen Internals"
description: "How the Rust Latent compiler builds WASM: passes, sections, the string pool, the bump allocator, runtime helpers, lambdas/table/call_indirect, classes (mangled names), enum tags, void values, print conversions, and known defects."
sidebar_position: 5
---

# Codegen internals

Source of truth: `src/codegen/`. The module is assembled manually, byte by byte, without
`wasm-bindgen`/`wasm-encoder`.

## File map

| File | Responsibility |
|---|---|
| `bytecode.rs` | `ByteBuffer` (LEB128), opcode/valtype constants |
| `module_builder/mod.rs` | the `WasmCodegen` structure, the pass order, `body_returns_value`, layout helpers |
| `module_builder/collect.rs` | the first pass: class layouts, enum variants, function and method signatures |
| `module_builder/emit_ops.rs` | reusable emitters (`i32.load/store`, `f64.load/store`, helper call) |
| `sections.rs` | section emission (exports, table, memory, global, element, code, data) |
| `memory.rs` | the bump allocator for static memory and the string literal pool |
| `context.rs` | `FuncContext` (locals, static types), `ClassLayout`, `latent_to_wasm`/`StaticTy` |
| `compile_fn.rs` | the function body: locals, the capture prologue, result finalization |
| `emit_stmt.rs` | statements (`let`/`if`/`while`/`for`/`return`/`spawn`/`select`/...) |
| `emit_expr/mod.rs` | the expression dispatcher and simple (scalar) forms, `expr_produces_value` |
| `emit_expr/binary.rs` | binary/unary operators and string coercion |
| `emit_expr/access.rs` | indexing, fields, assignments |
| `emit_expr/ty.rs` | the best-effort `static_ty_of` and the class name of an expression |
| `emit_call/mod.rs` | the call dispatcher |
| `emit_call/direct.rs` | direct calls of functions and builtins (including `compile_memory_builtin`) |
| `emit_call/constructors.rs` | `new Class(...)` |
| `emit_call/method.rs` | object methods and array operations (`push`/`pop`) |
| `emit_call/array.rs` | an array literal in linear memory |
| `emit_lambda.rs` | lambdas: registration, closure conversion, `call_indirect` |
| `emit_enum.rs` | enum variants and patterns |
| `emit_match.rs` | `match` as an `if/else` chain |
| `runtime_helpers/mod.rs` | registration of the 9 runtime helpers and common primitives |
| `runtime_helpers/alloc.rs` | the bump allocator (`__latent_alloc`, `memory.grow`) |
| `runtime_helpers/mem.rs` | byte-wise copying and byte access |
| `runtime_helpers/string.rs` | strings: length, concatenation, equality, character |
| `runtime_helpers/int.rs` | `int` ↔ `string` |
| `runtime_helpers/f64.rs` | `float` → `string` |

## Passes

`WasmCodegen::compile` (`module_builder/mod.rs`, table collection in
`module_builder/collect.rs`):

1. `write_header()` — the `\0asm` magic, version 1;
2. `collect_class_layouts` — the sizes and field offsets of all classes;
3. `collect_enum_variants` — variant tags (the built-in `Ok/Err/Some/None` first);
4. `collect_function_signatures` — the types and indices of all user `fn`s;
5. `collect_class_methods` — class methods as functions `Class_method` with an implicit
   `this`;
6. `collect_lambdas` — finds lambdas and registers them as `__lambda_N`;
7. `register_helpers` — the 9 runtime functions;
8. the bodies of user functions;
9. the bodies of class methods;
10. the bodies of lambdas;
11. the bodies of the helpers;
12. `emit_exports`, `emit_sections`.

The function index order: import (0) → user `fn`s → methods → lambdas → helpers. A
function index is `import_count + func_count` at the moment of registration, so later
entities shift when earlier ones are added.

## Static types (StaticTy)

The type checker's `Type` is not passed to codegen. Instead, codegen computes a
best-effort `StaticTy` (`context.rs`): `Int`, `Float`, `Bool`, `Str`, `Array`,
`Fn`, `Unknown`.

- For a number literal: `Int` if `n.fract() == 0.0`, otherwise `Float`;
- `static_ty_of(expr)` (`emit_expr/ty.rs`) — a recursive estimate: literals, locals
  (from `local_static` based on the annotation), binary operations (strings → `Str`,
  float → `Float`, otherwise `Int`), `len`/`int` → `Int`, `str` → `Str`,
  `float` → `Float`, calls — the `fn_return_static` of the function;
- `StaticTy::valtype()`: `Float` → `f64`, everything else → `i32`.

The errors of this model are the main source of invalid WASM (see
[defects](#known-defects)).

## Local variables

`FuncContext` (`context.rs`) stores for each local:

- `locals: HashMap<name, (index, wasm_valtype)>`;
- `local_types: Vec<u8>` — the actual WASM type of the slot;
- `local_static: Vec<StaticTy>` — for instruction selection;
- `local_class: Vec<Option<String>>` — the class name (for fields/methods).

A `let` without an annotation takes its type from `static_ty_of(value)`, with an
annotation from `latent_to_wasm`. `write_locals` groups consecutive locals of the same
type into `[count][valtype]` series (after the parameters).

## Sections

The order: type(1), import(2), func(3), table(4 — only with lambdas),
memory(5), global(6), export(7), element(9 — only with lambdas), code(10),
data(11). The detailed contract is in the [WASM ABI](../reference/wasm-abi.md).

- `memory`: 16 pages (`memory_pages = 16`), without max;
- `global 0`: `(mut i32)` = `memory_offset` at the moment the sections are emitted — the
  heap start after the static data;
- `export`: `memory` always; `main` — if the function exists;
- table/element: only if `lambdas` is not empty; the slot = function index, and the
  element segment lists all functions `0..total_funcs`.

## String pool and bump allocator

`memory.rs`:

- `alloc_memory(size, align)` aligns `memory_offset` and advances it;
- `add_string(text)` deduplicates by content, puts the data into the data section as an
  active segment `[len u32 LE][utf8]` at `addr`, and returns the address. The start
  value of `memory_offset` is 1024.
- The heap starts after all literals (the global) and grows through `__latent_alloc`
  (bump + `memory.grow`); memory is never reused.

## Runtime helpers

`runtime_helpers/` (`mod.rs` + `alloc`/`mem`/`string`/`int`/`f64`) registers the
functions (the names in the README comments are `__latent_*`):

| Helper | Signature | What it does |
|---|---|---|
| `__latent_alloc` | `(i32)->i32` | bump, `memory.size/grow` |
| `__latent_mem_copy` | `(i32,i32,i32)` | a byte-wise `loop` with `load8_u`/`store8` |
| `__latent_str_len` | `(i32)->i32` | an `i32.load` of the header |
| `__latent_str_concat` | `(i32,i32)->i32` | alloc(len_a+len_b+4), 2×memcopy |
| `__latent_str_eq` | `(i32,i32)->i32` | pointers first, then the length, then the bytes |
| `__latent_str_char_at` | `(i32,i32)->i32` | a byte, or `-1` |
| `__latent_i32_to_str` | `(i32)->i32` | decimal representation, minus sign |
| `__latent_f64_to_str` | `(f64)->i32` | `<int>.<6 digits>` |
| `__latent_str_to_i32` | `(i32)->i32` | an ASCII parser with `-`, stops at a non-digit |

The helper bodies are written by hand with the same `ByteBuffer`/opcodes; `f64_to_str`
uses a separate set of locals (i32 + f64).

## Classes

- Layout: a `float` field → 8 bytes (`f64`), the others → 4 (`i32`); each field is
  aligned to its size; the final size is aligned to 4.
- Methods: the name is mangled as `ClassName_methodName`; the first parameter is `this`
  of the class type (added in `collect_class_methods`).
- `obj.method(args)` (`emit_call/method.rs`): the class name is derived by
  `infer_class_name` (a local with a class, `this`, `new Class`); then a direct call of
  `Class_method(obj, args...)`.
- `new Class(args)`: alloc(layout.size) through the heap global → compilation of the
  arguments → a call of `Class_init`/`Class_new` if found → the result is a pointer.
- Field access — `obj + offset` + `i32.load`/`f64.load`; assignment —
  `i32.store`/`f64.store`; an assignment expression leaves the value.

## Enums

`emit_enum.rs`:

- a 0-ary variant — the tag value (`i32.const tag`);
- an n-ary one — `alloc(4+4n)`, with the tag in `[0]`, then the fields via `i32.store`
  (that is why a float payload breaks);
- `match` over a constructor — `emit_constructor_test`: comparing
  `i32.load(scrut)` with the tag; for 0-ary variants the value itself is compared;
  field binding — `bind_constructor_fields`;
- the variant table — `HashMap<variant_name, (tag, arity)>`, global for the module; the
  built-ins are registered with `entry().or_insert`, the user ones with `insert` (they
  overwrite).

## Lambdas and closures

`emit_lambda.rs`:

1. `collect_lambdas` walks the program; for each lambda it stores the parameters, the
   body, and the captured names (`locals` from the parser, filtered of function names);
2. the lambda is registered as `__lambda_N` with the canonical type
   `(env i32, params…) -> i32` (the type is deduplicated by `add_func_type_cached`);
3. when a lambda is evaluated (`compile_lambda`): `env = alloc(4*n)`, the captures are
   copied, `closure = alloc(8)`, `[0]=table_slot(=func_idx)`, `[4]=env`;
4. a call (`compile_indirect_call`): `env, args…, table_slot` are pushed,
   then `call_indirect` with the type `(i32 env, i32…) -> i32`.

The result is always `i32`, so a lambda returning a float produces an inconsistent module
(a defect).

## `match`

`emit_match.rs` compiles match as nested `if/else` with an `i32` block type:

- the scrutinee is stored in a local;
- wildcard — the body immediately;
- identifier — binds the value and executes the body;
- literal — a comparison (`i32.eq`/`f64.eq`/`str_eq`) + `if/else`;
- constructor — `emit_constructor_test` + field binding.

With no matching arm, the `else` branch leaves `0`. The `default` arm compiles as a
wildcard.

## `void` and values

- `body_returns_value` (in `module_builder/mod.rs`) recursively looks for `return expr`
  in the body — this decides whether a function without an annotation gets the result
  `i32`.
- `compile_fn`: `has_result = ret_ty.is_some() || body_returns_value`; if a result is
  declared but the body does not end with `RETURN`, `i32.const 0` (or `f64.const 0`) is
  appended.
- `expr_produces_value` (`emit_expr/mod.rs`) reports whether an expression leaves a
  value: `print`/`assert`/`assert_eq`/`store8`/`store32`/`memcopy` and void functions —
  no; otherwise — yes. In statement position the extra value is removed with `drop`.

## `print` conversions

`compile_direct_call("print", args)`:

- for each argument: `compile_expr(arg)`;
- by `static_ty_of(arg)`: `Str` — no conversion, `Float` —
  `__latent_f64_to_str`, otherwise — `__latent_i32_to_str`;
- then `call env.print` (a separate call per argument).

That is why `print(true)` prints `1`, `print(null)` prints `0`, and strings from
`.to_str()` may be printed as an address (the result type of a method is not tracked).

## Known defects

See the detailed table in
[diagnostics](../reference/errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm). In short:
float literals with a zero fractional part are emitted as `i32.const`, which breaks the
f64 context; `%` is always `i32.rem_s`; `sqrt` over an int literal; float class fields
and enum payloads; `new Class` without `init`; the result of a lambda is always `i32`;
`static_ty_of` does not track the string type of a method result.

> The shipped `web-ide/compiler.wasm` **neither hides nor adds** these defects: it is
> built from the current `src/`, and the memory builtins are present in it.

## How to extend codegen

A new construct usually requires changes along the chain:

1. `src/parser/…` (a new production);
2. `src/ast/…` (an AST node);
3. `src/typechecker/infer/…` (the type);
4. `src/codegen/emit_*.rs` / `emit_expr/` / `emit_call/` (emission);
5. `src/codegen/module_builder/` (if a new pass/table is needed);
6. `tooling/language-data/language.json`, selfhost, docs, tests.

The detailed checklist is in [contributing](../tooling/contributing.md).

## Related sections

- [WASM ABI](../reference/wasm-abi.md) — the memory layout.
- [Instruction map](./bytecode.md) — which opcodes are used.
- [Engines](./engines.md), [selfhost](./selfhost.md).
- [Rust compiler architecture](./rust-architecture.md) — layers, decomposition,
  coverage.
- [Web IDE architecture](./webide-architecture.md) — how codegen is used in the browser.
