---
title: "MCP-сервер документации"
description: "Как подключить MCP-сервер документации Latent (mcp/docs-mcp) к Claude Desktop, Cursor и VS Code: stdio и Streamable HTTP, список tools/resources/prompts, примеры запросов."
sidebar_position: 4
---

# MCP-сервер документации (`mcp/docs-mcp`)

MCP-сервер даёт нейросетям доступ к этой документации и к настоящему
компилятору Latent: список страниц, полнотекстовый поиск, чтение, агрегированный
справочник, примеры и проверку кода. Zero-dependencies: только Node.js ≥ 18 и
stdlib.

Каталог: `mcp/docs-mcp/`. Точка входа: `bin/server.mjs`.

## Быстрый старт

```bash
# stdio (для IDE/десктопных клиентов)
node mcp/docs-mcp/bin/server.mjs --stdio

# HTTP (для curl, браузера, удалённых клиентов)
node mcp/docs-mcp/bin/server.mjs --http --port 8765
# тогда: POST/GET/DELETE http://127.0.0.1:8765/mcp
#        GET /health, GET / (HTML-лендинг)
```

`--help` печатает полную справку. `--version` — версию сервера.

### Флаги

| Флаг | Значение |
|---|---|
| `--stdio` / `--http` | транспорт (обязательно один) |
| `--port <n>` | порт HTTP (по умолчанию `8765`; `0` — случайный) |
| `--host <addr>` | адрес прослушивания (по умолчанию `127.0.0.1`) |
| `--stateless` | не требовать `initialize` до вызовов tools/resources |
| `--docs <path>` | каталог документации (по умолчанию `<repo>/docs/docs`) |
| `--wasm <path>` | `compiler.wasm` (по умолчанию `<repo>/web-ide/compiler.wasm`) |
| `--repo <path>` | корень репозитория (для примеров) |
| `--help`, `-h` / `--version`, `-v` | справка/версия |

Переменные окружения: `LATENT_DOCS_PATH`, `LATENT_COMPILER_WASM`.
Диагностика stdio-транспорта идёт **в stderr** — stdout занят JSON-RPC.

## Инструменты (tools)

| Имя | Вход | Выход |
|---|---|---|
| `list_docs` | `{}` | `{ docs: [{ path, title, description, section }] }` |
| `search_docs` | `{ query: string, limit?: 1..50 }` | `{ results: [{ path, title, score, snippet }] }` |
| `read_doc` | `{ path: string }` | `{ path, title, content }` (полный Markdown) |
| `get_language_reference` | `{ topic?: "grammar"\|"types"\|"operators"\|"builtins"\|"errors"\|"abi"\|"all" }` | агрегированный Markdown из `reference/` |
| `get_example` | `{ id?: string }` | `{ id, title, code }` или список примеров |
| `check_code` | `{ code: string }` | `{ ok: boolean, errors: [{ message, line, column }] }` |

Особенности:

- `search_docs` ранжирует заголовок/описание/теги/заголовки разделов/текст,
  регистронезависим, учитывает словоформы, выдаёт сниппеты.
- `get_example` берёт примеры из `web-ide/examples/` (+ markdown-разборы из
  `docs/docs/examples/`).
- `check_code` компилирует Rust-компилятором (`web-ide/compiler.wasm`) через
  ABI `latent_alloc/latent_compile`; код **не исполняется**. Ошибки парсятся из
  текста вида `... на строке L:C` в `{ message, line, column }`. Если `wasm`
  недоступен — инструмент вернёт ошибку с пояснением, сервер продолжит работу.
- Инструменты помечены `readOnlyHint: true` (кроме `check_code` — тоже
  read-only, но с компиляцией).

## Ресурсы (resources)

- `latent-docs://index` — оглавление всей документации.
- `latent-docs://<path>` — любая страница, например
  `latent-docs://reference/grammar.md` (MIME `text/markdown`).
- шаблоны: `latent-docs://{path}` и `latent-docs://reference/{topic}.md`.

## Промпты (prompts)

| Имя | Аргументы | Назначение |
|---|---|---|
| `explain_syntax` | `topic` (обязателен) | объяснить конструкцию с опорой на документацию |
| `write_program` | `task` (обязателен), `constraints` (опц.) | написать программу под задачу |
| `debug_program` | `code` (обязателен), `error` (опц.) | разобрать ошибку/поведение |

Промпты **динамические**: в них подставляются выдержки из реальной
документации (поиск по индексу), список примеров и подсказки, какие
tools/resources вызвать. Максимальный объём выдержек — ~4200 символов.

## HTTP-протокол

Streamable HTTP (MCP 2025-06-18), JSON-RPC 2.0:

| Метод/путь | Поведение |
|---|---|
| `POST /mcp` | JSON-RPC запрос(ы); `Content-Type: application/json`; ответ JSON или `202` для нотификаций; для stateful-режима выдаёт `Mcp-Session-Id` |
| `GET /mcp` | SSE-поток (`Accept: text/event-stream`), heartbeat каждые 15 с |
| `DELETE /mcp` | завершить сессию (`Mcp-Session-Id`) |
| `GET /health` | статус: имя/версия, docs root, число документов, сессии, uptime |
| `GET /` | HTML-лендинг с подсказками |
| `OPTIONS *` | CORS preflight |

- Максимальный размер JSON-RPC тела — 1 МиБ (иначе 413).
- CORS: `Access-Control-Allow-Origin: *`.
- Поддерживаемые версии протокола — из `SUPPORTED_PROTOCOL_VERSIONS`
  (`src/handlers.mjs`); неподдерживаемая версия в заголовке
  `MCP-Protocol-Version` → 400.
- Без `--stateless` до `initialize` разрешены только `initialize`, `ping`,
  `shutdown`; иначе 400 `ServerNotInitialized`.

### Примеры curl

```bash
# health
curl -s http://127.0.0.1:8765/health | jq

# initialize (stateless-режим — без сессии)
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# список инструментов
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# проверка кода
curl -s -X POST http://127.0.0.1:8765/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_code","arguments":{"code":"fn main() -> int { return 42; }"}}}'
```

## Подключение к клиентам

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

`.cursor/mcp.json` в проекте (или глобальный `~/.cursor/mcp.json`):

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

Либо HTTP-подключение (если клиент умеет Streamable HTTP):
`http://127.0.0.1:8765/mcp`.

### VS Code (MCP-расширение/клиент)

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

или `"type": "http", "url": "http://127.0.0.1:8765/mcp"`.

## Проверка

```bash
node --test "mcp/docs-mcp/test/*.test.mjs"     # 300 тестов, 0 падений
```

Тесты покрывают `initialize`, `tools/list`, `tools/call` (включая
`check_code`), `resources/list|read`, `prompts/list|get`, HTTP-транспорт
(запуск на порту 0), поиск, парсинг ошибок, индекс документации и примеры.

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/mcp -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Ограничения

- Индекс строится из `docs/docs/**/*.md` с front matter (`title`,
  `description`); страницы без title получают заголовок из имени файла.
- Если документация недоступна, сервер стартует с пустым индексом и
  предупреждением в stderr.
- `check_code` зависит от наличия `web-ide/compiler.wasm`; путь можно задать
  `--wasm`/`LATENT_COMPILER_WASM`. Поставляемый артефакт актуален (собран из
  текущего `src/`), поэтому `check_code` понимает те же конструкции, что и
  движок №2 в IDE, включая memory-builtins.

## Связанные разделы

- [Web IDE](./web-ide.md) · [VS Code](./vscode.md) ·
  [IntelliJ IDEA](./idea.md)
- [Справочник](../reference/index.md) — то, что отдаёт `get_language_reference`.
- [Примеры](../examples/index.md) — то, что отдаёт `get_example`.
