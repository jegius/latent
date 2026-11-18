# tooling/latent-lsp — Language Server Protocol для языка Latent

Полноценный LSP-сервер для Latent: автодополнение, подсказки, сигнатуры,
форматирование, символы документа, переход к определению и диагностика через
настоящий Rust-компилятор (`web-ide/compiler.wasm`).

* **Zero dependencies** — только стандартная библиотека Node.js (`node:fs`,
  `node:path`, `WebAssembly`), ни одного пакета из npm.
* **LSP 3.17**, транспорт — JSON-RPC 2.0 поверх stdio с заголовками
  `Content-Length`.
* Node.js **>= 18** (проверено на Node 24).
* Данные о языке — единый источник правды
  [`tooling/language-data/language.json`](../language-data/README.md).

## Быстрый старт

```pwsh
# из корня репозитория
node tooling/latent-lsp/bin/server.mjs --stdio
```

Сервер читает JSON-RPC из stdin и пишет ответы в stdout. В stdout не попадает
ничего, кроме протокола; логи идут в stderr или в файл `--log`.

Проверка вручную (PowerShell): отправить `initialize` и увидеть ответ.

```pwsh
$body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}'
$frame = "Content-Length: $([Text.Encoding]::UTF8.GetByteCount($body))`r`n`r`n$body"
$frame | node tooling/latent-lsp/bin/server.mjs --stdio
```

## Опции командной строки

| Опция | Значение |
|---|---|
| `--stdio` | **обязательна**: транспорт JSON-RPC 2.0 через stdin/stdout |
| `--compiler-wasm <path>` | путь к `compiler.wasm`; по умолчанию `web-ide/compiler.wasm`, переопределяется env `LATENT_COMPILER_WASM` |
| `--language-data <path>` | путь к `language.json`; по умолчанию `tooling/language-data/language.json`, env `LATENT_LANGUAGE_DATA` |
| `--log <path>` | писать лог в файл (по умолчанию — stderr) |
| `--help`, `-h` | справка |
| `--version`, `-v` | версия сервера |

Без рабочего `compiler.wasm` сервер **запускается и работает**: диагностика
просто не публикуется (graceful degradation, см. «Ограничения»).

## Возможности (capabilities)

Ответ на `initialize`:

```json
{
  "textDocumentSync": { "openClose": true, "change": 2, "save": { "includeText": false } },
  "completionProvider": { "triggerCharacters": [".", ":"], "resolveProvider": false },
  "hoverProvider": true,
  "signatureHelpProvider": { "triggerCharacters": ["(", ","], "retriggerCharacters": [","] },
  "documentFormattingProvider": true,
  "documentSymbolProvider": true,
  "definitionProvider": true
}
```

| Возможность | Источник данных | Поведение |
|---|---|---|
| `textDocumentSync` (Incremental) | — | range-правки применяются в UTF-16 позициях; поддерживаются и полные замены без `range` |
| `completion` | `language.json` + символы файла | ключевые слова (со сниппетами, `InsertTextFormat.Snippet`), builtins с сигнатурами, типы, символы текущего файла (fn/class/enum/let), после `.` — методы и поля класса; host-only примитивы помечены `host-only` |
| `hover` | `language.json` + объявления файла | markdown-документация: сигнатура/синтаксис, описание, ссылка на страницу доков; для символов — объявление и номер строки |
| `signatureHelp` | `language.json` + объявления файла | активный параметр по запятым верхнего уровня; вариативные формы (`print(value, ...)`) учитываются |
| `formatting` | порт `web-ide/services/formatter-service.js` | 1:1 поведение web IDE; возвращает правку всего документа или `[]`, если текст уже отформатирован |
| `documentSymbol` | лёгкий анализ документа | иерархия: класс → поля/методы, функция → локальные переменные |
| `definition` | лёгкий анализ документа | функции, классы, enum, переменные и поля класса **в пределах файла** (в языке нет модулей) |
| `publishDiagnostics` | `compiler.wasm` | push-диагностика на `didOpen`/`didChange`/`didSave`, пустой список после `didClose` |

### Диагностика

Сервер компилирует текст через WASM-компилятор (ABI `latent_alloc` /
`latent_compile` → `[status u32][len u32][payload]`, status 0 — текст ошибки),
разбирает русские сообщения вида `... на строке L:C` (1-based, столбец в
символах → пересчёт в UTF-16) и публикует LSP-диагностики с:

* `severity: 1` (Error), `source: "latent"`;
* `code` — стабильный код из каталога `language.json.diagnostics`
  (`LEX_*`, `PARSE_*`, `TYPE_*`, `GEN_*`), иначе `LATENT_COMPILE_ERROR`;
* `range` — позиция из текста ошибки.

Несколько ошибок тайпчекера, склеенных компилятором через `"; "`, разбираются
в отдельные диагностики. Ошибки **кодогенератора** (`Unknown function: ...`,
`Builtin 'tensor' не поддерживается...`) позиции не содержат — для них
диагностика ставится на первую строку документа (осознанное упрощение, см.
«Ограничения»).

Отключить диагностику можно через `initializationOptions`:

```json
{ "initializationOptions": { "latent": { "diagnostics": false } } }
```

### Форматирование

Алгоритм — точный порт `web-ide/services/formatter-service.js` (отступы в
4 пробела, выравнивание по фигурным скобкам, пробелы после запятых и вокруг
бинарных операторов, защита строк/комментариев). Паритет зафиксирован тестом:
для всех `web-ide/examples/*.lat` результат совпадает с эталонной реализацией,
а повторное форматирование идемпотентно.

## Интеграция

### VS Code

Расширение в репозитории — [`editors/vscode`](../../editors/vscode). Оно
запускает сервер как дочерний процесс. Минимальный вариант — сторонний
клиент (например, `vscode-languageclient`) с конфигурацией:

```jsonc
// .vscode/settings.json проекта
{
  "latent.server.command": "node",
  "latent.server.args": ["tooling/latent-lsp/bin/server.mjs", "--stdio"]
}
```

Если расширение уже установлено, отдельный запуск не нужен: оно само поднимает
`bin/server.mjs` для документов с language id `latent`.

### IntelliJ IDEA

Плагин — [`editors/idea`](../../editors/idea). Он использует
`LspServerDescriptor` (IntelliJ Platform LSP API) и запускает тот же
`bin/server.mjs --stdio`. Ручной запуск для отладки:

```pwsh
node tooling/latent-lsp/bin/server.mjs --stdio --log C:\Temp\latent-lsp.log
```

В логе видно `initialize`, загрузку `language.json` и компилятора, а также
причины отключения диагностики.

### Другие редакторы

Подойдёт любой LSP-клиент, поддерживающий stdio-транспорт: Neovim
(`vim.lsp.start`), Emacs (`eglot`), Helix и т.п. Команда та же:
`node tooling/latent-lsp/bin/server.mjs --stdio`.

## Архитектура

```
bin/server.mjs          точка входа: runStdioServer (--stdio обязателен)
src/main.mjs            сборка: CLI + логгер + данные + компилятор + stdio-цикл
src/cli.mjs             разбор аргументов, USAGE
src/server.mjs          ядро: JSON-RPC диспетчеризация и жизненный цикл
src/capabilities.mjs    константы initialize
src/features.mjs        обработчики возможностей и didOpen/didChange/didClose + диагностика
src/jsonrpc.mjs         кадрирование Content-Length, коды ошибок
src/positions.mjs       UTF-16 позиции ↔ смещения
src/documents.mjs       TextDocument, DocumentStore, инкрементальные правки
src/context.mjs         контекст курсора: слово, префикс, `.`, стек вызовов
src/analyzer.mjs        объявления документа (fn/class/enum/let/поля/методы)
src/declarations.mjs    поиск объявлений, поля/методы классов, вывод типа переменной
src/language-data.mjs   загрузка и индексация language.json
src/docs.mjs            markdown для hover/completion
src/completion.mjs      оркестрация автодополнения (контекст → элементы)
src/completion-items.mjs построение CompletionItem, сниппеты, kind'ы
src/hover.mjs           подсказки при наведении
src/signature-help.mjs  сигнатуры и активный параметр
src/symbols.mjs         documentSymbol и definition
src/formatter.mjs       форматирование (порт 1:1)
src/formatter-scan.mjs  посимвольный разбор строки для форматтера
src/wasm-compiler.mjs   загрузка compiler.wasm и ABI latent_alloc/latent_compile
src/diagnostics.mjs     текст ошибки → LSP Diagnostic
src/logger.mjs          лог в файл/stderr
```

Каждый модуль < 300 строк и отвечает за одну задачу. Внешних зависимостей нет.

## Тесты

```pwsh
# из корня репозитория
node --test "tooling/latent-lsp/test/*.test.mjs"

# то же + порог покрытия ≥90% строк (скрипт package.json)
cd tooling/latent-lsp
npm run coverage
```

`npm test` работает на Node ≥18; `npm run coverage` использует
`--test-coverage-lines` и требует Node ≥22 (в CI — Node 22).

Сейчас: **146 тестов, 0 падений**. Покрытие (`npm run coverage`,
`--experimental-test-coverage`): **94.59% строк, 94.00% функций** (branch — 80.13%)
по всем файлам, которые загружают тесты (сервер + данные о языке + эталонный
форматтер web-ide). Ниже порога 90% остаются только CLI-ветви
`tooling/language-data/validator*.mjs`; сам LSP-сервер (`src/`, `bin/`) — выше.

Набор тестов:

| Файл | Что проверяет |
|---|---|
| `language-data.test.mjs` | валидность `language.json` и инварианты (37 ключевых слов, 13 мягких, приоритеты операторов, типы, builtins, движки `engine`, каталог диагностик) |
| `jsonrpc.test.mjs` | кадрирование Content-Length (в т.ч. кириллица в UTF-8), частичные кадры, битый JSON |
| `positions.test.mjs` | UTF-16 позиции, code points → UTF-16, инкрементальные правки |
| `formatter.test.mjs` | паритет с web-ide на всех примерах + идемпотентность на 8+ примерах |
| `formatter-scan.test.mjs` | многострочные блочные комментарии, `//`-комментарии, экранированные кавычки, подсчёт скобок |
| `wasm-compiler.test.mjs` | загрузка `compiler.wasm`, компиляция валидного/битого кода, graceful при отсутствии файла |
| `diagnostics.test.mjs` | валидный код → пусто; битый → ошибка с диапазоном строки; несколько ошибок; host-only без позиции |
| `completion.test.mjs` | keyword/builtin/методы после `.`/поля класса/символы файла/типы/сниппеты/host-only |
| `hover.test.mjs` | ключевое слово, builtin, тип, оператор, символ файла, null для неизвестного |
| `signature-help.test.mjs` | builtin и пользовательские функции, методы, вложенные вызовы, строки с запятыми |
| `analyzer.test.mjs` | symbols/definition, вложенность классов, скобки в строках, `flattenSymbols`/`fieldsOfClass`/`methodsOfClass`, `classOfVariable` |
| `logger.test.mjs` | запись уровней в файл, fallback на stderr при недоступном пути, идемпотентный `close` |
| `main.test.mjs` | ошибки запуска (нет language data), битые кадры JSON-RPC, ошибка stdin |
| `lifecycle.test.mjs` | initialize/capabilities, ошибки до initialize, shutdown/exit, отмена, диагностика didOpen/didChange/didSave/didClose, graceful без wasm |
| `features.test.mjs` | все возможности через сервер (in-process) |
| `server-stdio.test.mjs` | e2e: дочерний процесс, initialize → didOpen/didChange → formatting → shutdown/exit; CLI (`--help`, `--version`, без `--stdio`, неизвестная опция) |

## Ограничения

1. **Диагностика без позиции** (ошибки кодогенератора) ставится на первую
   строку — компилятор не сообщает позицию таких ошибок.
2. **Definition только в пределах файла**: в языке Latent нет модулей/импортов.
3. **Completion после точки — эвристика**: тип объекта выводится по простым
   шаблонам (`let x = new Class(...)`, `let x: Class`, `let x = [...]`,
   `channel(...)`, `ai.*`, строковый литерал). Для неразрешимых случаев
   предлагаются методы всех известных владельцев.
4. **«Мягкие» ключевые слова** (`test`, `assert`, `model`, `tensor`, …)
   показываются и как ключевые слова, и как builtins — сервер отдаёт
   приоритет builtin-форме, если имя совпадает.
5. Компилятор `web-ide/compiler.wasm` — снимок `src/`; если он пересобран не с
   HEAD, тексты диагностик могут отличаться от текущего компилятора. В
   репозитории артефакт актуален (memory-builtins `alloc/load8/...` есть).
   Актуальность влияет только на диагностику, не на остальные возможности.
6. Сервер не реализует `workspace/*`, `codeAction`, `rename`, `semanticTokens`
   — их нет в контракте `PLAN.md`.
7. Обработка сообщений синхронная (по одному): `$/cancelRequest` учитывается
   для ещё не обработанных запросов, но не прерывает уже выполняющуюся
   компиляцию (она быстрая — единицы миллисекунд).

## Отладка

* `--log <path>` — подробный лог: загрузка `language.json`, компилятора,
  `initialize`, отключение диагностики и внутренние ошибки.
* `LATENT_COMPILER_WASM=<path>` — подменить компилятор, не меняя аргументов.
* При отсутствии wasm в логе будет строка
  `компилятор не найден (...): ... Диагностика отключена, остальные возможности LSP работают.`
* Проверить данные о языке: `node tooling/language-data/validate.mjs`.
