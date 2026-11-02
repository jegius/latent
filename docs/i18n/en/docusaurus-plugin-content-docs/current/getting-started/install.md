---
title: Installation
sidebar_label: Installation
sidebar_position: 1
description: Requirements and building the Rust compiler latentc, the WASM engine #2 (compiler.wasm), and the docs.
---

# Installation

There are three things you can build/run:

1. **The Rust compiler `latentc`** — a CLI: `.lat` → `.wasm`, syntax and type
   checking.
2. **Engine #2 for the browser** — `web-ide/compiler.wasm` (the same Rust code
   built for `wasm32-unknown-unknown`).
3. **Documentation and the playground** — the Docusaurus site in `docs/`.

## Requirements

| Component | What you need |
|---|---|
| Compiler `latentc` | Rust (stable) with cargo; on Windows a linker (MSVC or MinGW) |
| Engine #2 (`compiler.wasm`) | `rustup target add wasm32-unknown-unknown` |
| Web IDE, tests, docs | Node.js ≥ 18 (20+ recommended), pnpm for the docs |
| Docusaurus | Node.js ≥ 18, pnpm |

Check your environment:

```bash
rustc --version
cargo --version
node --version
```

## 1. Cloning

```bash
git clone https://github.com/jegius/latent
cd latent
git checkout part10-toolchain
```

## 2. Building the `latentc` CLI

```bash
cargo build --bin latentc
```

The binary will appear at `target/debug/latentc` (`target\debug\latentc.exe` on
Windows). Check it:

```bash
./target/debug/latentc version
# latentc 0.1.0
```

If there is no MSVC linker on Windows, use the GNU toolchain with MinGW:

```pwsh
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup run stable-x86_64-pc-windows-gnu cargo build --bin latentc
```

A release build is also possible:

```bash
cargo build --release --bin latentc
```

## 3. Building engine #2 (`compiler.wasm`)

Add the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

Then build with the script (bash; it finds the rustup toolchain that has `std`
for wasm32 itself):

```bash
bash scripts/build-wasm.sh
# Using cargo: ...
# OK: compiler.wasm = <N> bytes -> web-ide/
```

The script puts the artifact into `web-ide/compiler.wasm` and a copy into
`web-ide/latent.wasm`. The manual equivalent (for example, on Windows without
bash):

```pwsh
cargo build --release --target wasm32-unknown-unknown
Copy-Item target\wasm32-unknown-unknown\release\latent.wasm web-ide\compiler.wasm
Copy-Item target\wasm32-unknown-unknown\release\latent.wasm web-ide\latent.wasm
```

Checking that the module really does compile Latent:

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('web-ide/compiler.wasm');WebAssembly.instantiate(b,{env:{print(){}}}).then(({instance})=>{const e=instance.exports;console.log('compiler ok, version ptr', e.latent_version());});"
```

## 4. Node environment: tests and checks

```bash
node --test "web-ide/test/*.test.js"
node --test "selfhost/test/*.test.mjs"
node scripts/verify-wasm.mjs target/debug/hello.wasm --run
```

The compiler and the examples require no npm dependencies: only Node.js and
`web-ide/compiler.wasm`.

## 5. Documentation (this site)

```bash
cd docs
pnpm install
pnpm run build      # builds llms.txt and the static site into docs/build/
pnpm run start      # dev server with hot reload
```

Check all the ` ```latent ` examples in the documentation with the compiler:

```bash
node docs/scripts/validate-examples.mjs
```

Dependencies for the docs are installed with pnpm; `npm install` is not used.
The `docs/node_modules` directory is not committed to git.

## 6. The playground locally

The playground is a copy of `web-ide/` in `docs/static/playground/`, which
`scripts/sync-playground.mjs` makes when the site is built. To run it without
Docusaurus:

```bash
cd web-ide
python3 -m http.server 8000
# open http://localhost:8000
```

Important: you cannot open `web-ide/index.html` as `file://` — the browser will
block loading `compiler.wasm`; you need an HTTP server.

## Common problems

| Symptom | Cause and solution |
|---|---|
| `error: linker 'link.exe' not found` (Windows) | No MSVC — build with `stable-x86_64-pc-windows-gnu` |
| `error[E0463]: can't find crate for 'std'` during a wasm build | The target is not installed: `rustup target add wasm32-unknown-unknown` |
| `web-ide/compiler.wasm` is missing | Engine #2 is not built; the IDE will stay on engine #1 |
| docs: `onBrokenLinks` fails | A broken internal link; use relative links to `.md` |
| `validate-examples` fails | An invalid `latent` block appeared in the documentation — see the message |

Next: [Hello, world](./hello-world.md) → [CLI](./cli.md) →
[Web IDE](./web-ide.mdx).
