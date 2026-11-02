---
title: "MCP documentation server"
sidebar_label: MCP
sidebar_position: 4
description: "How to connect the Latent documentation MCP server (mcp/docs-mcp) to Claude Desktop, Cursor, and VS Code: stdio and Streamable HTTP, the list of tools/resources/prompts, and request examples."
---

# MCP documentation server (`mcp/docs-mcp`)

The MCP server gives neural networks access to this documentation and to the
real Latent compiler: a list of pages, full-text search, reading, an aggregated
reference, examples, and code checking. Zero dependencies: only Node.js ≥ 18 and
the stdlib.

Directory: `mcp/docs-mcp/`. Entry point: `bin/server.mjs`.

## Quick start

```bash
# stdio (for IDEs/desktop clients)
node mcp/docs-mcp/bin/server.mjs --stdio

# HTTP (for curl, a browser, remote clients)
node mcp/docs-mcp/bin/server.mjs --http --port 8765
# then: POST/GET/DELETE http://127.0.0.1:8765/mcp
#        GET /health, GET / (HTML landing page)
```

`--help` prints the full help. `--version` prints the server version.

### Flags

| Flag | Meaning |
|---|---|
| `--stdio` / `--http` | transport (exactly one is required) |
| `--port <n>` | HTTP port (default `8765`; `0` — a random one) |
| `--host <addr>` | listen address (default `127.0.0.1`) |
| `--stateless` | do not require `initialize` before tools/resources calls |
| `--docs <path>` | documentation directory (default `<repo>/docs/docs`) |
| `--wasm <path>` | `compiler.wasm` (default `<repo>/web-ide/compiler.wasm`) |
| `--repo <path>` | repository root (for the examples) |
| `--help`, `-h` / `--version`, `-v` | help/version |

Environment variables: `LATENT_DOCS_PATH`, `LATENT_COMPILER_WASM`.
Diagnostics of the stdio transport go **to stderr** — stdout is reserved for
JSON-RPC.

## Tools

| Name | Input | Output |
|---|---|---|
| `list_docs` | `{}` | `{ docs: [{ path, title, description, section }] }` |
| `search_docs` | `{ query: string, limit?: 1..50 }` | `{ results: [{ path, title, score, snippet }] }` |
| `read_doc` | `{ path: string }` | `{ path, title, content }` (the full Markdown) |
| `get_language_reference` | `{ topic?: "grammar"\|"types"\|"operators"\|"builtins"\|"errors"\|"abi"\|"all" }` | aggregated Markdown from `reference/` |
| `get_example` | `{ id?: string }` | `{ id, title, code }` or the list of examples |
| `check_code` | `{ code: string }` | `{ ok: boolean, errors: [{ message, line, column }] }` |

Specifics:

- `search_docs` ranks the title/description/tags/section headings/text, is
  case-insensitive, accounts for word forms, and returns snippets.
- `get_example` takes the examples from `web-ide/examples/` (plus the markdown
  walkthroughs from `docs/docs/examples/`).
- `check_code` compiles with the Rust compiler (`web-ide/compiler.wasm`) through
  the `latent_alloc/latent_compile` ABI; the code is **not executed**. Errors are
  parsed out of text of the form `... на строке L:C` into
  `{ message, line, column }`. If the `wasm` is unavailable, the tool returns an
  error with an explanation and the server keeps running.
- The tools are marked `readOnlyHint: true` (except `check_code` — also
  read-only, but with compilation).

## Resources

- `latent-docs://index` — the table of contents of the whole documentation.
- `latent-docs://<path>` — any page, for example
  `latent-docs://reference/grammar.md` (MIME `text/markdown`).
- templates: `latent-docs://{path}` and `latent-docs://reference/{topic}.md`.

## Prompts

| Name | Arguments | Purpose |
|---|---|---|
| `explain_syntax` | `topic` (required) | explain a construct based on the documentation |
| `write_program` | `task` (required), `constraints` (optional) | write a program for a task |
| `debug_program` | `code` (required), `error` (optional) | analyze an error or behavior |

The prompts are **dynamic**: they are filled with excerpts from the real
documentation (a search over the index), the list of examples, and hints about
which tools/resources to call. The maximum size of the excerpts is ~4200
characters.

## HTTP protocol

Streamable HTTP (MCP 2025-06-18), JSON-RPC 2.0:

| Method/path | Behavior |
|---|---|
| `POST /mcp` | JSON-RPC request(s); `Content-Type: application/json`; a JSON response, or `202` for notifications; in stateful mode it issues `Mcp-Session-Id` |
| `GET /mcp` | an SSE stream (`Accept: text/event-stream`), heartbeat every 15 s |
| `DELETE /mcp` | end the session (`Mcp-Session-Id`) |
| `GET /health` | status: name/version, docs root, document count, sessions, uptime |
| `GET /` | an HTML landing page with hints |
| `OPTIONS *` | CORS preflight |

- The maximum size of a JSON-RPC body is 1 MiB (otherwise 413).
- CORS: `Access-Control-Allow-Origin: *`.
- The supported protocol versions come from `SUPPORTED_PROTOCOL_VERSIONS`
  (`src/handlers.mjs`); an unsupported version in the `MCP-Protocol-Version`
  header → 400.
- Without `--stateless`, only `initialize`, `ping`, `shutdown` are allowed before
  `initialize`; otherwise 400 `ServerNotInitialized`.

### curl examples

```bash
# health
curl -s http://127.0.0.1:8765/health | jq

# initialize (stateless mode — no session)
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# list the tools
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# check code
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_code","arguments":{"code":"fn main() -> int { return 42; }"}}}'
```

## Connecting clients

### Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "latent-docs": {
      "command": "node",
      "args": [
        "C:/Users/Admin/IdeaProjects/latent/mcp/docs-mcp/bin/server.mjs",
        "--stdio",
        "--docs",
        "C:/Users/Admin/IdeaProjects/latent/docs/docs"
      ]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project (or the global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "latent-docs": {
      "command": "node",
      "args": ["mcp/docs-mcp/bin/server.mjs", "--stdio"],
      "cwd": "C:/Users/Admin/IdeaProjects/latent"
    }
  }
}
```

Or an HTTP connection (if the client supports Streamable HTTP):
`http://127.0.0.1:8765/mcp`.

### VS Code (MCP extension/client)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "latent-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp/docs-mcp/bin/server.mjs", "--stdio"]
    }
  }
}
```

or `"type": "http", "url": "http://127.0.0.1:8765/mcp"`.

## Verification

```bash
node --test "mcp/docs-mcp/test/*.test.mjs"     # 300 tests, 0 failures
```

The tests cover `initialize`, `tools/list`, `tools/call` (including
`check_code`), `resources/list|read`, `prompts/list|get`, the HTTP transport (a
run on port 0), search, error parsing, the documentation index, and the examples.

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/mcp -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Limitations

- The index is built from `docs/docs/**/*.md` with front matter (`title`,
  `description`); pages without a title get a heading from the file name.
- If the documentation is unavailable, the server starts with an empty index and
  a warning on stderr.
- `check_code` depends on `web-ide/compiler.wasm` being present; the path can be
  set with `--wasm`/`LATENT_COMPILER_WASM`. The shipped artifact is up to date
  (built from the current `src/`), so `check_code` understands the same
  constructs as engine #2 in the IDE, memory builtins included.

## Related sections

- [Web IDE](./web-ide.md) · [VS Code](./vscode.md) ·
  [IntelliJ IDEA](./idea.md)
- [Reference](../reference/index.md) — what `get_language_reference` returns.
- [Examples](../examples/index.md) — what `get_example` returns.
