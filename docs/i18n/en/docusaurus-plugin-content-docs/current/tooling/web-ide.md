---
title: "Web IDE (playground)"
sidebar_label: Web IDE
sidebar_position: 1
description: "A complete description of the browser-based Latent IDE: the two engines, features, keyboard shortcuts, iframe embedding, publishing to GitHub Pages, and running it locally."
---

import {PlaygroundFrame, PlaygroundLink} from '@site/src/components/Playground';

# Web IDE (playground)

The Latent playground is a full-fledged browser IDE in the style of IntelliJ IDEA
Darcula (dark theme, canvas editor, project tree, console, AI mode). It is built
from `web-ide/` and published as a static directory of the documentation site:
**<PlaygroundLink>open the playground</PlaygroundLink>**
(`https://jegius.github.io/latent/playground/`).

<PlaygroundFrame height="640px" title="Latent playground" />

## What it is

- A **static application** with no backend: HTML + ES modules + `compiler.wasm`.
- **Two engines**: a JS interpreter (executes the full language) and the Rust
  compiler in WASM (compiles a host-free subset). The playground picks the
  engine itself and automatically falls back to #1 — see
  [engines](../specs/engines.md).
- A **single source of examples**: `web-ide/examples/*.lat` (read by the tests and
  by this documentation section as well).
- All data (files, AI settings) lives in `localStorage`; code can be shared with a
  link.

## Features

| Feature | How to use |
|---|---|
| Editor | canvas rendering: line numbers, current-line highlight, scrolling, selection; input goes through a hidden `textarea` (IME, Cyrillic, undo) |
| Auto-indent/brackets | Enter — auto-indent; auto-closing `()[]{}` and quotes; Tab/Shift+Tab |
| Formatting | `Edit → Format Code` (`Ctrl/⌘+Alt+L`) — alignment by `{}` and whitespace normalization; strings/comments are left untouched |
| File tree | `＋` — create a `.lat` file; rename/delete; everything is saved in the browser |
| Tabs and status bar | Ln/Col, active engine, file name; clicking a tab with the middle mouse button closes the file |
| Examples | the `examples/` folder in the project tree plus the `File → Examples` menu (by group) |
| Run | `Ctrl/⌘+Enter` — execute with engine #1; host features work, and a loaded #2 falls back automatically |
| Run with AI | `Ctrl/⌘+Shift+Enter` — AI mode + self-repair (up to 3 attempts) + AI insights |
| Check | check the syntax (lexer + parser of engine #1) |
| Engine #2 | compile the host-free subset explicitly; for a host program — an explanation and a **Run in engine #1** button |
| WASM tab | hex dump of the compiled module (or the "bytecode" of engine #1) |
| AI Insights tab | metrics: functions, loops, conditions, complexity, lines, tokens |
| Share | code as base64 in the URL (`#code=...`), the link is copied to the clipboard |
| auto-run | debounced auto-run while editing |
| AI Gateway | provider/URL/model/key settings (`AI → AI Gateway Settings`) |

## Modules and multi-file projects

The file tree is a full project: **the active file is the entry**, and other
`.lat` files are connected with `import`. Top-level `fn`, `class`, and `enum` are
supported:

```text
// math.lat
export fn square(x: int) -> int { return x * x; }
export enum Shape { Circle(int), Rect(int, int) }

// main.lat
import { square, Shape } from "./math.lat";
import { square as sq } from "./math.lat";

fn main() -> int {
    let s = Circle(2);
    return match s { case Circle(r): { return square(r) + sq(r); } default: 0 };
}
```

- `import { name, name as alias } from "./path.lat";` and
  `import "./path.lat";`; the path must be relative and end with `.lat`, and it
  cannot escape the workspace root.
- Import cycles are allowed (two-phase linking); each file is loaded once by its
  canonical path. Errors (missing file, symbol not exported, duplicate name,
  import/export not at top level, absolute path) are reported with a path and
  line: `main.lat:3: ...`.
- **Run / Run with AI / Check** work with the project: Check validates the
  imports/linking as well as the active file's syntax; Run executes all modules,
  including host features. **Format** formats the active file.
- **Engine #1** links modules natively (JS resolver `compiler/modules.js`, linker
  `compiler/modules-*.js`), caches parsed modules by content hash, and supports
  `enum` with multi-field variants.
- **Engine #2** receives all workspace `.lat` files as a single `LPF1` manifest
  through the `latent_compile_files` C-ABI; the result is cached by the file-set
  hash. The shipped `compiler.wasm` exports this ABI, so **Engine #2** compiles
  the whole project (checked via `supportsModules`). If an older build without
  the ABI is loaded, the button reports "engine #2 has no modules yet" and offers
  a run in engine #1; the single-file `latent_compile` path keeps working as
  before.
- **CLI and selfhost**: the same project builds with `latentc compile/check`, and
  for the self-hosted compiler the host runs `latentc bundle` to get a flat
  source. The full syntax, linking semantics and v1 limits are in
  [file modules](../guide/modules.md).

## Keyboard shortcuts

| Combination | Action |
|---|---|
| `Ctrl/⌘+Enter` | Run |
| `Ctrl/⌘+Shift+Enter` | Run with AI |
| `Ctrl/⌘+S` | Save (the file is auto-saved anyway) |
| `Ctrl/⌘+Alt+L` | Format Code |
| `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z` | Undo / Redo |
| `Ctrl/⌘+A` | Select All |
| Middle mouse button on a tab | close the file (with confirmation) |

While a modal dialog is open, global combinations are not intercepted.

## Full browser execution of host features

The playground executes **any** program in the language, including host features:
channels (`channel()`, `ch <- v`, `<-ch`, `ch.send`/`ch.recv`), `select`, `spawn`,
`yield`, AI primitives (`ai_infer`, `ai_embed`, `ai_stream`, `tensor`, `matmul`,
`cosine_similarity`), contracts, and `test` blocks. They are implemented by engine #1
(the tree-walking JS host runtime); engine #2 only compiles the host-free subset to
WASM. Switching is automatic, and #2 errors never become the final Run error.

## Two engines — what you need to know

| | Engine #1 (JS) | Engine #2 (Rust→WASM) |
|---|---|---|
| Run | ✅ executes the full language | ❌ only compiles, does not execute |
| Compilation | "bytecode" = the source | real WASM for the host-free subset |
| AI/channels/tensors/contracts | ✅ full semantics | ❌ "requires host runtime" error |
| Error messages | English, JS | Russian, compiler's |
| Role in the playground | executes **any** program | compiles the host-free subset; auto fallback |

- **Run always executes engine #1** — the full host runtime of the language.
  Even when engine #2 is already loaded, a host program is never sent to it.
- Host-free programs (no host features) are still compiled by #2 for the WASM
  tab when it is loaded. Host features are detected automatically (channels,
  `spawn`, `select`, `yield`, AI, tensors, `test`/contracts); their bytecode
  comes from #1.
- If engine #2 nevertheless returns a "requires host runtime" error (or any
  compilation error), Run **never shows it as final**: execution continues in
  #1 and the status bar shows `engine #1 (host runtime)`.
- The **Engine #2** button is an explicit choice: for a host program the
  compiler explains the limitation and offers a **Run in engine #1** button.
- The **Engine #2** button and the **WASM** tab load `compiler.wasm` lazily
  (Cache API, name `latent-compiler-v1`).
- If `compiler.wasm` is unavailable, the IDE stays on engine #1 (graceful
  degradation) and the status bar shows `engine #1 (host runtime)`.
- The shipped `compiler.wasm` is up to date: it is built from the current `src/`
  (641,917 bytes), and the memory builtins plus the module ABI
  (`latent_compile_files`, `latent_bundle_files`) are present in it — see
  [bootstrap](./bootstrap.md).
- **AI examples in a normal Run** enable the mock automatically (no network or
  key required). The real gateway and self-repair remain available through
  **Run with AI**.

## Examples

Groups (`web-ide/examples/manifest.js`): Concurrency, Algorithms, Data,
Functional, Language, OOP, AI, Testing, Misc. Walkthroughs live in the
[examples](../examples/index.md) section.

- **Every example runs with a normal Run** — including `channels`,
  `select_yield`, `parallel_sum`, `tensors`, `testing_contracts`, and `ai_*`:
  host features are executed by engine #1, and AI examples automatically get
  the mock.
- For AI examples a normal Run does not touch the network; to use the configured
  gateway press **Run with AI** (or `Ctrl/⌘+Shift+Enter`).
- Programs without host features are additionally compiled by engine #2 for the
  WASM tab.

## Embedding into a page

The components from `docs/src/components/Playground.jsx` (used on this page):

```jsx
import {PlaygroundFrame, PlaygroundLink} from '@site/src/components/Playground';

<PlaygroundLink>Open the Web IDE</PlaygroundLink>
<PlaygroundFrame height="640px" title="Latent playground" />
```

`PlaygroundFrame` builds an iframe with a `src` that accounts for `baseUrl`, so
when publishing to GitHub Pages (`baseUrl: '/latent/'`) the link automatically
becomes `/latent/playground/`. The direct link to the playground in production:
`https://jegius.github.io/latent/playground/`.

## Running locally

The playground consists of static files, but it does **not** work over `file://`
(ES modules and `fetch`): an HTTP server is required.

```bash
# option 1: straight from web-ide/
cd web-ide
python3 -m http.server 8000        # or: npx serve .
# open http://localhost:8000
```

```bash
# option 2: local Docusaurus (docs-guide)
cd docs && pnpm install && pnpm start
# playground: http://localhost:3000/latent/playground/
```

Option 2 requires `docs/static/playground/` to be populated — that is done by
`node scripts/sync-playground.mjs` (it copies `web-ide/`; see
[bootstrap](./bootstrap.md)).

## Building engine #2 for the playground

```bash
bash scripts/build-wasm.sh          # macOS-specific script
# or manually:
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/latent.wasm web-ide/compiler.wasm
```

The `scripts/build-wasm.sh` script hard-codes a macOS/arm toolchain — on
Windows/Linux use the manual build (see [bootstrap](./bootstrap.md)). The files
`web-ide/compiler.wasm` and `web-ide/latent.wasm` are copies of the same artifact.

## Lazy loading and chunks

The playground has two modes, both supported from the same source:

| Mode | How to run | What is loaded |
|---|---|---|
| **No build** (dev) | `cd web-ide && python3 -m http.server 8000` | static ES modules; `.wasm` and `.lat` are fetched on first use |
| **Production** | `pnpm install && pnpm run build:chunks && pnpm run preview` | `dist/`: entry + chunks, `.wasm` as a separate asset |

`vite build` is **optional**, not required: `index.html` → `main.js` and relative
imports work in the browser directly. The build is needed for GitHub Pages,
hash-based caching, and a smaller initial payload.

### Strategy

- **`base: './'`** — every URL (chunks, CSS, `compiler.wasm`) resolves relative
  to `index.html`. The playground can be published under any sub-path:
  `/latent/playground/`, `/playground/`, or locally — no config change.
- **`outDir: 'dist'`** — the artifact sits next to `web-ide/` and is not committed.
- **`manualChunks`** in `web-ide/vite.config.js`:

  | Chunk | Contents | Loaded |
  |---|---|---|
  | `core` | lexer, parser, interpreter, environment, value-utils, run | start |
  | `ai` | `compiler/ai-*.js`, `interpreter-ai.js`, `repair*.js` | start (config+mock); network later |
  | `editor` | `views/editor/**` | start |
  | `examples` | `examples/manifest.js` + all `.lat` (`?raw`) | first example click |
  | `engine2` | `compiler/wasm-loader.js` | **Engine #2** / WASM tab |
  | `formatter-service` | `services/formatter-service.js` | `Format Code` |
  | `vendor` | `node_modules/**` (if any appear) | on demand |

- **`dynamic import()`** — the lazy boundaries are fixed in code, not only in
  the config:
  - `compiler/loader.js` → `import('./wasm-loader.js')` on the first
    `loadWasmCompiler()`; the `.wasm` itself is `new URL('../compiler.wasm',
    import.meta.url)` (Vite emits a hashed asset, no `public/` needed);
  - `compiler/lazy-ai.js` → `import('./ai-gateway.js')` and
    `import('./repair.js')` only for an AI request/self-repair;
  - `examples/loader.js` → `import('./manifest.js')` and `import.meta.glob('?raw')`
    for `.lat`; the IDE starts with catalog metadata and one starter example;
  - the formatter — `import('../services/formatter-service.js')` in `handleFormat`.

### Chunk sizes

`pnpm run build:chunks` prints the table itself (Vite 6.4.5, local build):

| File | Size | gzip |
|---|---:|---:|
| `compiler-*.wasm` | 651.47 kB | — |
| `core-*.js` | 40.32 kB | 11.58 kB |
| `index-*.js` (entry) | 37.96 kB | 11.19 kB |
| `examples-*.js` | 32.19 kB | 9.03 kB |
| `editor-*.js` | 13.70 kB | 4.26 kB |
| `ai-*.js` | 4.76 kB | 2.24 kB |
| `formatter-service-*.js` | 3.46 kB | 1.37 kB |
| `engine2-*.js` | 1.88 kB | 0.79 kB |
| `index-*.css` | 12.86 kB | 3.05 kB |

The initial JS (< 100 kB gzip together with CSS) contains neither the `.wasm`
nor the example code: that is the win from `dynamic import()` + `manualChunks`.
To verify that a chunk is really lazy, look for its name in the entry file:

```bash
grep -o 'examples-[A-Za-z0-9_-]*\.js' web-ide/dist/assets/index-*.js
# no output → examples is not in the initial graph; import("./examples-…") is
```

### Publishing the playground from `dist`

`scripts/sync-playground.mjs` is Lead's area; it currently copies `web-ide/`
wholesale. To serve the built chunks, switch the source to `dist` when it exists:

```js
// scripts/sync-playground.mjs (proposal for the Lead)
const DIST = join(ROOT, "web-ide", "dist");
const SRC = existsSync(DIST) ? DIST : join(ROOT, "web-ide");
```

Then GitHub Pages gets `playground/index.html` + `playground/assets/*`, and
without a build it gets the original sources. `base: './'` already accounts for
`/latent/playground/`; no Docusaurus `baseUrl` change is needed.

### Embedding Latent-WASM in your own bundle

Detailed examples (React/Vue/Svelte, Worker, caching) are in the
[frontend guide](../guide/web-and-frontend.md). In short, for asset pipelines:

```js
// Vite: ?url — a hashed asset that works in dev and build
import coreUrl from './core.wasm?url';
const bytes = await (await fetch(coreUrl)).arrayBuffer();

// Vite/Rollup: new URL relative to the module (same trick as wasm-loader.js)
const url = new URL('./core.wasm', import.meta.url);
```

```js
// Rollup: without a plugin — copy the .wasm to public/ and use a stable URL
// public/core.wasm → fetch(`${import.meta.env.BASE_URL}core.wasm`)

// Webpack 5: asset/resource
// module.rules: [{ test: /\.wasm$/, type: 'asset/resource' }]
import coreUrl from './core.wasm';
```

Split your own runtime the same way: **entry** — UI and routing; **core** — what
the first screen needs; **wasm/engine** — `import()` when the user actually runs
a computation; **examples/fixtures** — on click. Rule of thumb: entry < 50 kB
gzip, lazy chunks as large as needed, `.wasm` as a separate file with
`Cache-Control: immutable`. Take metrics from `vite build` output (size + gzip)
and from DevTools → Network on a cold load.

## Limitations

- Engine #2 does not execute the program — you cannot verify WASM behavior in the
  IDE; its WASM tab only shows the compilation result of the subset.
- Engine #2 does not support host features (channels, AI, tensors, contracts) —
  this is not a playground error: Run automatically executes them in engine #1.
- Engine #1 does not support bitwise operators, `str/int/float/sqrt`, or block
  comments — in the IDE this shows up as an error or as unavailable.
- Formatting is not an AST printer: indentation and whitespace only.
- The AI key is stored in `localStorage` in plain text; requests go directly from
  the browser (the gateway needs CORS).
- Self-repair does not always fix errors: deterministic repair only knows about a
  missing `;` and unbalanced `{}`.

## Related sections

- [Engines](../specs/engines.md) · [AI runtime](../specs/ai-runtime.md) ·
  [Examples](../examples/index.md)
- [VS Code](./vscode.md) · [IntelliJ IDEA](./idea.md) · [MCP](./mcp.md)
- [Bootstrap and rebuild](./bootstrap.md)
