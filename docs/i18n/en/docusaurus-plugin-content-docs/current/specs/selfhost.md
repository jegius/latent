---
title: "Self-Hosted Compiler"
description: "The final status of the Latent compiler written in Latent itself: the stage2===stage3 fixed point, 169 tests, 64/65 parity with the Rust reference, the Rust-free bootstrap (seed + WASM), modules via bundle, the src/*.lat parts, the compiler ABI, the memory budget, host constructs, and the remaining divergences."
sidebar_position: 1
---

# Self-hosted compiler (`selfhost/`)

`selfhost/` is a Latent→WebAssembly compiler **written in Latent itself**. It builds
itself up to a fixed point: `stage2 === stage3` byte for byte.

Sources of truth: `selfhost/README.md`, `selfhost/build.mjs`,
`selfhost/bootstrap.mjs`, `selfhost/src/*.lat`.

## Status: parity achieved

- **Fixed point**: `stage2 === stage3` (checked by `bootstrap.mjs` and
  `bootstrap.test.mjs`); the Rust-free chain `seed → stage-sh-1 → stage-sh-2 →
  stage-sh-3` yields `stage-sh-2 === stage-sh-3` (checked by `bootstrap-wasm.mjs`
  and `bootstrap-wasm.test.mjs`).
- **Regression suite — 173 tests** (`node --test "selfhost/test/*.test.mjs"`,
  19 suites, 0 failures): the fixed point, parity with the Rust reference, the
  Rust-free bootstrap, lexer/scoping, float arithmetic, modules via bundle, and
  the part assembler.
- **Rust is not required for the build**: the repository ships
  `selfhost/seed.wasm` (a self-hosted compiler, sha256 in `seed.json`) that
  compiles `shc.lat`; the `selfhost/wasm-compiler.mjs` CLI compiles user programs
  without `cargo`/`latentc`.
- **Parity matrix** (`latent-work/gap-matrix.mjs`): **64/65 cases** match the Rust
  reference, including 11 cases where "all three compilers produce an error". The only
  remaining divergence is `float` literals, where selfhost is **stronger** than the
  reference.
- The stage2 error text **matches stage1 character for character** (a string parameter
  typing bug was fixed).
- Host constructs are implemented to the extent of the reference's observable behavior:
  `spawn`/`yield`/`async`/`await`/`select`/`test`/`match` over strings.

```bash
node selfhost/build.mjs             # src/*.lat -> shc.lat
node selfhost/bootstrap.mjs         # stage1 -> stage2 -> stage3; FIXED POINT (Rust)
node selfhost/bootstrap-wasm.mjs    # seed -> stage1' -> stage2' -> stage3'; FIXED POINT (no Rust)
node --test "selfhost/test/*.test.mjs"
```

## Structure: one file assembled from parts

The selfhost compiler itself is **one file**. The language does have file modules
(v1, `import`/`export`), but selfhost does not parse them: it has no file system,
and its own source stays single-file. So "linking" of the parts is a
deterministic concatenation in name order (`selfhost/build.mjs`):

```text
selfhost/src/00_abi.lat              linear memory map, state slots
selfhost/src/10_buffer.lat           byte buffers [len u32][bytes], LEB128
selfhost/src/20_lexer.lat            source → parallel token arrays
selfhost/src/30_syntax.lat           token cursor, locals, name tables
selfhost/src/35_class.lat            classes (fields/methods), enum variants
selfhost/src/36_lambda.lat           lambdas/captures, closure/env
selfhost/src/40a_expr_emit.lat       expression emission: dispatcher/Pratt
selfhost/src/40b_expr_values.lat     values, literals, float
selfhost/src/40c_expr_primary.lat    primary expressions, calls
selfhost/src/40d_expr_objects.lat    fields/methods/constructors
selfhost/src/40e_expr_postfix.lat    postfix operations, indexing
selfhost/src/40f_expr_assign.lat     assignments
selfhost/src/40g_expr_operators.lat  binary/unary operators, strings
selfhost/src/45a_tc_core.lat         type check: core, type table, errors
selfhost/src/45b_tc_expr.lat         type check of expressions
selfhost/src/45c_tc_flow.lat         type check of statements/flow
selfhost/src/45d_tc_program.lat      type check of the program (pass over functions)
selfhost/src/50_stmt.lat             statement emission
selfhost/src/60_func.lat             assembly of a single function body
selfhost/src/70a_module_helpers.lat  runtime helpers (8 bodies) + emitters
selfhost/src/70b_module_convert.lat  value conversions (int/float/string)
selfhost/src/70c_module_sections.lat WASM module sections
selfhost/src/90_driver.lat           entry point: the full compilation pass
```

The parts are split by areas of responsibility (SRP) and keep being split as they grow;
the current list is `selfhost/src/` and `selfhost/build.mjs` (the concatenation goes in
sorted name order).

```text
shc.lat = BANNER + join(sorted(src/*.lat), separator)
```

The build is idempotent: one set of parts always produces the same `shc.lat`.
**`shc.lat` must not be edited by hand** — it is generated.

## Modules and bundle

Modules are a **host/linker feature**, not a selfhost one. A user project of
several `.lat` files never reaches selfhost: the compiler has no file system and
can read only one source from linear memory. So the host first produces a flat
equivalent of the project:

```bash
latentc bundle main.lat bundle.lat                 # all modules merged, names mangled
node selfhost/wasm-compiler.mjs compile bundle.lat bundle.wasm
```

What `bundle` does (`src/modules/bundle.rs`):

- links the project exactly like `latentc compile` (export tables, `m<index>$<name>`
  mangling, cycles allowed);
- prints the linked `Program` back to Latent: `import`/`export` removed, top-level
  declarations in canonical-path order — the same deterministic module order used
  for linking;
- replaces `$` in names with `__` (`m1$square` → `m1__square`), because the
  selfhost lexer accepts only `[A-Za-z_][A-Za-z0-9_]*`.

Why this design instead of teaching selfhost imports:

- selfhost has no file I/O, and adding it would drag a host API into the compiler
  and break the Rust-free bootstrap (seed → stage1′ → …);
- linking is a single AST pass that already exists in Rust and in the JS engine;
  duplicating it in Latent for selfhost's sake is unnecessary;
- a bundle is a **verifiable contract**: it is deterministic and defines the
  program behavior unambiguously.

### The parity contract is behavioral, not byte-for-byte

The requirement "`selfhost(bundle)` equals `latentc compile_files` byte-for-byte"
is **not achievable on the current selfhost and is not a goal**. The reason is not
modules: Rust and selfhost have historically generated different WASM even for the
simplest single-file program `fn main() -> int { return 42; }` — 1019 bytes
(selfhost) versus 934 (Rust). This is a known codegen divergence, not a bundle
defect.

So the modules contract for selfhost is **behavioral parity**:

| Check | Who checks it | Status |
|---|---|---|
| `latentc bundle <entry>` → the bundle has no `import`/`export` and no `$` (only `mN__name`) | `selfhost/test/modules.test.mjs` | ✅ |
| `latentc compile(bundle)` is byte-identical to `latentc compile_files(entry)` | `scripts/check-golden.mjs` + `modules.test.mjs` | ✅ linker invariant |
| `main()` of Rust and of selfhost equals the fixture's `expect-main` | `modules.test.mjs` | ✅ |
| project errors (missing file, missing export, bad path, duplicate import, import/export not at top level) are caught by the host, and `latentc bundle` returns them | `modules.test.mjs` (`errors/**`) | ✅ |
| selfhost rejects **raw** module source (`error: undefined variable: import`) instead of silently accepting it | `modules.test.mjs` | ✅ |
| byte equality selfhost vs Rust | — | ❌ not required (e.g. 1193 vs 1111 on `basic`) |

The fixtures and their markers (`// entry: true`, `// expect-main: N`,
`// expect-error: <substring>`) are described in
`selfhost/test/fixtures/modules/README.md`; the same file has the table of
observed sizes (`basic`: selfhost 1193 / Rust 1111; `cycle`: 1067 / 987).

The bundle itself is verifiable separately: compiled through the single-file ABI it
gives the same bytes as the project (the example in the
[modules walkthrough](../examples/modules.md#4-what-latentc-bundle-prints)).


## Compiler ABI

The "host → compiler-as-WASM" contract (`selfhost/bootstrap.mjs`):

| Address | Purpose |
|---:|---|
| `3145728` (`INPUT_ADDR`, 3 MiB) | input: `[len u32 LE][utf8 source]` |
| `65536` (`OUTPUT_ADDR`) | output: `[len u32 LE][wasm bytes]` |

- The host must **grow memory** to `INPUT_ADDR + 4 + len` before writing the source
  (`memory.grow`): the compiler grows memory only inside `main()` (through
  `alloc(4600000)` in `compile_program`).
- The compiler's `main()` returns the length of the output WASM.
- On a compilation error a **negative** number is returned, and
  `[len u32 LE][utf8 error text]` is placed at `OUTPUT_ADDR+4`. This holds for both type
  check errors and codegen errors (previously codegen produced invalid WASM).
- The input is placed in a separate high region because with a source >32K its tail
  overlapped `OUTB`, which `binit()` zeroes at startup (this corrupted the last tokens).
  See the comments in `00_abi.lat` and `bootstrap.mjs`.

```js
// bootstrap.mjs (simplified)
const need = Math.ceil((INPUT_ADDR + 4 + enc.length) / 65536);
if (need > have) inst.exports.memory.grow(need - have);
new DataView(memory.buffer).setUint32(INPUT_ADDR, enc.length, true);
new Uint8Array(memory.buffer).set(enc, INPUT_ADDR + 4);
const ret = inst.exports.main();
const len = new DataView(memory.buffer).getUint32(OUTPUT_ADDR, true);
const wasm = new Uint8Array(memory.buffer).slice(OUTPUT_ADDR + 4, OUTPUT_ADDR + 4 + len);
if (ret < 0) throw new Error(`compile error: ${new TextDecoder().decode(wasm)}`);
```

This is a **different** ABI from the compiler-as-WASM in the web IDE
(`latent_alloc/latent_compile`,
[WASM ABI](../reference/wasm-abi.md#compiler-c-abi-engine-2-in-the-browser)): do not
confuse them.

## Build and the bootstrap chain

```bash
# 1. the native latentc (Rust) — it builds stage1
cargo build --bin latentc

# 2. the chain
node selfhost/bootstrap.mjs
```

What `bootstrap.mjs` does:

1. `latentc` (Rust) compiles `selfhost/shc.lat` → `selfhost/stage1.wasm`;
2. `stage1.wasm` compiles `selfhost/shc.lat` → `selfhost/stage2.wasm` (self-compiled);
3. `stage2.wasm` compiles `selfhost/shc.lat` → `selfhost/stage3.wasm`;
4. `stage2 === stage3` is checked — the fixed point.

Every stage is checked with `WebAssembly.validate`. The path to `latentc` can be set
with the `LATENTC` environment variable (defaults to `target/debug/latentc`).

## Bootstrap without Rust (seed + WASM)

`selfhost/seed.wasm` is an already built self-hosted compiler (the latest
`shc.lat`, 64/65 parity, **41 482 bytes**, `seedRevision` 2). It compiles
`shc.lat`, after which the compiler reproduces itself; `cargo`/`latentc` are not
involved:

```text
seed.wasm        -> shc.lat -> stage-sh-1.wasm   (stage1')
stage-sh-1.wasm  -> shc.lat -> stage-sh-2.wasm   (stage2')
stage-sh-2.wasm  -> shc.lat -> stage-sh-3.wasm   (stage3')

stage-sh-2 === stage-sh-3                        (FIXED POINT, stage2' === stage3')
```

```bash
node selfhost/build.mjs            # src/*.lat -> shc.lat (Node only)
node selfhost/bootstrap-wasm.mjs   # seed -> ... -> FIXED POINT
node selfhost/wasm-compiler.mjs compile hello.lat   # CLI without Rust
node selfhost/wasm-compiler.mjs check|run|version   # check/run/metadata
node selfhost/bootstrap-wasm.mjs --refresh-seed     # new seed from the current shc.lat
node selfhost/bootstrap-wasm.mjs --verify-seed      # seed.json sha256 + shc.lat
```

* The `stage-sh-1/2/3.wasm` artifacts are git-ignored
  (`selfhost/stage*.wasm`) and do not collide with the `stage1/2/3.wasm` of the
  Rust chain.
* `bootstrap-wasm.mjs` uses the same ABI (`INPUT_ADDR=3145728`,
  `OUTPUT_ADDR=65536`, `ret < 0` — error text) as `bootstrap.mjs`; the shared
  wrapper is `selfhost/wasm-compiler.mjs` (`compileWith`, `runWasm`).
* `seed.json` is the trust manifest: `compilerVersion`, `seedRevision`,
  `seedSha256`/`seedBytes` (binary), `shcSha256`/`shcBytes` (source),
  `fixedPoint`, `updatedAt`/`verifiedAt`. On startup the seed's sha256/size are
  compared with the manifest; a mismatch exits with code 2 (corruption/replacement).
* `--refresh-seed` builds `stage1' → stage2' → stage3'` in memory and writes
  `seed.wasm` + `seed.json` only when `stage2' === stage3'` and `stage2'`
  reproduces itself; it prints a diff (sizes, sha256, number of differing bytes,
  first offset, `shcSha256`). `seedRevision` grows only when the seed bytes
  change; `shcSha256`/`shcBytes`/dates are always updated. `--dry-run` shows the
  diff without writing.
* Limitation: a Rust-free update works as long as the current seed can compile
  the new `shc.lat`. If a change needs a new language construct, Rust is required
  once (`bootstrap.mjs --update-seed`); after that the chain is Rust-free again.
  `--refresh-seed` does not "heal" a corrupted/replaced seed — it builds the new
  seed from the current one.
* The emergency Rust path `bootstrap.mjs --update-seed` writes an old-format
  `seed.json` (without `compilerVersion`/`seedRevision`); after it, run
  `bootstrap-wasm.mjs --refresh-seed` to upgrade the manifest to schema v2 (the
  seed bytes do not change).

## What the self-hosted compiler compiles

| Area | Support |
|---|---|
| `let`/`if`/`else`/`while`/`for`/`for-in`/`return` | ✅ |
| arithmetic, comparisons, bitwise, shifts | ✅ |
| `&&`/`\|\|` with short-circuiting | ✅ |
| arrays: literal, `[]`, `.length`, `push`, `pop`, `len` | ✅ |
| strings: `+`, `==`/`!=`, `s[i]`, `len` | ✅ |
| escape strings `\n` `\t` `\\` `\"` | ✅ |
| nested block comments `/* a /* b */ c */` | ✅ |
| `str`/`int`/`float`/`to_str`/`to_int` (by the static type of the receiver) | ✅ |
| `print(a, b, …)` — int/float/string conversion, a separate line per argument | ✅ |
| `null` (`0`, as in the reference) | ✅ |
| `assert`/`assert_eq` | ✅ |
| classes: `class`, fields, `this`, methods, `new` | ✅ |
| enums: variants (tags + payload) | ✅ |
| `match`/`case` (numbers, strings, `_`/`default`, constructors) | ✅ |
| closures: `fn(x) => expr`, `fn(x) { ... }`, captures, `call_indirect` | ✅ |
| type check: annotations, returns, arity, conditions, assignments | ✅ |
| float: literals `1.25`, `1e3`, `2.5e1`, `1250e-1`, `+ - * /`, comparisons | ✅ |
| `float` return `fn f() -> float`, f64 in expressions | ✅ |
| `float` locals, `sqrt`, `float(x)`, `str(float)` | ✅ |
| mixed arithmetic `int ⊕ float` (int→f64 promotion) | ✅ (beyond the reference) |
| `spawn { … }` / `spawn expr;` | ✅ — the body is inlined (sequentially), as in the reference |
| `yield;` | ✅ — a no-op |
| `async fn` | ✅ — the flag is ignored |
| `await expr` | ✅ — a passthrough of the value |
| `select` expression/statement | ✅ — the first arm, otherwise `default`, otherwise `0` |
| `test "name" { … }` | ✅ — not emitted at top level, executed inside a function |
| `channel`/`tensor`/`ai_*`/`ch <- v`/`ch.send` | ❌ the "requires host runtime" error naming the construct |
| `float` parameters `fn f(r: float)` | ❌ (invalid in the reference too) |
| `@` decorators | ❌ (see "Remaining divergences") |
| `import`/`export` (file modules) | ❌ not parsed: a project arrives as a flat `bundle` from the host (see ["Modules and bundle"](#modules-and-bundle)) |

**Float without IEEE754 bits.** A literal is assembled as f64 arithmetic
(`mant / 10^k * 10^exp`, i32→f64 via `f64.convert_i32_s`) — the compiler does not need
a 64-bit mantissa in i32 code. Literals with an integer value (`2.0`, `1e3`) collapse
into int, as in the reference.

**Selfhost is a superset of the reference with respect to float.** Live checks:
`int(2.5 * 2.0)`, `int(sqrt(16.0))`, `let x: float = 2.5`, `str(2.5)`,
`let x = 1e-3; x * 1000.0`, the mixed `2 < 2.5` / `1 + 0.5` all produce **valid WASM
and the correct result** in selfhost, whereas `latentc` fails with invalid WASM or a
type error.

## Host constructs: what selfhost actually does

Selfhost reproduces the **observable behavior of the reference**, not a hypothetical
semantics:

- `spawn { ... }` / `spawn expr;` — the bodies are executed **sequentially** in the
  current function; a `return` inside `spawn` returns from the enclosing function; the
  result of the expression form is discarded (`DROP`).
- `yield;` — a no-op (`;` is mandatory, as in the reference parser).
- `async fn` — the `is_async` flag does not affect the signature/code; no Promise is
  materialized.
- `await expr` — a transparent unwrapping: the value of the operand as is.
- `select { case v <- ch: … }` — the channel expressions are **not compiled** (they are
  emitted and then rolled back), `v` is bound to `0`, and the body of the **first** arm
  runs; `default` only when there are no arms; an empty `select` in expression position
  yields `0`.
- `test "name" { … }` — at top level it is parsed and **not emitted** (there is no
  runner); inside a function the body executes as an ordinary block.
- `channel()`, `channel<T>()`, `tensor(…)`, `ai_*`, `ch <- v`, `<-ch`,
  `ch.send`/`ch.recv`, unknown methods — a **codegen error** naming the construct:
  `error: builtin 'channel' requires host runtime (engine #2)`,
  `error: channel operations require host runtime (engine #1)`,
  `error: AI primitives require host runtime (engine #1)`.

## The compilation pass

`selfhost/src/90_driver.lat` (`compile_program`):

1. `alloc(4600000)` — guarantee memory growth for all regions;
2. `binit(...)` — zero the buffers (OUTB, SCRB, FNB, CODEB, BODYC, DATAB) and the state
   slots (status, class/variant/lambda counters);
3. `tokenize()` — the parallel arrays `KIND`, `TVAL`, `TLEN`; the terminator is
   kind 0;
4. `scan_classes()`, `scan_enums()`, `scan_signatures()`, `scan_lambdas()`,
   `register_lambdas()` — first-pass tables;
5. `tc_program()` — the type check; on error the text is written to `ERRB`/`OUTB` and
   `-len` is returned;
6. `compile_fn(i)` for each function, `compile_lambda(li)`;
7. `helper_bodies()` — 8 runtime helpers;
8. if codegen has set `status` — return `-len` with the error text;
9. `build_module()` — the WASM sections;
10. return `blen(OUTB())` — the module length.

### Memory budget

The compiler runs in its own linear memory and **reserves 4 600 000 bytes**
(`alloc(4600000)` at the start of `compile_program`) — that is enough for all regions of
the map:

| Region | Address | Size |
|---|---:|---:|
| `INPUT` — input | 3 145 728 | 128K |
| `OUTB` — output WASM | 65 536 | 192K |
| `SCRB` — section scratch | 262 144 | 192K |
| `FNB` — body of the current function | 458 752 | 192K |
| `BODYC` — final body | 655 360 | 192K |
| `CODEB` — all bodies | 851 968 | 384K |
| `KIND`/`TVAL`/`TLEN` — tokens | 1 245 184 … | 256K each |
| function/local tables | 2 031 616 … | 32K each |
| `ST` — state slots | 2 260 992 | 256 |
| `CODEOF`/`CODELN` — bodies | 2 261 248 / 2 293 760 | 32K |
| `DATAB` — data/strings | 2 326 528 | 256K |
| `STRO`/`STRL`/`STRA` — strings | 2 588 672 … | 128K each |
| type stack, float constants, parameter types | 2 981 888 … 3 112 960 | 32K each |
| class/method/enum/lambda tables | 3 407 872 … 4 308 992 | — |
| type checker tables, `ERRB` | 4 313 088 … 4 547 072 | — |

Consequences:

- the **host must** grow memory to `INPUT_ADDR + 4 + len` before writing the source —
  otherwise the write goes beyond the pages and is lost;
- the topmost used region is `ERRB` (4 547 072 + 4K), which is below the 4 600 000
  reserve, so `alloc` is guaranteed to cover the map;
- the **output module** of the compiler has **16 pages** of memory (1 MiB), without
  `max`; the `heap` global is `1024 + len(DATAB)`, and growth goes through the `alloc`
  helper.

State slots: `0=PC 1=NT 2=NF 3=NL 4=status 5=produces 6=NS(strings)
7=TS`; access through `get(st, k)`/`set(st, k, v)` = `load32/store32`.

### Output module

`70c_module_sections.lat` assembles the module in the same way as the Rust codegen, but
with fixed types (value conversions are in `70b_module_convert.lat`):

- type section: 20 types — `(i32)->void` (idx0), `(i32×arity)->i32` (idx1..9),
  `(i32×arity)->f64` (idx10..18), `(f64)->i32` (idx19, for `f64_to_str`);
- one imported function `env.print (i32)->void` (index 0);
- 8 runtime helpers: `alloc`, `memcopy`, `str_concat`, `str_eq`,
  `str_char_at`, `i32_to_str`, `str_to_i32`, `f64_to_str`;
- memory: **16 pages**, without max;
- the `heap` global = `1024 + len(DATAB)` (the start value after the data);
- exports: `memory` and `main` (index `find_main()+1`);
- table/element sections — only if there are lambdas; slot = function index;
- data: string literals `[len u32][utf8]`.

## Remaining divergences from the reference (deliberate)

The parity matrix is 64/65; the divergences below are recorded deliberately:

1. **float literals/expressions** — selfhost accepts and correctly executes what
   `latentc` compiles into invalid WASM or rejects on types.
2. **`fn f() -> unit { return; }`** — the oracle produces invalid WASM, selfhost a valid
   module.
3. **`await` on a non-Promise** — the oracle requires `Promise<T>` and fails on types;
   selfhost is transparent.
4. **`@` decorators** — the selfhost lexer does not single out `@`: `@forall("x") fn f()`
   yields `undefined function: forall`, while `@test("t") fn f()` compiles `f`.
   Decorators are not used in `shc.lat` or in the tests.
5. **`unit` return and float parameters** — see items 1–2.
6. **Arity of builtins** — the oracle sometimes silently ignores extra/missing
   arguments; selfhost is stricter (`error: compilation failed`).
7. **Soft keywords** — `spawn`/`yield`/`async`/`await`/`select`/`test`/
   `null` are full keywords in selfhost; `fn test()` or
   `let spawn = 1` do not compile (the oracle partially allows them).
8. **Precision of float literals with a long mantissa** — the mantissa is parsed into
   i32, so more than ~9 significant digits or extreme exponents may differ.
9. **Invalid WASM caused by the language itself** (`x = 2.5` for `let x = 1`,
   `a[0] = 1.5`) — selfhost, like the oracle, does not diagnose these holes in the type
   system; some of them (for example `5.5 % 2.0`) produce an honest error.
10. **Types method results more precisely**: the oracle loses the string static type of
    a method result, selfhost tracks `T_STR`.

## Tests

```bash
node --test "selfhost/test/*.test.mjs"
```

173 tests in 19 suites (coverage: **100% functions / 97.94% lines**,
`node tooling/selfhost-coverage/run.mjs --lines --min 90`):

- `bootstrap.test.mjs` — the validity of stage1/2/3 and the fixed point (Rust path);
- `bootstrap-wasm.test.mjs` — the Rust-free bootstrap: `seed → stage-sh-1 →
  stage-sh-2 → stage-sh-3`, `stage-sh-2 === stage-sh-3`, `stage-sh-1 === seed`,
  `seed.json` consistency (sha256/size/source), the CLI
  `compile/check/run/version` (hello, classes, enum, match, float), error text,
  `--refresh-seed` and `--dry-run` with no file writes;
- `lexer.test.mjs` — atomic `tokenize` checks by token category;
- `scoping.test.mjs` — the scope of locals (`find_local`);
- `features.test.mjs` — differential tests of oracle (Rust) vs stage1 vs stage2;
- `coverage.test.mjs` — differential coverage of constructs from `shc.lat`;
- `float-arithmetic.test.mjs` — float arithmetic (`-`, `/`, `<=`, `>=`) on
  expressions where the oracle emits invalid WASM; the test is selfhost-only;
- `parity.test.mjs` — 56 parity cases: spawn/yield/async-await/select/test,
  match over strings, to_str/to_int, top-level let, host errors
  (channel/tensor/ai_*/channels/methods), print, null, string parameters,
  `float("…")`, exponential literals, escape strings, nested comments; for error cases
  the stage1/stage2 texts must match;
- `modules.test.mjs` — the differential modules test: `latentc bundle` → the
  flat-source property, `compile(bundle) == compile_files` (Rust), selfhost
  compiles the bundle and returns the same `main()`, project errors are caught by
  the host, and selfhost rejects raw module source
  (`selfhost/test/fixtures/modules/`);
- `build.test.mjs` — determinism and idempotence of the part assembler.

The parity matrix (outside `selfhost/`, in the agent's working folder):

```bash
node latent-work/gap-matrix.mjs [--verbose]
```

## Memory primitives

For self-hosting, built-in linear memory functions were added to the Rust compiler
(`latentc`): `alloc`, `load8`, `store8`, `load32`, `store32`, `memcopy`
(`src/codegen/emit_call/direct.rs`, `compile_memory_builtin`; registration in
`emit_call/mod.rs`). `10_buffer.lat` is written on top of them (LEB128, byte buffers,
`bcopy`). They are exactly what lets the Latent-on-Latent compiler write WASM bytes, and
they **are present in the shipped `web-ide/compiler.wasm`**.

> String literals in memory are `[len u32][utf8]`, so the bytes of a literal are read at
> offset `+4` after `memcopy`, not through `s + 4`.

## Related sections

- [Parity matrix](./parity-matrix.md) — who can do what.
- [Web IDE engines](./engines.md) — how selfhost relates to engines #1/#2.
- [Codegen internals](./internals-codegen.md) — the reference implementation of the same
  ABI.
- [tooling/bootstrap](../tooling/bootstrap.md) — rebuilding and running the tests.
