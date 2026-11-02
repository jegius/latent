# Rust Compiler of Latent: Architecture, Decomposition, and Coverage

This document describes `src/` — the Latent → WebAssembly compiler ("engine #2"), the
principles of its decomposition, its public contract, and its invariants. For an overview
of the whole repository, see the root
[`ARCHITECTURE.md`](https://github.com/jegius/latent/blob/part10-toolchain/ARCHITECTURE.md).

## 1. Layers and data flow

```
&str
 │  lexer  (src/lexer)
 ▼
Vec<Token>          comments are tokens too; the parser filters them out
 │  parser (src/parser)
 ▼
ast::Program        src/ast — pure structures, no logic
 │  typechecker (src/typechecker)
 ▼
Ok(()) | Vec<TypeError>
 │  codegen (src/codegen)
 ▼
Vec<u8>             a binary WASM module (no WASI, one env.print import)
```

The single entry point is `latent::compile_source` (`src/lib.rs`): fail-fast on the
lexer/parser, accumulation of type checker errors (joined with `"; "`), and the first
codegen error. The C-ABI (`latent_alloc/latent_free/latent_compile/
latent_version`) is a wrapper over the same function for the browser.

### Order of the codegen passes

`WasmCodegen::compile` (`src/codegen/module_builder/mod.rs`):

1. the module header;
2. `collect_class_layouts` — the class layouts (field alignment, f64 = 8 bytes);
3. `collect_enum_variants` — `enum` tags + the built-in `Ok/Err/Some/None`;
4. `collect_function_signatures` — top-level `fn`s (including the implicit i32 result
   for `return expr` without an annotation);
5. `collect_class_methods` — methods as `Class_method(this, ...)`;
6. `collect_lambdas` — hoisting lambdas into functions `__lambda_N`;
7. `register_helpers` — the 9 runtime helpers;
8. function bodies → method bodies → lambda bodies → helper bodies;
9. exports (`memory`, `main`) and sections.

## 2. Module map

| Module | Responsibility |
|---|---|
| `lexer/` | `scanner` (the loop), `next_token` (operators/delimiters), `readers` (numbers, strings, comments), `keywords`, `token`, `position`, `error` |
| `parser/` | `cursor` (the token stream), `declarations` (fn/class/enum/test), `statements`, `expressions/{core,prefix,postfix,lambda_match}`, `type_parser` |
| `ast/` | `expr`, `stmt`, `ops` — data only |
| `typechecker/` | `checker` (the walk), `environment` (scopes), `infer/{expr,call,effects,stmt}`, `types/` (HM types, unify, free_vars) |
| `codegen/` | `bytecode` (LEB128, opcodes), `context` (FuncContext, StaticTy, layout), `module_builder/{mod,collect,emit_ops}`, `compile_fn`, `emit_stmt`, `emit_expr/{mod,binary,access,ty}`, `emit_call/{mod,direct,constructors,method,array}`, `emit_lambda`, `emit_match`, `emit_enum`, `runtime_helpers/{mod,alloc,mem,string,int,f64}`, `memory`, `sections` |
| `runtime/` | host channels/the scheduler for the native target (not wired into `compile_source`, tested separately) |
| `ai/`, `fp/` | standalone AI/FP subsystems (offline providers, Result/Option/Promise, VectorDB); wired into the crate, but not into the pipeline |
| `types.rs`, `syntax.rs` | alternative models of types/syntax, not used by the pipeline (kept for API compatibility) |

## 3. Public contract (must not be changed)

```rust
pub fn compile_source(source: &str) -> Result<Vec<u8>, String>;
pub const VERSION: &str;

// C-ABI (wasm32): response buffer = [status u32 LE][len u32 LE][payload...]
pub extern "C" fn latent_alloc(size: usize) -> *mut u8;
pub extern "C" fn latent_free(ptr: *mut u8, size: usize);
pub extern "C" fn latent_compile(src_ptr: *const u8, src_len: usize) -> *mut u8;
pub extern "C" fn latent_version() -> *mut u8;
```

`scripts/build-wasm.sh` copies `target/wasm32-unknown-unknown/release/latent.wasm` to
`web-ide/compiler.wasm` and `web-ide/latent.wasm`; engine #2 in the browser calls
exactly this ABI. Changing the signatures or the buffer format breaks the web IDE.

## 4. WASM codegen invariants

1. **One import**: `env.print: (i32) -> ()`; all functions of the module are shifted by
   1.
2. **Memory**: a dedicated section (16 pages at start), the bump allocator
   `__latent_alloc` grows through `memory.grow`; strings are `[len u32 LE][utf8]`.
3. **Sections go strictly in increasing id order**; table/element — only with lambdas.
4. **Types on the stack**: instruction selection (`i32` vs `f64`) is determined by the
   syntactic `StaticTy`, while a local's slot comes from its annotation; there are no
   conversions. Hence the known limitations (`5.0` is an int literal, `sqrt` in `print`,
   and so on) — they are **locked in by the golden set** and are not fixed by
   refactoring.
5. **Determinism**: the order of the AST walk and of entity registration is fixed; the
   golden set (`scripts/check-golden.mjs`) requires a byte-for-byte match.

## 5. Decomposition: what and why

Files over ~300–350 lines were split by SRP; behavior did not change (the golden WASM
matches). The "before → after" table:

| Before (lines) | After |
|---|---|
| `codegen/runtime_helpers.rs` (662) | `runtime_helpers/{mod,alloc,mem,string,int,f64}.rs` — registration/common primitives, the allocator, copying, strings, int→str, f64→str |
| `codegen/emit_expr.rs` (572) | `emit_expr/{mod,binary,access,ty}.rs` — the dispatcher, operators/coercion, indexing/fields/assignments, static types |
| `codegen/emit_call.rs` (495) | `emit_call/{mod,direct,constructors,method,array}.rs` — the dispatcher, builtins/memory, `new`, methods/push/pop, the array literal |
| `codegen/module_builder.rs` (388) | `module_builder/{mod,collect,emit_ops}.rs` — state/the pass order, the first pass, reusable emitters |
| `typechecker/infer/expr.rs` (352) | `infer/expr/{mod,call,effects}.rs` — basic forms, calls/builtins, host effects |
| `codegen/tests/features.rs` (370) | `tests/features.rs` + `tests/features_misc.rs` |
| `parser/tests/stmts_exprs.rs` (353) | `tests/stmts_exprs.rs` + `tests/new_features.rs` |

Duplication was removed: the common emitters `i32.load/store`, `f64.load/store`, and
`emit_helper_call` were moved into `module_builder/emit_ops.rs`; the duplicate
`#[allow(dead_code)]` and the unused `WasmCodegen` fields were deleted.

### SOLID decisions

* **SRP** — each file is responsible for one area (lexer/parser/types/emission of
  expressions/calls/helpers); the data (`ast/`, `bytecode`) is separated from the logic.
* **OCP** — new builtins/operators are added to the `direct.rs`/`binary.rs` dispatchers
  without touching the `mod.rs` dispatcher.
* **DIP** — codegen does not depend on the type checker's types: it communicates through
  `StaticTy` and `FuncContext`; replacing the type checker does not require changing the
  emitters.
* **ISP** — `FuncContext` exposes a narrow interface (locals/static/class), and
  `WasmCodegen` only `emit_*`/`helper_idx`, without "god" facades.

## 6. Tests and coverage

```pwsh
# all tests: 265 (202 before decomposition and the coverage tests)
cargo +stable-x86_64-pc-windows-gnu test

# golden: 48 programs (23 fixtures + 24 web-ide examples + selfhost/shc.lat)
node scripts/check-golden.mjs
node scripts/check-golden.mjs --update   # only for a deliberate change

# line coverage (llvm-cov)
pwsh scripts/coverage-rust.ps1
```

### Coverage (llvm-cov, lines, tests excluded)

Result: **91.0 % of lines** (5845 lines, 526 uncovered), 93.5 % of functions.
The report was produced by `llvm-cov report` over an instrumented `cargo test
--all-targets`; in the repository the command is available as
`scripts/coverage-rust.ps1`.

What is covered by tests (including the "dead" host modules):

* `lexer/**`, `parser/**`, `ast/**` — valid syntax + all error branches;
* `typechecker/**` — type inference, unify, type errors, builtins, host effects;
* `codegen/**` — all families of expressions/statements, lambdas, enum/match,
  classes, runtime helpers, error branches (including those reachable only with the type
  checker disabled);
* `ai/**`, `fp/**`, `runtime/**` — direct unit tests of the public APIs (although these
  modules do not participate in `compile_source`);
* `types.rs`, `syntax.rs`, `bytecode.rs`, `context.rs` — inline tests.

Deliberately **not included** in the threshold: `src/bin/**` (the CLI, tested by smoke
tests and golden), the test files, and std/rustc objects.

### Why not the ordinary `cargo llvm-cov` on Windows-gnu

In this environment the rust-std for `x86_64-pc-windows-gnu` does not contain
`libprofiler_builtins` (`E0463`), and GNU ld places the `.lcov*` sections incorrectly
(the resulting exe is invalid). A working workaround (implemented in
`scripts/coverage-rust.ps1`):

1. an rlib stub for `profiler_builtins` with `#![profiler_runtime]` (built by
   `rustc` with `RUSTC_BOOTSTRAP=1`);
2. `RUSTFLAGS="-C instrument-coverage"` + linking through `lld`
   (`-fuse-ld=lld`, `--no-gc-sections`) with a static profiling runtime
   (`COV_PROFILER_RT`) built from `compiler-rt/lib/profile`;
3. `llvm-profdata merge` + `llvm-cov report` from the `llvm-tools-preview` component
   (`rustc --print sysroot`).

## 7. Known limitations (not fixed as part of the refactoring)

These are defects of the current semantics, locked in by the golden set; fixing them
would change the WASM bytes and is a separate task:

* literals like `2.0` are treated as `int` (the lexer + `fract() == 0.0`);
* `sqrt`/methods returning `f64` have no static result type —
  `print(sqrt(x))` produces invalid WASM;
* `push` into an array created as `[]` writes beyond the allocated block;
* `spawn`/`select`/`yield`/`await` compile into a surrogate without a host runtime;
* a top-level `let`, nested `fn`s, and top-level decorators are not emitted.
