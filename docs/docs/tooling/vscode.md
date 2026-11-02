---
title: "VS Code: расширение Latent"
description: "Установка и сборка расширения editors/vscode: возможности (подсветка, сниппеты, LSP, компиляция, запуск), команды, горячие клавиши, настройки, .vsix."
sidebar_position: 2
---

# VS Code: расширение Latent

Расширение `editors/vscode` — plain JavaScript, **без шага сборки** (никаких
webpack/esbuild): достаточно открыть папку и нажать F5 либо упаковать `.vsix`.
Идентификатор: `latent-lang`, publisher `jegius`.

## Установка

### Из исходников (F5)

1. Откройте `editors/vscode` в VS Code.
2. `F5` (Run Extension) — откроется окно Extension Development Host с
   поддержкой `.lat`.
3. Для языка нужен `latent`-файл — создайте `main.lat`:

```latent
fn main() -> int {
    print("hello from VS Code");
    return 0;
}
```

### Сборка `.vsix`

```bash
cd editors/vscode
npx @vscode/vsce package --no-dependencies
code --install-extension latent-lang-1.0.0.vsix   # имя — по полю name в package.json
```

Для сборки нужен только Node.js (зависимостей нет).

### Готовый `.vsix`

В репозитории лежит уже собранный архив
`editors/vscode/latent-1.0.0.vsix` (36 095 байт) — его можно установить сразу:

```bash
code --install-extension editors/vscode/latent-1.0.0.vsix
# либо: Extensions → … → Install from VSIX…
```

## Возможности

| Возможность | Как работает |
|---|---|
| Язык `latent` для `.lat` | `contributes.languages`, конфигурация скобок/комментариев |
| Подсветка синтаксиса | TextMate-грамматика `syntaxes/latent.tmLanguage.json` (ключевые слова, типы, строки/escape, числа, комментарии, операторы, `@`-аннотации, AI-примитивы) |
| Сниппеты | `snippets/latent.json`: `fn`, `let`, `if`, `ifelse`, `while`, `for`, `forin`, `match`, `class`, `enum`, `lambda`, `test`, `spawn`, `select`, … |
| LSP-клиент | `src/lsp-client.js` → `tooling/latent-lsp` (stdio): диагностика, completion, hover, signature help, форматирование, document symbols, definition |
| Диагностика | из LSP (`publishDiagnostics`) и/или компилятора; включ./выкл. настройкой |
| Компиляция | `Latent: Скомпилировать в WASM` — через `latentc` (если найден) либо `web-ide/compiler.wasm`; результат — `.wasm` рядом с файлом |
| Запуск | `Latent: Запустить` — компилирует и запускает WASM в Node с `env.print`, вывод — в Output Channel |
| Форматирование | LSP `documentFormatting` (тот же алгоритм, что в web IDE) и «форматировать при сохранении» |
| Документация | `Latent: Открыть документацию` — сайт документации; `Latent: Открыть Playground` — `/playground/` (web IDE) |
| Перезапуск LSP | `Latent: Перезапустить LSP-сервер` |

Если LSP-сервер или `compiler.wasm` не найдены, расширение продолжает работать
без них (остаются подсветка, сниппеты; запуск деградирует с понятным
сообщением).

## Команды и горячие клавиши

| Команда | Клавиши | Что делает |
|---|---|---|
| `Latent: Запустить` (`latent.run`) | `Ctrl+Alt+R` / `Cmd+Alt+R` | компиляция + запуск WASM |
| `Latent: Скомпилировать в WASM` (`latent.compile`) | `Ctrl+Alt+C` / `Cmd+Alt+C` | только компиляция |
| `Latent: Проверить` (`latent.check`) | `Ctrl+Alt+K` / `Cmd+Alt+K` | проверка без записи |
| `Latent: Форматировать документ` (`latent.format`) | `Ctrl+Alt+F` / `Cmd+Alt+F` | форматирование |
| `Latent: Открыть документацию` (`latent.openDocs`) | `Ctrl+Alt+D` / `Cmd+Alt+D` | сайт документации |
| `Latent: Открыть Playground` (`latent.openPlayground`) | `Ctrl+Alt+P` / `Cmd+Alt+P` | web IDE |
| `Latent: Перезапустить LSP-сервер` (`latent.restartLsp`) | `Ctrl+Alt+Shift+R` / `Cmd+Alt+Shift+R` | перезапуск LSP |

Кнопки Run/Compile также добавляются в заголовок редактора (`editor/title`) и
контекстное меню для `.lat`-файлов.

## Настройки

| Настройка | По умолчанию | Значение |
|---|---|---|
| `latent.latentcPath` | `""` | путь к `latentc`; пусто — `<repo>/target/debug/latentc.exe` (Windows) / `latentc` (Linux/macOS), затем `PATH` |
| `latent.nodePath` | `""` | Node.js для LSP и `.mjs`; пусто — Node, запустивший VS Code, иначе `node` из `PATH` |
| `latent.lspServerPath` | `""` | путь к `tooling/latent-lsp/bin/server.mjs`; пусто — путь рядом с репозиторием |
| `latent.compilerWasmPath` | `""` | путь к `compiler.wasm`; пусто — `<repo>/web-ide/compiler.wasm` |
| `latent.enableDiagnostics` | `true` | диагностика в панели «Проблемы» и подчёркивание |
| `latent.enableLsp` | `true` | запускать LSP-сервер |
| `latent.formatOnSave` | `false` | форматировать при сохранении через LSP |

## Как устроено

```text
editors/vscode/
  package.json                 contributes: languages/grammars/snippets/commands/configuration
  language-configuration.json  скобки, комментарии, автозакрытие
  syntaxes/latent.tmLanguage.json
  snippets/latent.json
  src/extension.js             активация, команды, диагностика, запуск
  src/lsp-client.js            минимальный LSP-клиент (stdio JSON-RPC)
  src/runner.js                latentc / compiler.wasm → .wasm → запуск в Node
  src/docs.js                  ссылки на документацию и playground
  images/icon.png
  latent-1.0.0.vsix            собранный архив расширения
  README.md, CHANGELOG.md, LICENSE, .vscodeignore
  test/*.test.mjs              package/grammar/snippets/lsp-client/runner/docs
```

- Все команды зарегистрированы в `package.json` (`contributes.commands`) и
  активируются по `onLanguage:latent` / `onCommand:...`.
- LSP-клиент запускает `node tooling/latent-lsp/bin/server.mjs --stdio`;
  путь берётся из настроек/репозитория. Если сервер не найден — LSP
  отключается, остальные возможности работают.
- Запуск WASM — как в [CLI](../reference/cli.md#запуск-полученного-wasm-в-node):
  импорт `env.print(i32)` читает `[len][utf8]` из памяти, затем вызывается
  экспорт `main`.

## Проверка

```bash
cd editors/vscode
node --check src/extension.js
node --test "test/*.test.mjs"        # 70 тестов, 0 падений
```

Тесты проверяют JSON-контрибуции, наличие сниппетов/ключевых слов из
`tooling/language-data/language.json`, парсинг диагностик, LSP-клиент на
фейковом сервере и runner на валидной/битой программе. Покрытие строк —
**98.77%** (по отчёту при сборке расширения). Собранный архив —
`latent-1.0.0.vsix`.

## Ограничения

- Подсветка — TextMate (не семантическая); полноценная навигация зависит от
  LSP-сервера.
- Компилятор — «чистое подмножество» Latent (движок №2): AI/каналы/тензоры в
  `.wasm` не компилируются (ошибка host-рантайма).
- При отсутствии `latentc` компиляция идёт через `compiler.wasm` — качество
  диагностик то же, что у движка №2.
- Запуск требует Node.js; WASM исполняется вне VS Code-процесса (через
  `node`).

## Связанные разделы

- LSP-сервер — `tooling/latent-lsp` (тесты запускаются как в
  [bootstrap](./bootstrap.md#5-полный-набор-проверок)).
- [Web IDE](./web-ide.md) · [IntelliJ IDEA](./idea.md) · [MCP](./mcp.md)
- [CLI](../reference/cli.md) — запуск WASM в Node.
