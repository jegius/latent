---
title: "VS Code: the Latent extension"
sidebar_label: VS Code
sidebar_position: 2
description: "Installing and building the editors/vscode extension: features (highlighting, snippets, LSP, compilation, running), commands, keyboard shortcuts, settings, .vsix."
---

# VS Code: the Latent extension

The `editors/vscode` extension is plain JavaScript **with no build step** (no
webpack/esbuild): it is enough to open the folder and press F5, or to package a
`.vsix`. Identifier: `latent-lang`, publisher `jegius`.

## Installation

### From source (F5)

1. Open `editors/vscode` in VS Code.
2. `F5` (Run Extension) — an Extension Development Host window opens with
   `.lat` support.
3. The language needs a `latent` file — create `main.lat`:

```latent
fn main() -> int {
    print("hello from VS Code");
    return 0;
}
```

### Building the `.vsix`

```bash
cd editors/vscode
npx @vscode/vsce package --no-dependencies
code --install-extension latent-lang-1.0.0.vsix   # the name comes from the name field in package.json
```

Only Node.js is needed for the build (there are no dependencies).

### A ready-made `.vsix`

The repository contains an already built archive
`editors/vscode/latent-1.0.0.vsix` (36,095 bytes) — it can be installed right away:

```bash
code --install-extension editors/vscode/latent-1.0.0.vsix
# or: Extensions → … → Install from VSIX…
```

## Features

| Feature | How it works |
|---|---|
| The `latent` language for `.lat` | `contributes.languages`, brackets/comments configuration |
| Syntax highlighting | the TextMate grammar `syntaxes/latent.tmLanguage.json` (keywords, types, strings/escapes, numbers, comments, operators, `@` annotations, AI primitives) |
| Snippets | `snippets/latent.json`: `fn`, `let`, `if`, `ifelse`, `while`, `for`, `forin`, `match`, `class`, `enum`, `lambda`, `test`, `spawn`, `select`, … |
| LSP client | `src/lsp-client.js` → `tooling/latent-lsp` (stdio): diagnostics, completion, hover, signature help, formatting, document symbols, definition |
| Diagnostics | from the LSP (`publishDiagnostics`) and/or from the compiler; turned on/off by a setting |
| Compilation | `Latent: Скомпилировать в WASM` — via `latentc` (if found) or `web-ide/compiler.wasm`; the result is a `.wasm` file next to the source file |
| Run | `Latent: Запустить` — compiles and runs the WASM in Node with `env.print`; the output goes to the Output Channel |
| Formatting | LSP `documentFormatting` (the same algorithm as in the web IDE) and "format on save" |
| Documentation | `Latent: Открыть документацию` — the documentation site; `Latent: Открыть Playground` — `/playground/` (the web IDE) |
| LSP restart | `Latent: Перезапустить LSP-сервер` |

If the LSP server or `compiler.wasm` are not found, the extension keeps working
without them (highlighting and snippets remain; Run degrades with a clear
message).

## Commands and keyboard shortcuts

The command palette titles still come from `package.json` and are in Russian; the
table quotes them verbatim.

| Command | Keys | What it does |
|---|---|---|
| `Latent: Запустить` (`latent.run`) | `Ctrl+Alt+R` / `Cmd+Alt+R` | compile + run the WASM |
| `Latent: Скомпилировать в WASM` (`latent.compile`) | `Ctrl+Alt+C` / `Cmd+Alt+C` | compile only |
| `Latent: Проверить` (`latent.check`) | `Ctrl+Alt+K` / `Cmd+Alt+K` | check without writing |
| `Latent: Форматировать документ` (`latent.format`) | `Ctrl+Alt+F` / `Cmd+Alt+F` | formatting |
| `Latent: Открыть документацию` (`latent.openDocs`) | `Ctrl+Alt+D` / `Cmd+Alt+D` | the documentation site |
| `Latent: Открыть Playground` (`latent.openPlayground`) | `Ctrl+Alt+P` / `Cmd+Alt+P` | the web IDE |
| `Latent: Перезапустить LSP-сервер` (`latent.restartLsp`) | `Ctrl+Alt+Shift+R` / `Cmd+Alt+Shift+R` | restart the LSP |

Run/Compile buttons are also added to the editor title (`editor/title`) and to
the context menu for `.lat` files.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `latent.latentcPath` | `""` | path to `latentc`; empty — `<repo>/target/debug/latentc.exe` (Windows) / `latentc` (Linux/macOS), then `PATH` |
| `latent.nodePath` | `""` | Node.js for the LSP and `.mjs`; empty — the Node that launched VS Code, otherwise `node` from `PATH` |
| `latent.lspServerPath` | `""` | path to `tooling/latent-lsp/bin/server.mjs`; empty — the path next to the repository |
| `latent.compilerWasmPath` | `""` | path to `compiler.wasm`; empty — `<repo>/web-ide/compiler.wasm` |
| `latent.enableDiagnostics` | `true` | diagnostics in the Problems panel and underlining |
| `latent.enableLsp` | `true` | start the LSP server |
| `latent.formatOnSave` | `false` | format on save through the LSP |

## How it works

```text
editors/vscode/
  package.json                 contributes: languages/grammars/snippets/commands/configuration
  language-configuration.json  brackets, comments, auto-closing
  syntaxes/latent.tmLanguage.json
  snippets/latent.json
  src/extension.js             activation, commands, diagnostics, running
  src/lsp-client.js            a minimal LSP client (stdio JSON-RPC)
  src/runner.js                latentc / compiler.wasm → .wasm → run in Node
  src/docs.js                  links to the documentation and the playground
  images/icon.png
  latent-1.0.0.vsix            the built archive of the extension
  README.md, CHANGELOG.md, LICENSE, .vscodeignore
  test/*.test.mjs              package/grammar/snippets/lsp-client/runner/docs
```

- All commands are registered in `package.json` (`contributes.commands`) and are
  activated by `onLanguage:latent` / `onCommand:...`.
- The LSP client spawns `node tooling/latent-lsp/bin/server.mjs --stdio`; the
  path comes from the settings/repository. If the server is not found, the LSP is
  switched off and the other features keep working.
- Running WASM works as in the [CLI](../reference/cli.md#running-the-produced-wasm-in-node):
  the `env.print(i32)` import reads `[len][utf8]` from memory, then the `main`
  export is called.

## Verification

```bash
cd editors/vscode
node --check src/extension.js
node --test "test/*.test.mjs"        # 70 tests, 0 failures
```

The tests check the JSON contributions, the presence of the snippets/keywords
from `tooling/language-data/language.json`, diagnostics parsing, the LSP client
against a fake server, and the runner on a valid and on a broken program. Line
coverage is **98.77%** (according to the report produced when the extension is
built). The built archive is `latent-1.0.0.vsix`.

## Limitations

- Highlighting is TextMate (not semantic); full navigation depends on the LSP
  server.
- The compiler is the "pure subset" of Latent (engine #2): AI/channels/tensors do
  not compile into `.wasm` (a host runtime error).
- Without `latentc`, compilation goes through `compiler.wasm` — the quality of the
  diagnostics is the same as that of engine #2.
- Running requires Node.js; the WASM executes outside the VS Code process
  (through `node`).

## Related sections

- The LSP server — `tooling/latent-lsp` (the tests are run as described in
  [bootstrap](./bootstrap.md#5-full-check-suite)).
- [Web IDE](./web-ide.md) · [IntelliJ IDEA](./idea.md) · [MCP](./mcp.md)
- [CLI](../reference/cli.md) — running WASM in Node.
