# tooling/language-data — machine-readable источник правды о языке Latent

Каталог содержит единый JSON-файл с описанием языка: ключевые слова, операторы,
типы, встроенные функции/методы, host-only примитивы, каталог диагностик,
сниппеты и ABI WASM-модуля. Файл — **единственный** источник данных для:

* LSP-сервера [`tooling/latent-lsp`](../latent-lsp/README.md) — completion, hover, signature help;
* плагинов IDE ([`editors/vscode`](../../editors/vscode), [`editors/idea`](../../editors/idea)) — подсветка, сниппеты, инспекции;
* MCP-сервера документации ([`mcp/docs-mcp`](../../mcp/docs-mcp)) — ответы `get_language_reference`;
* сайта документации ([`docs`](../../docs)) — таблицы builtins/операторов/ошибок.

Данные выверены по исходникам Rust-компилятора (`src/lexer`, `src/parser`,
`src/typechecker`, `src/codegen`) и по рабочим примерам `web-ide/examples/*.lat`
на ветке `part10-toolchain` (компилятор 0.1.0). Черновик инвентаризации —
`latent-work/inventory.md` (полный факт-лист по Rust-реализации: §2.4 ключевые
слова и мягкие слова, §2.5 операторы и приоритеты, §3 типы, §6 builtins и
методы, §7 ABI, §8 тексты ошибок, §10 ограничения).

## Файлы

| Файл | Назначение |
|---|---|
| `language.json` | сами данные о языке (UTF-8, без комментариев) |
| `latent-language.schema.json` | JSON Schema draft-07 для `language.json` |
| `validate.mjs` | CLI + публичный фасад валидатора (zero deps) |
| `validator.mjs` | структурная и семантическая проверка данных |
| `validator-helpers.mjs` | константы (engine, разделы доков) и общие проверки |
| `validator-items.mjs` | проверки keywords/operators/types/builtins/hostOnly |
| `validator-diagnostics.mjs` | проверки диагностик, сниппетов и ABI |
| `README.md` | этот файл |

## Быстрая проверка

```pwsh
# из корня репозитория
node tooling/language-data/validate.mjs
```

Ожидаемый вывод:

```
OK: .../tooling/language-data/language.json
  keywords=37 operators=37 types=21 builtins=53 diagnostics=31 snippets=14
```

Код возврата `1` — есть ошибки. Валидатор проверяет в том числе:

* уникальность ключевых слов, builtins (ключ `kind:name:owner`) и кодов диагностик;
* что каждый `regex` диагностики реально разбирает её `sample`;
* что `positioned: true` встречается только у сообщений с `на строке L:C`;
* что `hostOnly` ссылается на существующие builtins с `engine: "host"`;
* что `docs` — путь из известных разделов сайта документации.

## Схема `language.json`

```jsonc
{
  "version": "1.0.0",            // версия файла данных (semver)
  "language": "latent",
  "compilerVersion": "0.1.0",    // на какой версии компилятора выверено
  "engines": { "rust": {...}, "js": {...}, "both": {...}, "host": {...} },
  "keywords":   [ { "name", "kind": "keyword", "soft", "category", "summary", "syntax", "engine", "docs" } ],
  "operators":  [ { "op", "kind", "precedence", "assoc", "summary", "example", "engine", "docs" } ],
  "types":      [ { "name", "category", "wasm", "summary", "syntax", "engine", "docs" } ],
  "builtins":   [ { "name", "kind", "owner?", "signatures": ["..."], "engine", "summary", "example", "docs" } ],
  "hostOnly":   [ "tensor", "matmul", "ai_infer", "channel", ... ],
  "diagnostics":[ { "code", "engine", "severity", "positioned", "pattern", "regex", "sample", "summary", "docs" } ],
  "snippets":   [ { "prefix", "body", "description" } ],
  "abi":        { "imports", "exports", "compilerAbi", "dataLayout", ... }
}
```

Полное описание полей — в `latent-language.schema.json`.

### Значения `engine`

| Значение | Смысл |
|---|---|
| `rust` | только движок №2 — Rust-компилятор в WASM (`src/`, `web-ide/compiler.wasm`) |
| `js` | только движок №1 — tree-walking интерпретатор (`web-ide/compiler/`) |
| `both` | поддержано обоими движками |
| `host` | требует host-рантайма (AI-гейтвей, каналы, тензоры); в движке №2 — ошибка компиляции |

### «Мягкие» ключевые слова (`soft: true`)

Лексер помечает их отдельными токенами (`TokenType::Test`, `TokenType::Tensor`,
…), но синтаксически они остаются валидными именами: `let test = 5;`,
`fn model() {}`, `obj.agent`. Это зафиксировано в
`src/lexer/token.rs::TokenType::soft_keyword_lexeme`.

### Пути документации (`docs`)

`docs` — путь к странице **относительно `docs/docs/`** (без `.md`), при
необходимости с якорем: `guide/variables-and-types`, `reference/operators`,
`reference/errors#lex_unexpected_char`. Разделы: `intro`, `getting-started`,
`tutorial`, `guide`, `reference`, `specs`, `tooling`, `examples`.

### Диагностики

`pattern` — реальный текст сообщения компилятора с плейсхолдерами,
`regex` — JS-регулярка для разбора (LSP/mcp/docs-mcp используют её, чтобы
превратить `... на строке L:C` в диапазон), `sample` — живой пример, на котором
валидатор проверяет регулярку. `positioned: false` означает, что сообщение не
содержит позиции (такие ошибки кодогенератора LSP показывает без диапазона
строки).

## Как обновлять

1. Источник истины — код `src/`, а не этот файл. Любое изменение языка
   (новое ключевое слово, builtin, тип, оператор, текст ошибки) сначала
   попадает в Rust-компилятор.
2. Обновите `language.json` (не удаляйте существующие элементы без причины —
   на них опираются IDE-плагины).
3. `node tooling/language-data/validate.mjs` должен быть зелёным.
4. `node tooling/latent-lsp/test/language-data.test.mjs` проверяет данные в
   составе тестов LSP-сервера.

Владелец каталога — `language-lsp` (см. `latent-work/PLAN.md`, раздел
«Разделение владения»). Остальные агенты читают файл и **не правят** его без
согласования: при необходимости добавить элементы — пишите владельцу.
