# latent-docs-mcp — MCP-сервер документации языка Latent

MCP-сервер (Model Context Protocol) даёт AI-агентам доступ к документации языка
**Latent**: поиск по страницам, чтение Markdown, справочник по грамматике/типам/
операторам/builtins/ошибкам/ABI, готовые примеры и **проверку кода** настоящим
Rust-компилятором, собранным в WebAssembly.

- Node.js **>= 18**, **ноль внешних зависимостей** — только стандартная библиотека.
- ESM (`.mjs`), комментарии и сообщения — по-русски, идентификаторы — по-английски.
- Транспорты: **stdio** и **Streamable HTTP**.
- Работает из корня репозитория и по абсолютному пути; каталог документации
  определяется от расположения самого сервера, а не от текущего каталога.
- Сервер **read-only**: он только читает Markdown и компилирует код (не исполняет).
- Контракт зафиксирован в `latent-work/PLAN.md` (раздел «Контракт MCP-сервера»).

```
mcp/docs-mcp/
  bin/server.mjs        точка входа --stdio | --http
  src/
    core.mjs            сборка: индекс + примеры + компилятор + диспетчер
    handlers.mjs        MCP-методы (initialize, tools/resources/prompts, ping, shutdown)
    jsonrpc.mjs         JSON-RPC 2.0: коды ошибок, ответы, RpcError
    docs-index.mjs      обход docs/docs/**/*.md, front matter, разделы, оглавление
    markdown.mjs        минимальный разбор Markdown/YAML (front matter, заголовки)
    search.mjs          токенизация, ранжирование, сниппеты
    tool-defs.mjs       JSON-схемы шести инструментов (tools/list)
    tools.mjs           реализация list_docs/search_docs/read_doc/.../check_code
    resources.mjs       latent-docs://index и latent-docs://<path>
    prompts.mjs         explain_syntax / write_program / debug_program
    compiler.mjs        C-ABI latent_alloc/latent_compile → {ok, errors}
    examples.mjs        примеры из web-ide/examples + docs/examples
    paths.mjs           корень репозитория, --docs/--wasm, переменные окружения
    sessions.mjs        Mcp-Session-Id для Streamable HTTP
    http.mjs            HTTP-сервер и маршруты /, /health, /mcp
    http-mcp.mjs        семантика /mcp: POST/GET(SSE)/DELETE, сессии
    http-util.mjs       CORS, JSON/HTML-ответы, чтение тела
    http-cors.mjs       CORS-политика
    landing.mjs         HTML-лендинг с инструкциями подключения
    stdio.mjs           Content-Length-фрейминг + NDJSON
    version.mjs         serverInfo name/version
  test/*.test.mjs       node:test, фикстуры в test/fixtures/docs
  README.md
```

## Быстрый старт

Требуется только Node.js 18+. Из корня репозитория:

```bash
# stdio (для Claude Desktop, Claude Code, Cursor, VS Code)
node mcp/docs-mcp/bin/server.mjs --stdio

# Streamable HTTP: http://127.0.0.1:8765/mcp
node mcp/docs-mcp/bin/server.mjs --http --port 8765

# HTTP без обязательного initialize (stateless-режим)
node mcp/docs-mcp/bin/server.mjs --http --port 8765 --stateless
```

При HTTP-запуске сервер печатает готовые адреса:

```
latent-docs 1.0.0 — MCP-сервер документации Latent
transport: http
url:       http://127.0.0.1:8765/mcp
health:    http://127.0.0.1:8765/health
landing:   http://127.0.0.1:8765/
docs:      C:\Users\Admin\IdeaProjects\latent\docs\docs
documents: 64
mode:      sessions (Mcp-Session-Id)
```

Откройте `http://127.0.0.1:8765/` — там HTML-лендинг с примерами конфигураций
для всех клиентов, списком инструментов и curl-примерами.

### Флаги CLI

| Флаг | Значение по умолчанию | Описание |
|---|---|---|
| `--stdio` | — | stdio-транспорт (Content-Length-фрейминг, NDJSON тоже принимается) |
| `--http` | — | Streamable HTTP транспорт |
| `--port <n>` | `8765` | Порт HTTP (0 — случайный свободный) |
| `--host <addr>` | `127.0.0.1` | Адрес прослушивания |
| `--stateless` | выкл. | Не требовать `initialize` до tools/resources/prompts |
| `--docs <path>` | `<repo>/docs/docs` | Каталог документации |
| `--wasm <path>` | `<repo>/web-ide/compiler.wasm` | Компилятор для `check_code` |
| `--repo <path>` | вычисляется от файла сервера | Корень репозитория (примеры и wasm) |
| `--help`, `--version` | — | Справка / версия |

Переменные окружения: `LATENT_DOCS_PATH`, `LATENT_COMPILER_WASM` (флаги важнее).

## Подключение к клиентам

### Claude Desktop

Файл:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "latent-docs": {
      "command": "node",
      "args": [
        "C:/path/to/latent/mcp/docs-mcp/bin/server.mjs",
        "--stdio"
      ]
    }
  }
}
```

Перезапустите Claude Desktop. В списке инструментов появятся `list_docs`,
`search_docs`, `read_doc`, `get_language_reference`, `get_example`, `check_code`,
а также ресурсы `latent-docs://...` и промпты.

### Claude Code

```bash
claude mcp add --transport stdio latent-docs -- node C:/path/to/latent/mcp/docs-mcp/bin/server.mjs --stdio
```

Либо HTTP-вариант (если сервер уже запущен):

```bash
claude mcp add --transport http latent-docs http://127.0.0.1:8765/mcp
```

Проверка: `claude mcp list` / `/mcp` внутри сессии.

### Cursor

Файл `~/.cursor/mcp.json` (глобально) или `.cursor/mcp.json` в проекте:

```json
{
  "mcpServers": {
    "latent-docs": {
      "command": "node",
      "args": ["C:/path/to/latent/mcp/docs-mcp/bin/server.mjs", "--stdio"]
    }
  }
}
```

Для удалённого HTTP-сервера:

```json
{
  "mcpServers": {
    "latent-docs": {
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

### VS Code (GitHub Copilot / MCP-расширения)

Файл `.vscode/mcp.json` в проекте:

```json
{
  "servers": {
    "latent-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/latent/mcp/docs-mcp/bin/server.mjs", "--stdio"]
    },
    "latent-docs-http": {
      "type": "http",
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

### Другие клиенты

- HTTP-URL: `http://127.0.0.1:8765/mcp`
- Health: `http://127.0.0.1:8765/health`
- Лендинг: `http://127.0.0.1:8765/`

## Инструменты (tools)

| Tool | Аргументы | Результат |
|---|---|---|
| `list_docs` | `{}` | `{docs:[{path,title,description,section}]}` |
| `search_docs` | `{query:string, limit?:int}` | `{results:[{path,title,score,snippet}]}` |
| `read_doc` | `{path:string}` | `{path,title,content}` — полный Markdown |
| `get_language_reference` | `{topic?:"grammar"\|"types"\|"operators"\|"builtins"\|"errors"\|"abi"\|"all"}` | агрегированный Markdown из `reference/*` |
| `get_example` | `{id?:string}` | `{id,title,code}` (без `id` — список примеров) |
| `check_code` | `{code:string}` | `{ok:boolean, errors:[{message,line,column}]}` |

Особенности:

- Ответы инструментов содержат `content: [{type:"text", text}]` и
  `structuredContent` с теми же данными в машиночитаемом виде.
- `search_docs`: регистронезависимый поиск с учётом словоформ (префиксное
  сравнение основ). Веса: заголовок > description > теги > заголовки разделов >
  тело. Сниппет содержит контекст и подсветку `**термин**`. `limit` — 1..50.
- `read_doc` и `resources/read` нормализуют путь (`./`, `\`, регистр) и **не
  выпускают за пределы каталога документации**; неизвестный путь — `isError`
  с подсказкой похожих страниц.
- `check_code`: компиляция через `web-ide/compiler.wasm` (C-ABI
  `latent_alloc`/`latent_compile` из `src/lib.rs`). Код **не исполняется**.
  Ошибки парсятся из русских сообщений «… на строке L:C» в
  `{message,line,column}`. Если wasm отсутствует — `isError` с понятным текстом
  и подсказкой `--wasm` / `LATENT_COMPILER_WASM`. Лимит исходника — 128 КиБ.
- Неверные аргументы — ошибка JSON-RPC `-32602` (InvalidParams);
  ошибки выполнения (нет страницы, нет wasm) — `result.isError: true`.

### Пример: tools/call

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"search_docs","arguments":{"query":"массивы push pop","limit":5}}}
```

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call",
 "params":{"name":"check_code","arguments":{"code":"fn main() -> int { return 42; }"}}}
```

## Ресурсы (resources)

- `latent-docs://index` — оглавление всей документации (Markdown).
- `latent-docs://<relative-path.md>` — каждая страница, например
  `latent-docs://guide/variables.md`, `latent-docs://reference/grammar.md`.
  MIME-тип — `text/markdown`.
- `resources/templates/list` отдаёт шаблоны:
  `latent-docs://{path}` и `latent-docs://reference/{topic}.md`.

`resources/read` возвращает содержимое страницы (без front matter); неизвестный
URI — ошибка `-32602`.

## Промпты (prompts)

| Prompt | Аргументы | Что делает |
|---|---|---|
| `explain_syntax` | `topic` (обяз.) | объяснить конструкцию по документации |
| `write_program` | `task` (обяз.), `constraints` | написать программу по задаче + примеры |
| `debug_program` | `code` (обяз.), `error` | разобрать ошибку, дать исправление |

Промпты **не статичны**: при `prompts/get` сервер ищет релевантные страницы по
индексу, вставляет выдержки (с путями `latent-docs://...`), подсказывает, какие
tools/resources вызвать, а `write_program` дополнительно подставляет список
готовых примеров. Пример:

```json
{"jsonrpc":"2.0","id":5,"method":"prompts/get",
 "params":{"name":"explain_syntax","arguments":{"topic":"каналы и spawn"}}}
```

## Транспорты

### stdio

`--stdio`: JSON-RPC сообщения в stdin/stdout, **Content-Length-фрейминг**:

```
Content-Length: 123\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize",...}
```

Дополнительно принимается **NDJSON** (одно сообщение на строку — текущая
редакция MCP stdio). Диагностика пишется только в stderr. Сообщения
обрабатываются последовательно; уведомление `exit` (или EOF stdin) завершает
процесс с кодом 0. `shutdown` (запрос) возвращает `null`; `notifications/initialized`
отмечает сессию инициализированной — оба метода поддерживаются для совместимости
с разными клиентами. По HTTP `shutdown`/`exit` сервер не останавливают:
остановка — SIGINT/SIGTERM, а завершение сессии — `DELETE /mcp`.

Поддерживаемые версии протокола: `2025-06-18` (предпочтительная),
`2025-03-26`, `2024-11-05`; неизвестная версия согласуется на `2025-06-18`.

### Streamable HTTP

| Метод и путь | Назначение |
|---|---|
| `POST /mcp` | JSON-RPC запрос/уведомление. `initialize` создаёт сессию (`Mcp-Session-Id`) |
| `GET /mcp` | SSE-поток с heartbeat (`: keep-alive`); требуется `Accept: text/event-stream` |
| `DELETE /mcp` | завершить сессию (`Mcp-Session-Id`) |
| `GET /health` | `{status:"ok", name, version, docs:{root,count,sections}, sessions, uptimeSeconds}` |
| `GET /` | HTML-лендинг с инструкциями подключения |
| `OPTIONS *` | CORS preflight (204) |
| прочее | 404 / 405 с пояснением и заголовком `Allow` |

Семантика по спецификации MCP 2025-06-18:

- Default-режим — **сессии**: `initialize` возвращает заголовок
  `Mcp-Session-Id`; последующие POST обязаны его передавать. Запрос
  `tools/list` (и любой не-`ping`/не-`shutdown`) **до** initialize без сессии
  получает **HTTP 400** и JSON-RPC ошибку `-32002` («Сервер не инициализирован»).
  Неизвестная/завершённая сессия — **HTTP 404** и `-32001`.
- `--stateless` — `initialize` не обязателен (сервер не ведёт сессий и не
  выдаёт `Mcp-Session-Id`). Удобно для простых HTTP-клиентов.
- Уведомления (без `id`) получают **202 Accepted** с пустым телом.
- Неверный JSON — 400 + `-32700`; неверный `Content-Type` — 415;
  неподдерживаемая версия в `MCP-Protocol-Version` — 400.
- CORS: `Access-Control-Allow-Origin: *`, `Mcp-Session-Id` в
  `Access-Control-Expose-Headers` (browser-клиенты и web IDE могут обращаться
  к локальному серверу).

## curl-примеры

```bash
# Health
curl -s http://127.0.0.1:8765/health

# initialize (запомните Mcp-Session-Id из заголовков ответа)
curl -si http://127.0.0.1:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list с сессией
curl -s http://127.0.0.1:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# search_docs
curl -s http://127.0.0.1:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_docs","arguments":{"query":"массивы push pop","limit":5}}}'

# check_code
curl -s http://127.0.0.1:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"check_code","arguments":{"code":"fn main() -> int { return 42; }"}}}'

# SSE-поток (Ctrl+C для выхода)
curl -N -H "Accept: text/event-stream" http://127.0.0.1:8765/mcp

# stateless: без initialize
node mcp/docs-mcp/bin/server.mjs --http --port 8765 --stateless
curl -s http://127.0.0.1:8765/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Тесты

```bash
node --test "mcp/docs-mcp/test/*.test.mjs"
```

Покрыто: разбор front matter и индексация, поиск/ранжирование/сниппеты,
initialize/capabilities, `tools/list` (все 6), вызовы инструментов (включая
валидный и битый код через настоящий `compiler.wasm`), resources
(list/templates/read), prompts (list/get для трёх шаблонов), JSON-RPC-ошибки
(`-32601`, `-32602`, `-32600`), HTTP-транспорт (initialize, сессии, stateless,
`/health`, лендинг, 404/405, CORS, SSE, DELETE, close) и stdio
(Content-Length, NDJSON, EOF, exit, флаги CLI, HTTP-сервер на порту 0 с
остановкой по SIGTERM).

Тесты используют собственные фикстуры `test/fixtures/docs/**`, поэтому зелёные
даже при неполной реальной документации; смоук-тесты на реальном
`docs/docs` и `web-ide/compiler.wasm` выполняются, если файлы существуют.

## Деплой и публикация

Сервер не имеет зависимостей, поэтому «деплой» — это запуск `bin/server.mjs`
на машине с Node.js 18+ и каталогом документации.

### systemd (Linux, за reverse proxy)

```ini
# /etc/systemd/system/latent-docs-mcp.service
[Unit]
Description=Latent docs MCP server
After=network.target

[Service]
WorkingDirectory=/opt/latent
ExecStart=/usr/bin/node /opt/latent/mcp/docs-mcp/bin/server.mjs \
  --http --host 127.0.0.1 --port 8765 --docs /opt/latent/docs/docs
Restart=on-failure
User=latent

[Install]
WantedBy=multi-user.target
```

### nginx (TLS + basic-auth, наружу только через прокси)

```nginx
server {
    listen 443 ssl;
    server_name docs-mcp.example.com;

    ssl_certificate     /etc/letsencrypt/live/docs-mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docs-mcp.example.com/privkey.pem;

    location /mcp {
        proxy_pass http://127.0.0.1:8765/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;          # важно для SSE
        proxy_read_timeout 3600s;
    }

    location /health {
        proxy_pass http://127.0.0.1:8765/health;
    }
}
```

**Не публикуйте сервер наружу без reverse proxy и авторизации:** CORS открыт
(`*`), а данные — локальная документация.

### Docker (по желанию)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY mcp/docs-mcp ./mcp/docs-mcp
COPY docs/docs ./docs/docs
EXPOSE 8765
CMD ["node", "mcp/docs-mcp/bin/server.mjs", "--http", "--host", "0.0.0.0", "--port", "8765"]
```

Замечание про индексацию: индекс документации строится при старте. После
обновления Markdown-файлов перезапустите сервер (или запускайте его в
dev-режиме через супервизор).

## Безопасность

- **Только чтение**: сервер не изменяет файлы, `.git`, окружение.
- **Код не исполняется**: `check_code` только компилирует исходник в WASM-байты.
- **Пути нормализуются**: `read_doc`/resources не выходят за пределы каталога
  документации (`..`, абсолютные пути отклоняются).
- **Локальный по умолчанию**: `--host 127.0.0.1`; сетевой доступ — осознанно
  через `--host 0.0.0.0` + reverse proxy + auth.
- **Ограничения ресурсов**: тело HTTP-запроса — 1 МиБ; исходник для
  `check_code` — 128 КиБ; сессии Streamable HTTP истекают через 30 минут.
- **Ошибки не раскрывают внутренности**: неожиданные исключения логируются в
  stderr, клиенту отдаётся `-32603 Internal error`.
- **CORS**: разрешён всем origin (нужно браузерным клиентам и web IDE); это
  осознанный компромисс для локального инструмента, не публикуйте без прокси.

## Известные ограничения

- Индекс строится один раз при запуске: изменения в docs подхватываются после
  перезапуска.
- SSE-поток — только heartbeat; сервер не инициирует запросы к клиенту
  (`tools/list_changed`, sampling, roots не поддерживаются).
- JSON-RPC batch поддержан в stdio-ядре, но HTTP-транспорт MCP 2025-06-18 его
  не использует; batch-запросы по HTTP обрабатываются как массив сообщений.
- `get_example` без `id` возвращает список, а не произвольный пример.
- На Windows сигналы SIGINT/SIGTERM доставляются не так, как на POSIX:
  корректная остановка HTTP-сервера реализована через `close()`
  (закрытие SSE/сессий/соединений) и проверена тестами; в консоли работает
  Ctrl+C.
- `check_code` различает только ошибки компиляции, но не предупреждения
  (компилятор их пока не выдаёт через C-ABI).
- В `reference/*` могут отсутствовать отдельные темы, пока документация
  пишется: `get_language_reference` в этом случае возвращает понятное
  сообщение и список доступных страниц, а не ошибку.
