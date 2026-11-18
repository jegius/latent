---
title: "Two Web IDE Engines"
description: "How engine #1 (the JS tree-walking interpreter) and engine #2 (Rust→WASM) are built and how the web IDE picks between them: capabilities, loading, the status bar, limitations."
sidebar_position: 3
---

# The two engines of the web IDE

The browser IDE (`web-ide/`) contains **two implementations** of the language.
Understanding which one is running is critical: they behave differently.

| | Engine #1 | Engine #2 |
|---|---|---|
| What it is | a tree-walking interpreter in JS | the Rust Latent → WASM compiler |
| Where | `web-ide/compiler/` | `web-ide/compiler.wasm` (a build of `src/`) |
| What it does | **executes** the program | **compiles** it to WASM (does not execute) |
| Loaded | always (ES modules) | lazily, by button/tab |
| Errors | JS exceptions (English) | Russian compiler texts |
| Host features (AI, channels, tensors, contracts) | ✅ full semantics | ❌ a "requires host runtime" error |
| Role in the playground | executes **any** program | compiles the host-free subset; auto fallback |

## Engine #1: the JS interpreter

The pipeline (`web-ide/compiler/run.js`):

1. `tokenize(source)` — `compiler/lexer.js`;
2. `new Parser(tokens).parseProgram()` — `compiler/parser*.js`;
3. `new Interpreter(program, output).run()` — `compiler/interpreter*.js`.

Specifics:

- **No type checker**: type annotations are parsed and discarded.
- `main` is mandatory (`Function 'main' not found`) and is called without arguments.
- After `main` all scheduler goroutines are awaited (`runScheduler`); if tasks remain,
  the error `Deadlock: ...` is reported.
- Then the `test` blocks run (`runTests`); the results are stored in
  `interpreter.testResults` and printed to the console as
  `test "<name>": ok` / `test "<name>": FAILED — <reason>`.
- Protection against hangs: a loop iteration limit (1 000 000) and a scheduler limit
  (10 000 000).
- The "bytecode" of engine #1 (`compiler/loader.js`) is simply the UTF-8 bytes of the
  source; the WASM tab shows their hex.
- AI functions are enabled with "Run with AI" (`interpreter.enableAI()`) and
  automatically in a normal Run when the program contains `ai_*` primitives
  (the mock is used, with no network access). A direct call to
  `runLatent(source, false)` for an AI program still throws
  `AI is not enabled. Use "Compile & Run with AI" button.`

The composition by area of responsibility: `lexer.js`, `parser-*.js`, `interpreter*.js`,
`value-utils.js`, `oop.js`, `environment.js` (channels, promise-like
values), `ai-config.js`, `ai-gateway.js`, `repair.js`, `analysis.js`,
`wasm-loader.js`, `loader.js`, `run.js`.

## Engine #2: the Rust compiler in WASM

- Loader: `web-ide/compiler/wasm-loader.js`.
- Caching: the Cache API, the cache name `latent-compiler-v1`, the URL `compiler.wasm`
  (`opts.url` can be passed).
- Instantiation: `WebAssembly.instantiate(bytes, imports)` (not
  `instantiateStreaming` — dev servers often serve the wrong MIME type).
- ABI: `latent_alloc(src_len)` → write the source into memory →
  `latent_compile(ptr, len)` → `[status][len][payload]`
  ([C-ABI](../reference/wasm-abi.md#compiler-c-abi-engine-2-in-the-browser)).
- If `compiler.wasm` is unavailable/does not contain the ABI, the loader returns
  `null` and the IDE keeps working on engine #1 (graceful degradation).
- Engine #2 **does not execute** the compiled WASM: it only compiles and returns the
  bytes for display/download.
- The shipped artifact is up to date: `web-ide/compiler.wasm` (465 435 bytes,
  `latent 0.1.0`) is built from the current `src/` and includes the memory builtins
  (`alloc`/`load8`/`store8`/`load32`/`store32`/`memcopy`), `spawn`/`yield`/
  `async`/`await`/`select`, `test` blocks, and the current fixes. To rebuild, see
  [bootstrap](../tooling/bootstrap.md).

## Automatic engine selection and fallback

The playground does not make the user think about engines: **Run always provides the
full language functionality**, and engine #2 is used only where it can work.

1. `CompilerService.compileForRun(source)` calls `detectHostFeatures(source)`
   (`web-ide/compiler/host-features.js`).
2. If there are no host features and engine #2 is loaded, it produces the bytecode for
   the WASM tab.
3. If there are host features (channels, `<-`, `spawn`, `select`, `yield`, AI, tensors,
   `test`/contracts), the bytecode comes from engine #1 and execution runs there.
4. If engine #2 unexpectedly returns an error (including "requires host runtime"), the
   service **falls back to engine #1** and adds an explanation; the #2 error never
   becomes the final Run error.
5. After a Run the status bar shows `engine #1 (host runtime)`.

AI specifics: a normal Run of a program with `ai_infer`/`ai_embed`/`ai_stream`
automatically enables AI mode in **mock mode** (no network or key). The real gateway
and self-repair are available through **Run with AI**.

## How the engine is chosen

| Action | What is used |
|---|---|
| `Run` / `Compile & Run` (`Ctrl/⌘+Enter`) | **engine #1** executes the program; host features → #1, host-free programs are additionally compiled by #2 for the WASM tab |
| `Run with AI` (`Ctrl/⌘+Shift+Enter`) | engine #1 with the AI gateway + self-repair (up to 3 attempts) |
| `Check` | engine #1: `checkSyntax` (tokenization + parsing) |
| The `Engine #2` button | an explicit choice: lazily loads #2 and compiles the current code; for a host-dependent program it shows an explanation and a **Run in engine #1** button |
| The `WASM` tab | triggers loading of engine #2 on first open; Run does not switch engines because of it |
| The status bar (`status-engine`) | `engine #1 (host runtime)` after Run, or `engine #2 (rust→wasm)` after an explicit compilation |

An important consequence: **"Run" always executes engine #1**, even if engine #2 is
loaded, and never shows a #2 error as final. To see the Rust compiler diagnostics,
press `Engine #2` (or open the WASM tab): for a host program you get an explanation
and an offer to run it in engine #1.

The code-centric behavior of `CompilerService`
(`web-ide/services/compiler-service.js`):

- `compile(source)` — explicit compilation: if `wasmCompiler` is loaded, compiles with
  it, otherwise returns the "bytecode" of engine #1;
- `compileForRun(source)` — automatic selection: host features and #2 errors fall back
  to #1; the result contains `compileEngine`, `hostFeatures`, `fallback`;
- `compileAndRun(source)` — `compileForRun()` + `runLatent()` (engine #1) — therefore
  execution is always #1; the result contains `engineLabel`, `notes`;
- `compileWithEngine2(source)` — explicit #2 compilation without fallback (for the
  `Engine #2` button), so the diagnostics can be shown and #1 offered;
- `ensureWasmCompiler()` — a one-time lazy load with an attempt cache;
- `hasWasmCompiler()` — for the status bar.

## Feature support (verified)

| Feature | #1 | #2 |
|---|---|---|
| `let`, `if/else`, `while`, `for`, `for-in` | ✅ | ✅ |
| functions, recursion, closures | ✅ | ✅ |
| arrays, indexing, `push`/`pop`/`length`, `len` | ✅ | ✅ |
| strings, `+`, `==`, `s[i]`, `.length` | ✅ | ✅ |
| classes/`new`/`this`/methods | ✅ | ✅ (a method only on a class variable) |
| `enum`/`match` | ❌ no enum | ✅ (float payload ⚠️) |
| `async`/`await` | ✅ | ✅ (`await` is a passthrough) |
| `channel`, `<-`, `select` waiting, `yield` | ✅ full scheduler | ⚠️ surrogates only; `channel`/`<-` — a host error |
| `tensor`, `semantic`, `matmul`, AI, contracts | ✅ | ❌ host (Run falls back to #1) |
| bitwise operators | ❌ lexer | ✅ |
| `str`/`int`/`float`/`sqrt` | ❌ | ✅ |
| `alloc`/`load8`/`store8`/`load32`/`store32`/`memcopy` | ❌ | ✅ |
| `assert`/`assert_eq` | ✅ | ✅ (a trap) |
| `test` blocks | ✅ are executed | ⚠️ compile, are not executed |

## Semantic divergences between the Rust compiler and the JS engine

Verified by running both engines on identical fragments. This is the key table for
anyone moving code between the engines.

| Construct | Rust (WASM) | JS (engine #1) | Verdict |
|---|---|---|---|
| `7 / 2` | `3` (`i32.div_s`) | `3.5` (always float) | divergence |
| `"привет".length` | `12` (UTF-8 bytes) | `6` (UTF-16 code units) | divergence |
| `"abc"[1]` | `98` (a byte) | `"b"` (a character) | divergence |
| `[1] == [1]` | `0` (pointers) | `1` (structural) | divergence |
| `let a=[1]; a == a` | `1` | `1` | matches |
| `assert_eq("a"+"b", "ab")` | ok (content) | ok (structural) | matches |
| `assert_eq([1], [1])` | trap | ok | divergence |
| `print(true)` | `1` | `true` | divergence |
| `print(null)` | `0` | `null` | divergence |
| `print([1,2])` | `1024` (a pointer) | `[1, 2]` | divergence |
| `print(1.5)` | `1.500000` | `1.5` | divergence |
| `print("a", 1)` | two lines: `a`, `1` | one line: `a 1` | divergence |
| `let x = 1 return x` (no `;`) | a parse error | ok (ASI-like) | divergence |
| `1e3` | `1000.0` | `1` (then the identifier `e3`) | divergence |
| `1.2.3` | a parse error | `1.2` (the lexer consumes it as a number) | divergence |
| `"a\q"` | an escape error | `"aq"` | divergence |
| `enum E { A, B }` | ok | error (`Unexpected token '{'`) | Rust-only |
| `1 << 3`, `7 & 3` | ok | a lexer error | Rust-only |
| `/* … */` | ok (nested) | an error | Rust-only |
| `for (let c in "abc")` | a type error | 3 iterations | JS-only |
| `match` with void arms | invalid WASM | ok | JS-only |
| `match b { case true: … }` | a parse error | ok | JS-only |
| `match 1 { case 1: { … } }` (a block arm) | an error | ok (`BlockExpr`) | JS-only |
| `match 1 { case 1: 10 default: 0 }` (no comma) | an error | ok | JS-only |
| class: a method without `fn`, a field without `;` | an error | ok | JS-only |
| a nested `fn` | `Unknown function` | works | JS-only |
| `spawn x + 1` | compiles: the expression is evaluated inline | a parse error | divergence |
| `spawn w()` | an inline call | a goroutine | divergence |
| `select` | the body of the 1st arm | a blocking choice of a ready channel | divergence |
| `yield` | a no-op | yields to the scheduler | divergence |
| `await` on a non-Promise | a type error | identity | divergence |
| `async fn` | an ordinary function | `resolvedPromise` | divergence |
| a duplicate `fn f` | compiles silently | the second overwrites the first | matches in effect |
| a top-level `let` | does not compile | `Undefined variable` | matches (both do not work) |
| `@forall`/`@ai_contract` over `fn` | the decorator target is not registered → `Unknown function` on a call | works (the decorator is ignored) | divergence |
| `test` at top level | is not executed | is executed | divergence |
| `ai_generate!("p")` | a codegen error | `Undefined variable 'ai_generate'` | both do not work |
| `semantic("x")[0]` | a host runtime error | a vector value | JS-only |

## What happens on errors

- Engine #1: the exception is caught in `handleCompile`; the console shows
  `Error: <message>`, and the WASM tab shows `Compilation failed: ...`.
- Engine #2 (the Engine #2 button): for a host program an explanation is shown
  (`Engine #2 … only the subset without host features`) together with a **Run in
  engine #1** button; for other errors — `Engine #2 error:\n<text>`.
  In a normal Run a #2 error is not final: the service falls back to #1 and writes an
  `[engine] …` explanation, while the status stays `engine #1 (host runtime)`.
- Self-repair (only with "Run with AI"): on an engine #1 error the model or the
  deterministic repair tries to fix the source (up to 3 attempts); on success the editor
  is updated and the console shows `[Self-repair] Fixed after N attempt(s)`.
  The deterministic repair can: insert a missing `;` before `}` using the line number
  from the diagnostic, and append unbalanced `}`.

## Limitations and pitfalls

- `web-ide/compiler.wasm` is built from the current `src/` (465 435 bytes): it does
  contain the memory builtins and the host constructs. The only known "old" copy is in
  the resources of the IDEA plugin
  (`editors/idea/src/main/resources/runner/compiler.wasm`), which does not contain the
  memory builtins (see [IDEA](../tooling/idea.md)).
- Engine #2 does not execute code: "Run" will not verify the behavior of the WASM.
- Engine #1 does not support `enum`, so examples with `enum` will not run in the IDE
  (they are only compiled by engine #2).
- The input encoding is UTF-8; the output of `env.print` is a `[len][utf8]` string.
- `async`/`await`/`spawn`/`yield`/`select` in #2 compile into a surrogate
  (`await` — a passthrough, `spawn` — sequentially, `yield` — a no-op,
  `select` — the first arm), while `channel` and host AI produce an error with the text
  "requires host runtime". The playground does not use these surrogates for Run: when
  the corresponding constructs are detected, it executes the program in #1.
- The #2 limitation is not a playground limitation: Run automatically selects #1 for
  host features and on #2 compilation errors.

## Related sections

- [Web IDE](../tooling/web-ide.md) — the capabilities of the interface.
- [AI runtime](./ai-runtime.md) — the host functions of engine #1.
- [Parity matrix](./parity-matrix.md) — a line-by-line comparison.
- [WASM ABI](../reference/wasm-abi.md) — the module contract.
