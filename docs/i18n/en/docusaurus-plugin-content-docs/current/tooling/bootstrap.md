---
title: "Bootstrap and rebuild"
sidebar_label: Bootstrap
sidebar_position: 5
description: "How to build latentc, rebuild compiler.wasm for the web IDE, build the self-hosted compiler, and run the tests; the checks a contributor has to pass."
---

# Bootstrap and rebuild

A cheat sheet for contributors: how to rebuild the compiler, the WASM for the
IDE, the self-hosted compiler, and the documentation, and how to run the checks.

## What you need

| Tool | Version/path (in the project environment) |
|---|---|
| Rust + cargo | `C:\Users\Admin\.cargo\bin\cargo.exe` (1.99.x) |
| wasm-target | `rustup target add wasm32-unknown-unknown` (already installed) |
| Node.js | `C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` (v24) |
| JDK 17 (for the IDEA plugin) | `C:\Users\Admin\Documents\deepseek-harness\default-workspace\tools\jdk17` |
| MinGW (for the native `latentc` on Windows) | `C:\Users\Admin\tools\mingw` |

Windows has no MSVC linker, so the native binary is built for the GNU target
`x86_64-pc-windows-gnu`.

Rust is only needed for `latentc` and for a one-off seed recovery. Building the
self-hosted compiler and user programs works **without Rust** — see
[Building without the Rust toolchain](#building-without-the-rust-toolchain).

## 1. Native `latentc`

```powershell
cd C:\Users\Admin\IdeaProjects\latent
# the usual path (if a linker is available):
cargo build --bin latentc
# Windows without MSVC:
cargo build --bin latentc --target x86_64-pc-windows-gnu
```

The binaries:

- `target/debug/latentc(.exe)` — the regular build;
- `target/x86_64-pc-windows-gnu/debug/latentc.exe` — the GNU build.

`selfhost/bootstrap.mjs` looks for `target/debug/latentc` by default; the path can
be overridden with the `LATENTC` variable.

## 2. `compiler.wasm` for the web IDE (engine #2)

```bash
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/latent.wasm web-ide/compiler.wasm
cp target/wasm32-unknown-unknown/release/latent.wasm web-ide/latent.wasm
```

`scripts/build-wasm.sh` does the same, but it **hard-codes a macOS/arm
toolchain** (`stable-aarch64-apple-darwin`) — on Windows/Linux use the commands
above or fix `TOOLCHAIN_DIR` in the script.

:::note
**The shipped `web-ide/compiler.wasm` is up to date**: it is built from the
current `src/` and contains memory builtins (`alloc`, `load8`, `store8`,
`load32`, `store32`, `memcopy`), `spawn`/`yield`/`async`/`await`/`select`, `test`
blocks, and the current fixes. Verified: `alloc(8)` plus
`store8`/`store32`/`load8`/`load32`/`memcopy` compile to valid WASM.

- Artifact: `web-ide/compiler.wasm` = `web-ide/latent.wasm` (465,435 bytes,
  version `latent 0.1.0`), rebuilt together with the `src/` decomposition.
- `docs/scripts/validate-examples.mjs` validates the blocks **with this** file:
  after rebuilding `compiler.wasm`, re-run the validation — some of the "does not
  compile" markers may become stale.
- The IDEA plugin carries a **separate, older** copy
  (`editors/idea/src/main/resources/runner/compiler.wasm`) that does not have the
  memory builtins yet — see [IntelliJ IDEA](./idea.md#limitations).
:::

## 3. Self-hosted compiler

```bash
# 1) rebuild shc.lat from its parts (deterministically)
node selfhost/build.mjs

# 2) bootstrap: stage1 -> stage2 -> stage3, check the fixed point
node selfhost/bootstrap.mjs
# expected: FIXED POINT: stage2 === stage3
```

- `build.mjs` concatenates `selfhost/src/*.lat` in sorted order; `shc.lat` is a
  generated file, do not edit it by hand.
- `bootstrap.mjs` uses `latentc` (`LATENTC` to override it), compiles `shc.lat`,
  then compiles that with itself, and compares the bytes.
- The compiler ABI: input at address 3145728, output at 65536 (see
  [selfhost](../specs/selfhost.md#compiler-abi)); the shipped reader/writer lives
  in `bootstrap.mjs`.

### Building without the Rust toolchain

Rust is only needed for the **first** build of the compiler. The repository ships
`selfhost/seed.wasm` — an already built self-hosted compiler (its sha256 is in
`selfhost/seed.json`) that can compile `shc.lat` and close the loop without
`cargo`/`latentc`:

```bash
# shc.lat from its parts — Node only
node selfhost/build.mjs

# seed -> stage1' -> stage2' -> stage3'; expected: FIXED POINT (no Rust)
node selfhost/bootstrap-wasm.mjs

# the same, but do not write stage-sh-*.wasm
node selfhost/bootstrap-wasm.mjs --no-write
```

The chain and its artifacts:

```text
seed.wasm        -> shc.lat -> selfhost/stage-sh-1.wasm
stage-sh-1.wasm  -> shc.lat -> selfhost/stage-sh-2.wasm
stage-sh-2.wasm  -> shc.lat -> selfhost/stage-sh-3.wasm
stage-sh-2 === stage-sh-3   (FIXED POINT, stage2' === stage3')
```

`stage-sh-*.wasm` are covered by `.gitignore` and do not collide with the
`stage1/2/3.wasm` files of the Rust chain.

**CLI without Rust** — the seed works as an ordinary compiler:

```bash
node selfhost/wasm-compiler.mjs compile hello.lat        # -> hello.wasm
node selfhost/wasm-compiler.mjs check hello.lat          # exit 1 + error text
node selfhost/wasm-compiler.mjs run hello.lat            # print() + main()
node selfhost/wasm-compiler.mjs version                  # version, sha256, fixed point
node selfhost/wasm-compiler.mjs version --compiler selfhost/stage-sh-2.wasm
```

**Updating the seed** after editing `selfhost/src/*.lat` (without Rust):

```bash
node selfhost/build.mjs
node selfhost/bootstrap-wasm.mjs                  # first check FIXED POINT
node selfhost/bootstrap-wasm.mjs --refresh-seed   # new seed.wasm + seed.json
node selfhost/bootstrap-wasm.mjs --refresh-seed --dry-run   # diff only
node selfhost/bootstrap-wasm.mjs --verify-seed    # seed sha256 + shc.lat
```

`--refresh-seed` writes files only when the fixed point holds, prints a diff
(sizes, sha256, number/offset of differing bytes) and updates `seed.json`
(`seedSha256`, `seedBytes`, `shcSha256`, `shcBytes`, `seedRevision`, dates).
Commit `seed.wasm` and `seed.json` together. Do not commit the stage artifacts.

The `seed` is a trusted starting point: `bootstrap-wasm.mjs` compares its sha256
with `seed.json` on every run (a mismatch exits with code 2). Verify manually:
`node selfhost/bootstrap-wasm.mjs --verify-seed` or `sha256sum selfhost/seed.wasm`.

Limitation: updating without Rust works as long as the current seed can compile
the new `shc.lat`. If a change needs a language construct the seed does not have,
Rust is required once (`node selfhost/bootstrap.mjs --update-seed`); after that the
Rust-free path works again.

## 4. Documentation and playground

```bash
# the playground for Docusaurus (Lead): copies web-ide/ -> docs/static/playground/
node scripts/sync-playground.mjs

cd docs
pnpm install
pnpm run build            # docusaurus build (onBrokenLinks: throw)
pnpm run start            # dev server: http://localhost:3000/latent/
node scripts/validate-examples.mjs   # all ```latent blocks
```

- `validate-examples.mjs` compiles **all** ```latent blocks in `docs/docs/**`
  using `web-ide/compiler.wasm`; blocks marked with
  `// ошибка: ...` / `// Не компилируется движком №2: ...` (or
  `latent expected-error`) are expected to be invalid.
- `docs/static/playground/` is a copy of `web-ide/` (without `node_modules`, the
  tests, and the README); it is published at `/latent/playground/`.

## 5. Full check suite

```bash
# Rust: 265 tests
cargo test
# Rust coverage (llvm-cov, GNU-ld workaround): 91.00% lines / 93.53% functions
pwsh scripts/coverage-rust.ps1
# golden set: 47 programs matched byte-for-byte, 0 mismatches
# (1 skip — selfhost/shc.lat was changed by the selfhost agent)
node scripts/check-golden.mjs

# selfhost: 166 tests, coverage 94.56% functions / 96.68% lines + the fixed point (Rust path)
node selfhost/build.mjs
node selfhost/bootstrap.mjs                 # FIXED POINT
node --test "selfhost/test/*.test.mjs"

# selfhost without Rust: Node only (CI job selfhost-norust)
node selfhost/build.mjs
node selfhost/bootstrap-wasm.mjs            # FIXED POINT (stage2' === stage3')
node selfhost/wasm-compiler.mjs version
node --test selfhost/test/bootstrap-wasm.test.mjs

# web-ide: 368 tests, 99.53% lines / 96.98% branches / 98.39% functions
cd web-ide && pnpm test
cd web-ide && pnpm coverage
cd web-ide && pnpm run check:structure

# docs: 75 pages RU + 75 EN; llms.txt/llms-en.txt generated by the build
cd docs && pnpm install && pnpm run build
node docs/scripts/validate-examples.mjs     # 194 blocks: 165 valid, 29 marked

# mcp: 300 tests
node --test "mcp/docs-mcp/test/*.test.mjs"

# lsp: 133 tests
node --test "tooling/latent-lsp/test/*.test.mjs"

# vscode: 70 tests (line coverage 98.77%), latent-1.0.0.vsix built
node --check editors/vscode/src/extension.js
node --test "editors/vscode/test/*.test.mjs"

# idea (JDK 17 required): Gradle buildPlugin
cd editors/idea && ./gradlew buildPlugin
```

Expectations: everything is green; `bootstrap.mjs` prints `FIXED POINT`.

:::note About the IDEA plugin
`buildPlugin` requires JDK 17, Gradle 8.10.2 (downloaded by the wrapper), and
IntelliJ Platform 2024.2 from the network. If the Java process cannot write to
the repository directory (this happened in the DSH sandbox), build in a copy of
the directory in the working folder. The details and the current status are in
[IntelliJ IDEA](./idea.md).
:::

## Common problems

| Symptom | Cause/solution |
|---|---|
| `linker 'link.exe' not found` | no MSVC: build with `--target x86_64-pc-windows-gnu` (MinGW is required) |
| `can't find crate for std` during the wasm build | `wasm32-unknown-unknown` is not installed: `rustup target add …` |
| `build-wasm.sh` does not find the toolchain | the script assumes macOS/arm; use `cargo build --target wasm32-unknown-unknown` |
| `bootstrap.mjs: spawn latentc ENOENT` | build `latentc` or set `LATENTC` |
| `bootstrap-wasm.mjs: seed.json does not match seed.wasm` | the seed is corrupted/replaced; restore it from git or rebuild it with a trusted compiler (`--refresh-seed`), then check `--verify-seed` |
| `stage-sh-2 !== stage-sh-3` | `shc.lat` does not reproduce itself: the seed is stale or there is a regression; rebuild with `build.mjs`, check via the Rust chain, then `--refresh-seed` |
| `seed could not compile shc.lat: error: ...` | the new `shc.lat` uses constructs the current seed does not have; use the Rust path once (`node selfhost/bootstrap.mjs --update-seed`) |
| `stage2 !== stage3` | `src/`/`shc.lat` changed without a rebuild; re-run `build.mjs`; a mismatch is a regression |
| `validate-examples: компилятор не найден` | `web-ide/compiler.wasm` is missing — build it (step 2) |
| the IDE does not load engine #2 | `compiler.wasm` is unavailable; check Network and the WASM tab |
| IDEA: `AccessDeniedException: ...\.intellijPlatform` | the Java process cannot write to the repository directory (sandbox); build a copy of the directory in the working folder (see [idea](./idea.md)) |
| IDEA: `Could not create parent directory for lock file ...gradle-8.10.2-bin` | set `GRADLE_USER_HOME` to a path Java can write to |

## Related sections

- [Self-hosted compiler](../specs/selfhost.md)
- [The `latentc` CLI](../reference/cli.md)
- [WASM ABI](../reference/wasm-abi.md)
- [Contributing](./contributing.md)
