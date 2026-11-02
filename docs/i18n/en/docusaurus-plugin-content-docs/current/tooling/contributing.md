---
title: "Contributing"
sidebar_label: Contributing
sidebar_position: 6
description: "The repository structure, the style, the tests, a checklist for adding a language feature (from the lexer to selfhost, language data, and documentation), and the git process."
---

# Contributing

Repository: `github.com/jegius/latent`, the working branch of the project is
`part10-toolchain`. The compiler is Rust (`src/`), the web IDE is vanilla JS
(`web-ide/`), and the self-hosted compiler is written in Latent itself
(`selfhost/`).

## Repository structure

```text
Cargo.toml               the latent package (lib + bin latentc)
src/                     the Rust compiler: Latent → WASM
  lexer/ ast/ parser/ typechecker/ codegen/ runtime/ ai/ fp/
  codegen/emit_expr/ emit_call/ module_builder/ runtime_helpers/  codegen submodules
  typechecker/infer/expr/  calls/builtins/effects of the type checker
  syntax.rs types.rs     "display-only" models (not used in the pipeline)
  lib.rs                 compile_source + the C ABI (latent_alloc/compile/...)
  bin/latentc.rs         the CLI
web-ide/                 the browser IDE (ES modules, no build)
  compiler/              engine #1 (JS) + the engine #2 loader
  examples/              *.lat examples (the single source of truth)
  compiler.wasm          engine #2 (Rust→WASM), rebuilt from the current src/
selfhost/                the compiler written in Latent: src/*.lat, shc.lat, bootstrap
scripts/                 sync-playground.mjs, build-wasm.sh, coverage-rust.ps1,
                         check-golden.mjs, verify-wasm.mjs, integration.mjs
docs/                    the Docusaurus documentation site
mcp/docs-mcp/            the MCP documentation server
tooling/language-data/   machine-readable data about the language (JSON)
tooling/latent-lsp/      the LSP server (Node, stdio)
editors/vscode/          the VS Code extension
editors/idea/            the IntelliJ IDEA plugin
.github/workflows/       CI (docs.yml and others)
```

## Style

- Comments and documentation are in **Russian**; identifiers are in English.
- UTF-8 without BOM; LF; 4-space indentation (JS/Rust) — as in the existing files.
- No external dependencies in `web-ide/`, `mcp/`, `tooling/`, `editors/` unless
  absolutely necessary: the projects are zero-deps (except Docusaurus in `docs/`
  and Gradle in `editors/idea/`).
- `src/` is decomposed by area of responsibility (SRP); new features come as
  separate functions/modules, not as "one more if".
- In `selfhost/src/*.lat`: selfhost itself stays single-file (it does not parse
  modules — it receives a `bundle`), so the parts are responsibility-separated
  files glued together by `build.mjs`.

## Invariants that must not be broken

1. `cargo test` — green.
2. `node --test "selfhost/test/*.test.mjs"` — green.
3. `node --test "web-ide/test/*.test.js"` — green.
4. `node selfhost/bootstrap.mjs` — `FIXED POINT: stage2 === stage3`.
5. `docs/scripts/validate-examples.mjs` — every ```latent block matches the
   expectations.
6. Public semantics are documented: if the behavior changes, update
   `docs/docs/reference/**` and `tooling/language-data/language.json`.

Changing the tests together with a feature is allowed, but the reason is recorded
in the commit.

## How to add a language feature: a checklist

Using a new construct as an example (say, `break`):

1. **Lexer** — `src/lexer/keywords.rs` (+ `token.rs` if a new token is needed),
   tests in `src/lexer/tests/`.
2. **AST** — `src/ast/expr.rs` or `src/ast/stmt.rs` (+ the `ast/mod.rs` re-export).
3. **Parser** — `src/parser/declarations.rs` / `statements.rs` /
   `expressions/` (+ `type_parser.rs` if the syntax appears in annotations).
4. **Type checker** — `src/typechecker/infer/expr/{mod,call,effects}.rs` /
   `stmt.rs` (+ `types/mod.rs` if a new type is needed); decide what exactly gets
   checked.
5. **Codegen** — `src/codegen/emit_expr/` / `emit_call/` / `emit_stmt.rs` /
   `module_builder/` / `runtime_helpers/`; check that the WASM is valid
   (`WebAssembly.validate`).
6. **Selfhost** — `selfhost/src/*.lat` (lexer/parser/emission) + rebuild with
   `node selfhost/build.mjs`; preserve the fixed point.
7. **Differential tests** — `selfhost/test/features.test.mjs` (oracle vs stage1
   vs stage2), `web-ide/test/*`, `src/codegen/tests/*`.
8. **language-data** — `tooling/language-data/language.json`
   (keywords/operators/types/builtins/diagnostics) and
   `latent-language.schema.json`.
9. **Documentation** — `docs/docs/{guide,reference,specs,examples}/**`: grammar,
   types, operators, builtins, diagnostics, the parity matrix. Every ```latent
   block must compile or be marked.
10. **Engine #1 (if applicable)** — `web-ide/compiler/*` (lexer/parser/
    interpreter) + tests; keep in mind that it may not support the feature — then
    document that explicitly.

To fix a codegen defect (a float context, for example), add a regression test that
checks `WebAssembly.validate`, not just `status=1`.

## Tests

Current numbers (see [bootstrap](./bootstrap.md#5-full-check-suite)):

- Rust: `cargo test` — **265 tests**; coverage **91.00% lines / 93.53%
  functions** (`pwsh scripts/coverage-rust.ps1`); the golden set
  `node scripts/check-golden.mjs` — **47 programs matched byte-for-byte, 0
  mismatches** (1 skip: `selfhost/shc.lat` was changed by the selfhost agent after
  the reference was captured). Tests: `src/lexer/tests`, `src/parser/tests`,
  `src/typechecker/tests`, `src/codegen/tests`, `src/runtime/tests`,
  `src/ai/tests`, `src/fp/tests`.
- web IDE: `node --test "web-ide/test/*.test.js" "web-ide/test/*.test.mjs"` — **414 tests** (368 before + 46 for modules), coverage **97.51% lines / 91.47% branches / 98.52% functions**; structural audit —
  `pnpm run check:structure`.
- selfhost: `node --test "selfhost/test/*.test.mjs"` — **173 tests** (19 suites), coverage **100% functions / 97.94% lines**; `bootstrap.mjs` — the fixed point.
- MCP: `node --test "mcp/docs-mcp/test/*.test.mjs"` — **300 tests**.
- LSP: `node --test "tooling/latent-lsp/test/*.test.mjs"` — **146 tests** (94.59% lines, 90% threshold).
- VS Code: `node --test "editors/vscode/test/*.test.mjs"` — **70 tests**, line
  coverage 98.77%.
- IDEA: `cd editors/idea && ./gradlew test` — **49 tests**, `buildPlugin` — a zip
  in `build/distributions/`.
- docs: `node docs/scripts/validate-examples.mjs` — **213 blocks** (173 valid, 34 marked, 6 `module-part` skipped); the site has **79 pages RU + 79 EN**, `llms.txt`/`llms-en.txt` are generated by the build. Common problems — see
  [bootstrap](./bootstrap.md).

## Git process

- Commits are made by the branch owner (Lead); agents and contributors do not
  commit on their own without being told to.
- The branch is `part10-toolchain`; commit messages are in Russian, short, and
  mention the affected areas.
- Before a commit: the full set of checks (see above), and `git status` without
  junk (build artifacts belong in `.gitignore`).
- Generated artifacts (`selfhost/shc.lat`, `web-ide/compiler.wasm`,
  `docs/static/playground/`) are committed only when necessary and with an
  explanation of how they were rebuilt.

## Ownership boundaries (when working on the docs as a team)

| Area | Owner |
|---|---|
| `docs/package.json`, `docusaurus.config.js`, `sidebars.js`, `docs/src/**`, `docs/static/**`, `docs/scripts/**`, `docs/docs/{intro,getting-started,tutorial,guide}/**` | docs-guide |
| `docs/docs/{reference,specs,tooling,examples}/**` | docs-reference |
| `tooling/language-data/**`, `tooling/latent-lsp/**` | language-lsp |
| `mcp/docs-mcp/**` | docs-mcp |
| `editors/vscode/**` / `editors/idea/**` | vscode / idea |
| `selfhost/**` (+ `src/codegen/emit_call/` if needed) | selfhost |
| `README.md`, `.gitignore`, `scripts/sync-playground.mjs`, git commits | Lead |

## Documentation: rules for examples

- Every ```latent block **must** compile with `web-ide/compiler.wasm` (otherwise
  the check run fails).
- Host-only and knowingly invalid examples are marked with the first line
  `// ошибка: ...` / `// Не компилируется движком №2: ...` or with the info string
  `latent expected-error`.
- Give signatures, grammar, and pseudocode in ```text.
- Links to other pages are relative `.md` (Docusaurus `onBrokenLinks: throw`).
- Mention the Web IDE through the `PlaygroundFrame`/`PlaygroundLink` components
  (`docs/src/components/Playground.jsx`) rather than hard-coding the URL.

## Related sections

- [Bootstrap](./bootstrap.md) — the build and the checks.
- [Reference](../reference/index.md) — what to document.
- [Parity matrix](../specs/parity-matrix.md) — where the engines diverge.
