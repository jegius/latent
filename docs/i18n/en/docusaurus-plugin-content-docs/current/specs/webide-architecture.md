# Architecture of the Latent Web IDE

Status: current for the `part10-toolchain` branch. This document describes the browser
IDE (`web-ide/`): both execution engines, the application layers, the program execution
flow, the SOLID decisions taken, the decomposition, and the test coverage.

## 1. Purpose and boundaries

The web IDE is a static application without a build step: `index.html` loads a single ES
module `main.js`, and all other files are ordinary ES modules that the browser loads by
relative paths. The whole directory is copied into `docs/static/playground/` by the
`scripts/sync-playground.mjs` script (excluding `test/`, `README.md`,
`node_modules`), so every module must remain a valid ES module without a bundler.

There are no external dependencies: only browser APIs (`canvas`, `localStorage`,
`fetch`, `WebAssembly`, `Cache API`, `btoa/atob`), and in the Node tests —
`node:test`, `node:fs`, and global stubs.

## 2. Two engines

| | Engine #1 | Engine #2 |
|---|---|---|
| What it is | a tree-walking interpreter in JS | a real compiler of Latent (Rust) → WebAssembly |
| Where | `compiler/` | `compiler.wasm` (a copy of `latent.wasm`), the loader is `compiler/wasm-loader.js` |
| When it is used | always available; the Run/Check button, the AI mode | lazily: the Engine #2 button, the WASM tab, `CompilerService.ensureWasmCompiler()` |
| Result | the value of `main()` + the `print` output + code analysis | the `.wasm` bytecode for the WASM tab/integration |
| Language coverage | full semantics (channels, tensors, AI, contracts, self-repair) | a "clean" subset; host features produce an explicit error |
| Fault tolerance | — | if `compiler.wasm` is unavailable, the IDE stays on engine #1 (graceful) |

Engine #2 is loaded through the Cache API (when available) with a fallback to a bare
`fetch`, instantiated with `WebAssembly.instantiate`, and works over the ABI
`latent_alloc` / `latent_compile` / `latent_free` / `latent_version` (see
`compiler/wasm-loader.js`). The response format is `[status u32][len u32][payload]`.

## 3. Module map

### 3.1 The root of `web-ide/`

| File | Responsibility |
|---|---|
| `index.html` | the markup: menubar, toolbar, workbench, status bar, a hidden `textarea` |
| `styles.css` | the theme entry point (`@import styles/index.css`) |
| `main.js` | the entry point and the IDE controller: wires views/services/controllers, the menu, and keyboard shortcuts |
| `compiler-loader.js` | a **thin barrel facade** of the compiler's public API (25 lines, re-exports only) |
| `examples.js` | a **thin barrel facade** of the asynchronous examples API (16 lines) |
| `hot-reload.js` | a debouncer for auto-restart (not hot swap, but auto-run) |

### 3.2 The engine layer `compiler/` (engine #1 + AI + engine #2)

| Area | Modules | Responsibility |
|---|---|---|
| Lexics | `token.js`, `lexer.js` | token types, keywords/soft keywords, tokenization |
| Parsing | `parser-core.js`, `parser-declarations.js`, `parser-statements.js`, `parser-expressions.js`, `parser-match.js`, `parser-concurrency.js`, `parser.js` | recursive descent by grammar area; `Parser` is assembled from mixins, and `parser.js` is only the composition |
| Runtime primitives | `environment.js`, `oop.js`, `value-utils.js` | the variable environment, `ReturnSignal`, channels, class instances, tensors, deep-equal, formatting, `matmul`, the method dispatcher |
| Execution | `interpreter.js`, `interpreter-statements.js`, `interpreter-expressions.js`, `interpreter-builtins.js`, `interpreter-ai.js` | the goroutine scheduler, function/method calls, statements, expressions, the builtin table, deterministic AI mocks |
| AI | `ai-config.js`, `ai-gateway.js`, `repair.js`, `run.js` | configuration and the persistent inference cache, the HTTP gateway (ollama / openai-compatible), self-repair, pre-fetch + program launch |
| Analysis | `analysis.js` | metrics and complexity estimation for the AI Insights tab |
| Modules | `modules.js`, `modules-link.js`, `modules-manifest.js`, `modules-rewrite.js`, `parser-modules.js` | path canonicalization and the DFS import graph, two-phase linking with `mN# Architecture of the Latent Web IDE

Status: current for the `part10-toolchain` branch. This document describes the browser
IDE (`web-ide/`): both execution engines, the application layers, the program execution
flow, the SOLID decisions taken, the decomposition, and the test coverage.

## 1. Purpose and boundaries

The web IDE is a static application without a build step: `index.html` loads a single ES
module `main.js`, and all other files are ordinary ES modules that the browser loads by
relative paths. The whole directory is copied into `docs/static/playground/` by the
`scripts/sync-playground.mjs` script (excluding `test/`, `README.md`,
`node_modules`), so every module must remain a valid ES module without a bundler.

There are no external dependencies: only browser APIs (`canvas`, `localStorage`,
`fetch`, `WebAssembly`, `Cache API`, `btoa/atob`), and in the Node tests —
`node:test`, `node:fs`, and global stubs.

## 2. Two engines

| | Engine #1 | Engine #2 |
|---|---|---|
| What it is | a tree-walking interpreter in JS | a real compiler of Latent (Rust) → WebAssembly |
| Where | `compiler/` | `compiler.wasm` (a copy of `latent.wasm`), the loader is `compiler/wasm-loader.js` |
| When it is used | always available; the Run/Check button, the AI mode | lazily: the Engine #2 button, the WASM tab, `CompilerService.ensureWasmCompiler()` |
| Result | the value of `main()` + the `print` output + code analysis | the `.wasm` bytecode for the WASM tab/integration |
| Language coverage | full semantics (channels, tensors, AI, contracts, self-repair) | a "clean" subset; host features produce an explicit error |
| Fault tolerance | — | if `compiler.wasm` is unavailable, the IDE stays on engine #1 (graceful) |

Engine #2 is loaded through the Cache API (when available) with a fallback to a bare
`fetch`, instantiated with `WebAssembly.instantiate`, and works over the ABI
`latent_alloc` / `latent_compile` / `latent_free` / `latent_version` (see
`compiler/wasm-loader.js`). The response format is `[status u32][len u32][payload]`.

## 3. Module map

### 3.1 The root of `web-ide/`

| File | Responsibility |
|---|---|
| `index.html` | the markup: menubar, toolbar, workbench, status bar, a hidden `textarea` |
| `styles.css` | the theme entry point (`@import styles/index.css`) |
| `main.js` | the entry point and the IDE controller: wires views/services/controllers, the menu, and keyboard shortcuts |
| `compiler-loader.js` | a **thin barrel facade** of the compiler's public API (25 lines, re-exports only) |
| `examples.js` | a **thin barrel facade** of the asynchronous examples API (16 lines) |
| `hot-reload.js` | a debouncer for auto-restart (not hot swap, but auto-run) |

### 3.2 The engine layer `compiler/` (engine #1 + AI + engine #2)

| Area | Modules | Responsibility |
|---|---|---|
| Lexics | `token.js`, `lexer.js` | token types, keywords/soft keywords, tokenization |
| Parsing | `parser-core.js`, `parser-declarations.js`, `parser-statements.js`, `parser-expressions.js`, `parser-match.js`, `parser-concurrency.js`, `parser.js` | recursive descent by grammar area; `Parser` is assembled from mixins, and `parser.js` is only the composition |
| Runtime primitives | `environment.js`, `oop.js`, `value-utils.js` | the variable environment, `ReturnSignal`, channels, class instances, tensors, deep-equal, formatting, `matmul`, the method dispatcher |
| Execution | `interpreter.js`, `interpreter-statements.js`, `interpreter-expressions.js`, `interpreter-builtins.js`, `interpreter-ai.js` | the goroutine scheduler, function/method calls, statements, expressions, the builtin table, deterministic AI mocks |
| AI | `ai-config.js`, `ai-gateway.js`, `repair.js`, `run.js` | configuration and the persistent inference cache, the HTTP gateway (ollama / openai-compatible), self-repair, pre-fetch + program launch |
 mangling, the `LPF1` manifest and project hash, AST rewriting, the `import`/`export` and `enum` grammar |
| Engine #2 | `wasm-loader.js`, `loader.js` | lazy loading/the ABI of the WASM compiler; the public API of engine #1 (`compile`/`checkSyntax`/`getVersion`) |
| Public API | `index.js` | the aggregator; `compiler-loader.js` is its browser facade |

### 3.3 The service layer `services/` (business logic, no DOM)

| Module | Responsibility |
|---|---|
| `compiler-service.js` | compilation/run, the self-repair loop, formatting of the result and of the bytecode hex dump, lazy loading of engine #2 |
| `compiler-service-project.js` | multi-file projects: project-input normalization, engine selection, linking (engine #1) and the `LPF1` manifest (engine #2), cache by the project hash |
| `ai-settings-service.js` | loading/saving the AI settings in `localStorage`, applying them to `AIConfig`, testing the connection |
| `workspace-service.js` | the model of `.lat` files (create/rename/delete/the active file), persistence |
| `share-service.js` | code in a base64 URL hash (UTF-8 safe) and in `localStorage` |
| `formatter-service.js` | a pure formatting function: indentation and spaces (strings/comments are left untouched) |

### 3.4 The view layer `views/` (DOM only)

| Module | Responsibility |
|---|---|
| `canvas-editor.js` | a barrel facade of the canvas editor (4 lines) |
| `editor/index.js` | the composition of the editor submodules, the public `CanvasEditor` class, synchronization of the textarea ↔ the model |
| `editor/editor-theme.js` | the Darcula palette and the lexical sets for highlighting |
| `editor/editor-metrics.js` | position ↔ (line, col), the scroll maxima, auto-scroll (pure functions) |
| `editor/editor-renderer.js` | rendering of text, the gutter, the caret, the selection, and the scrollbars |
| `editor/line-tokenizer.js` | line-by-line tokenization for highlighting (a pure function) |
| `editor/editor-input.js` | the hidden `textarea`, IME/undo, Enter auto-indent, Tab, bracket pairs |
| `editor/editor-pointer.js` | the wheel, the scrollbar (drag/track), clicks, and caret positioning |
| `editor/editor-navigation.js` | the arrow keys, Backspace/Delete/Enter/Tab, and input on top of the `ed.code` model |
| `output-view.js` | the Output/WASM/AI Insights tabs, the status bar |
| `toolbar-view.js` | binding of the toolbar buttons |
| `menubar-view.js` | the File/Edit/View/Run/AI/Help menu |
| `file-tree-view.js` | the file tree and the `examples/` folder |
| `ai-settings-view.js` | the AI Gateway settings panel |
| `modal-view.js` | portal modal windows instead of `confirm/prompt/alert` |

### 3.5 The controller layer `controllers/` (prototype mixins)

| Module | Responsibility |
|---|---|
| `command-controller.js` | Run/Check/WASM/Share/Example/Save/Format/About |
| `file-controller.js` | the file tree, tabs, the status bar, create/delete/rename |
| `ai-settings-controller.js` | binding `AISettingsView` ↔ `AISettingsService`, testing the connection |

Controllers are mixin objects folded into `LatentIDEController.prototype` in `main.js`;
this is the only place where all three layers meet.

### 3.6 Auxiliary directories

| Directory | Contents |
|---|---|
| `examples/` | real `.lat` files (the single source of truth), `manifest.js` (metadata), `loader.js` (fetch in the browser / fs in Node), `index.js` |
| `styles/` | base, menubar, toolbar, panels, editor, output, statusbar, responsive, modal, ai-settings; the entry point is `index.css` |
| `scripts/` | `check-structure.mjs` — the structural audit (see §6) |
| `test/` | 27 `node:test` files, 414 tests, covering all layers except the DOM wiring (see §7) |

### 3.7 Dependency direction

```
main.js ──► controllers/ ──► services/ ──► compiler-loader.js ──► compiler/
   │            │                │                                    ▲
   └──────────► views/ ──────────┴──────────── examples.js ──► examples/
                  └── editor/ (pure: theme, metrics, line-tokenizer)
```

The rules: `views/` does not know about `services/`; `services/` does not know about the
DOM; the controllers know about both layers, and only they do; `compiler/` does not import
`services/` or `views/`; there are no circular imports (`compiler/index.js` is the single
aggregation point of the public API, and `compiler-loader.js` is its facade for the other
layers).

## 4. Program execution flow

### 4.1 Launch (engine #1), the Run button / `Ctrl+Enter`

1. `commandController.handleCompile(withAI)` takes the code from `editor.getCode()`.
2. `CompilerService.compileAndRun(source, withAI)`:
   - `compile()` — the "engine #1" bytecode (`TextEncoder`, if engine #2 is not loaded);
   - `runLatent(source, withAI)`:
     - `tokenize` → `Parser.parseProgram()` → the AST (`functions`/`classes`/`tests`);
     - with `withAI` and a real provider — pre-fetch: `collectAIPrompts` finds literal
       `ai_infer` prompts, and the answers are taken from `persistentAICache`
       (the key `provider::model::prompt`) or from the gateway; network errors are not
       cached;
     - `new Interpreter(program, output).run()` — a `main` call, then a run of the
       goroutine scheduler (a deadlock → an error), then the `test` blocks;
   - `analyzeCode(source)` — metrics for AI Insights.
3. The controller prints `logs` and `Result`, enables self-repair on an error
   (`compileAndRunWithRepair`, up to 3 attempts), and refreshes the WASM/AST tabs and the
   status.

### 4.2 Self-repair

`CompilerService.compileAndRunWithRepair` catches a compilation/execution error and calls
`repairCode(source, diagnostic, withAI)`:

- with a real gateway — a model request and `extractCode` (which strips ``` fences);
- with a mock provider/a gateway error — `deterministicRepair` (inserting `;` using the
  line number from the diagnostic, appending the missing `}`);
- `null` — repair is impossible, and the original error is rethrown; exhausting the
  attempts produces `Self-repair failed after N attempts`.

### 4.3 Engine #2 (WASM)

1. `CompilerService.ensureWasmCompiler()` → `loadWasmCompiler()` (once).
2. `loadWasmCompiler`: the Cache API (`caches.open` → `match`/`put`) or `fetch`;
   `WebAssembly.instantiate`; with the `latent_compile` ABI — a call through
   `latent_alloc` and reading `[status][len][payload]`, otherwise the compatible
   `compile(source)` contract (a string or `alloc`+`ptr,len`).
3. A compilation error → an exception with the diagnostic text; an unavailable/foreign
   module → `null` (the IDE stays on engine #1). `version()` is taken from
   `latent_version`, if it is exported.

Additionally `wasm-loader` detects `supportsModules` (whether the build exports
`latent_compile_files`) and exposes `compileFiles(manifest)`.

### 4.4 Multi-file project (modules)

The entry point is `CompilerService.compileForRunProject(files, entry)` from
`services/compiler-service-project.js`; the active workspace file is treated as
the entry.

1. `normalizeProjectInput` reduces the input to `{files: [{name, code}], entry}`
   and validates that the entry is present.
2. `projectUsesModules` decides whether the module path is needed: more than one
   file, or an `import` in some file.
3. **Engine #2** (if the ABI is present): `buildModuleManifest` sorts the files by
   path, `encodeModuleManifest` builds `LPF1`, and `wasm.compileFiles(bytes)`
   returns the bytecode; the result is cached by `projectHash` (paths + content +
   entry, limit 32).
4. **Engine #1**: `linkModuleProject(files, entry)` — DFS graph, symbol tables,
   mangling, a rewritten AST; the interpreter runs the already linked program
   (`runLatentProject`). The link cache is keyed by the hash of the file set.
5. If engine #2 fails, the project is first validated by the JS linker (its
   "missing file / symbol not exported" diagnostics are more precise), then
   execution goes through engine #1 with a note in the status bar.
6. `checkSyntaxProject` validates only the syntax and linking; self-repair patches
   **only the entry file**, the rest are treated as libraries.

## 5. SOLID decisions and what was decomposed

- **SRP**: one module — one area of responsibility. Large modules were split:
  the parser into grammar areas (`parser-*`), the interpreter into statements/
  expressions/builtins/AI, the editor into theme/metrics/render/input/pointer/
  navigation/tokenizer, and the services into one per business task.
- **OCP/DIP**: `compiler/index.js` and `compiler-loader.js` are the stable
  public API; `services/` depend on the facade rather than on the internal modules of
  the engine; `wasm-loader` supports two ABI contracts without changing the callers.
- **LSP/ISP**: the parser and controller "mixins" implement narrow method sets; the view
  modules get only what they need (for example, renderer/input receive `ed` rather than
  the whole controller).
- **Thin facades**: `compiler-loader.js` (25 lines), `examples.js` (16),
  `views/canvas-editor.js` (4), `compiler/index.js` (27) — re-exports only;
  their thickness and "re-export-only" property are checked by a script.
- **Decomposition of `views/editor/editor-input.js`** (was 376 lines → 177):
  the mouse/scrollbar were moved into `editor-pointer.js` (124), and the arrows and model
  editing into `editor-navigation.js` (90); `editor/index.js` imports the modules
  directly, and the public `CanvasEditor` API did not change.
- **Equality duplication removed**: `structuralEqual` in
  `interpreter-builtins.js` duplicated `deepEqual` from `value-utils.js`, and
  `looseEqual` in `interpreter-statements.js` was a truncated copy. Now
  `assert_eq(...)` (the builtin) and the `assert_eq` statement use the same
  `deepEqual` — the behavior is consistent (structural comparison of arrays,
  objects, `Result`/`Option`, and tensors).
- **A found defect fixed**: the regex that strips `think` blocks in
  `ai-gateway.js` looked for ` thinking` instead of `<think>` — now reasoning models
  (qwen3 and the like) are really cleaned up; covered by a test.
- **The 300-line threshold** per `.js` file is respected throughout `web-ide/`: the
  longest module (`services/formatter-service.js`) is about 270 lines and the rest are
  shorter; the audit confirms `OK (96 .js files)`.

## 6. Structural audit

`web-ide/scripts/check-structure.mjs` (run with `pnpm run check:structure`) checks: the
size of every `.js` file (< 300 lines), that the barrel facades
(`compiler-loader.js`, `examples.js`, `views/canvas-editor.js`,
`compiler/index.js`) are no thicker than 40 lines and contain re-exports only, the
absence of a BOM, and the absence of TODO stubs. The current result: **OK (96 `.js`
files)**.

## 7. Test coverage

Methodology: `node --experimental-test-coverage --test "test/*.test.js" "test/*.test.mjs"`
(Node v24.21.0); coverage is computed over the modules actually loaded by the tests.
Total: **414 tests, 0 failures**. Result: **97.51% lines / 91.47% branches /
98.52% functions** (before the modules work: 99.53 / 96.98 / 98.39 on 368 tests —
the share dropped because new module files with partial coverage were added:
`modules-rewrite.js` is at 70.95% lines).

| File | Line % | Branch % | Funcs % |
|---|---:|---:|---:|
| `compiler-loader.js` | 100.00 | 100.00 | 100.00 |
| `compiler/ai-config.js` | 100.00 | 100.00 | 100.00 |
| `compiler/ai-gateway.js` | 100.00 | 97.50 | 100.00 |
| `compiler/analysis.js` | 100.00 | 92.16 | 100.00 |
| `compiler/environment.js` | 100.00 | 100.00 | 100.00 |
| `compiler/host-features.js` | 100.00 | 93.33 | 100.00 |
| `compiler/index.js` | 100.00 | 100.00 | 100.00 |
| `compiler/interpreter-ai.js` | 100.00 | 100.00 | 100.00 |
| `compiler/interpreter-builtins.js` | 100.00 | 100.00 | 100.00 |
| `compiler/interpreter-expressions.js` | 99.59 | 98.13 | 100.00 |
| `compiler/interpreter-statements.js` | 98.30 | 97.44 | 100.00 |
| `compiler/interpreter.js` | 97.67 | 85.98 | 96.67 |
| `compiler/lazy-ai.js` | 95.00 | 100.00 | 80.00 |
| `compiler/lexer.js` | 100.00 | 97.78 | 100.00 |
| `compiler/loader.js` | 100.00 | 100.00 | 100.00 |
| `compiler/modules-link.js` | 96.49 | 79.31 | 100.00 |
| `compiler/modules-manifest.js` | 97.58 | 74.58 | 100.00 |
| `compiler/modules-rewrite.js` | 70.95 | 55.13 | 100.00 |
| `compiler/modules.js` | 96.85 | 82.52 | 100.00 |
| `compiler/oop.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-concurrency.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-core.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-declarations.js` | 100.00 | 97.50 | 100.00 |
| `compiler/parser-expressions.js` | 98.73 | 96.24 | 100.00 |
| `compiler/parser-match.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-modules.js` | 95.08 | 90.32 | 100.00 |
| `compiler/parser-statements.js` | 100.00 | 98.35 | 100.00 |
| `compiler/parser.js` | 100.00 | 100.00 | 100.00 |
| `compiler/repair-core.js` | 100.00 | 89.66 | 100.00 |
| `compiler/repair.js` | 100.00 | 100.00 | 100.00 |
| `compiler/run.js` | 100.00 | 94.87 | 100.00 |
| `compiler/token.js` | 100.00 | 100.00 | 100.00 |
| `compiler/value-utils.js` | 98.26 | 98.61 | 100.00 |
| `compiler/wasm-loader.js` | 100.00 | 73.68 | 100.00 |
| `examples.js` | 100.00 | 100.00 | 100.00 |
| `examples/index.js` | 100.00 | 100.00 | 100.00 |
| `examples/loader.js` | 92.75 | 76.92 | 77.78 |
| `examples/manifest.js` | 100.00 | 100.00 | 100.00 |
| `hot-reload.js` | 100.00 | 94.44 | 91.67 |
| `services/ai-settings-service.js` | 100.00 | 100.00 | 100.00 |
| `services/compiler-service-project.js` | 92.23 | 74.70 | 95.24 |
| `services/compiler-service.js` | 98.25 | 92.19 | 100.00 |
| `services/formatter-service.js` | 100.00 | 99.26 | 100.00 |
| `services/share-service.js` | 100.00 | 100.00 | 100.00 |
| `services/workspace-service.js` | 100.00 | 98.18 | 100.00 |
| `views/editor/editor-metrics.js` | 98.73 | 95.00 | 100.00 |
| `views/editor/editor-theme.js` | 100.00 | 100.00 | 100.00 |
| `views/editor/line-tokenizer.js` | 100.00 | 100.00 | 100.00 |
| **Total** | **97.51** | **91.47** | **98.52** |

The uncovered lines are defensive/unreachable branches and rare paths: the check
of the remaining goroutine queue after the scheduler is drained
(`interpreter.js`), the position-restoring `catch` in `skipTypeArgs`
(`parser-expressions.js`), the `Uint8Array`/`ArrayBuffer` returns unreachable from
WASM (`wasm-loader.js`), diagnostic branches in `modules-rewrite.js` (rewriting
rare pattern/decorator kinds), manifest guards (`modules-manifest.js`,
`modules-link.js`), and the degradation paths of `examples/loader.js` without
browser APIs.

### What was added to the tests

- Earlier: 11 new files, 188 tests (gateway, AI settings, builtins, value-utils,
  pipeline, engine1-extra, parser-edge, services-extra, formatter-edge,
  wasm-loader-edge, editor-core). The original 149 tests were not changed.
- Modules (+46 tests): `test/modules.test.js` (path resolution, graph, cycles,
  cache), `test/modules-engine1.test.js` (linking and execution in engine #1),
  `test/modules-manifest.test.js` (`LPF1`, `projectHash`),
  `test/modules-wasm-abi.test.js` (the real `latent_compile_files`),
  `test/modules-service.test.js` (the project service, cache, engine #2
  fallback), `test/bundling.test.mjs` (bundling/chunks).

## 8. How to run

```bash
cd web-ide
pnpm test                      # node --test "test/*.test.js" "test/*.test.mjs" — 414 tests
pnpm coverage                  # node --experimental-test-coverage --test ... + the coverage table
pnpm run check:structure       # the structural audit (files < 300, thin facades, BOM)
```

The `node` instance used: `node.exe` v24.21.0 (see `latent-work/PLAN.md`);
`pnpm` is run as `node <pnpm.mjs> ...`. `web-ide` has no dependencies, so
`pnpm install` is not required.

Adjacent checks (outside `web-ide/`):

```bash
node scripts/verify-wasm.mjs web-ide/compiler.wasm   # validate + instantiate: OK
node scripts/integration.mjs                         # requires target/debug/latentc (cargo build)
```

`verify-wasm.mjs` with `--run` expects a program with an exported `main()`
(a compiled user `.wasm`), not `compiler.wasm`. The `integration.mjs` script was checked:
it currently exits with code 2 and the message
`latentc not found ... run 'cargo build --bin latentc'` — this is an external
dependency (the Rust build), not a web-ide regression.

## 9. Risks and known limitations

1. **Coverage is computed only over the loaded modules.** `main.js`,
   `controllers/*`, and `views/*` (except the pure `editor/theme|metrics|line-tokenizer`)
   are tied to the DOM and are not imported in the Node tests, so they are not in the
   coverage report. Checking them requires jsdom/happy-dom or e2e (Playwright) — a
   separate task; for now their contracts are indirectly covered by unit tests of the
   services/pure modules.
2. **Unreachable defensive branches** (see §7) are deliberately left in the code as
   defensive programming; they do not affect acceptance (the threshold is ≥ 90% lines).
3. **Legacy modules from the CodeMirror era** — `autocomplete.js`, `syntax-highlight.js`
   (the global `CodeMirror`), and the alternative `runtime.js` — are not wired into
   `index.html` and are not used; they are recommended for removal in a separate commit
   (not removed in this task, to avoid breaking possible external references).
4. **`integration.mjs`** requires `target/debug/latentc` (the Rust build) and uses no
   external services; in the current environment the binary is absent.
5. **The coverage numbers** were taken on Node v24 with an experimental flag; changing
   the Node version may produce small differences in branch percentages.
6. **Tests are isolated per file** (node:test runs files in separate processes), and the
   global stubs (`fetch`, `caches`, `localStorage`, `window`, `location`) are restored in
   `finally`.
7. **The playground in the docs**: `scripts/sync-playground.mjs` copies only the browser
   files (`index.html`, `*.js`, `styles/`, `compiler/`, `views/`,
   `services/`, `examples/`, `*.wasm`), so new editor submodules land in the playground
   automatically, while `test/`, `package.json`, and `scripts/` do not; no changes to the
   sync script are required.
