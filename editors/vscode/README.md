# Latent Language для VS Code

Расширение поддержки языка **Latent** — AI-native языка, компилируемого в WebAssembly.
Plain JavaScript, без сборки и без runtime-зависимостей.

## Возможности

- **Подсветка синтаксиса** (TextMate, `source.latent`): комментарии `//` и `/* */`
  (включая вложенные), строки с escape-последовательностями, числа (int/float/экспонента),
  `true`/`false`/`null`, все жёсткие и мягкие ключевые слова, типы, операторы
  (`=> -> <- && || == != <= >= << >> & | ^ !`), `@декораторы`, AI-примитивы
  (`ai`, `ai_infer`, `ai_embed`, `ai_generate!`), объявления `fn`/`class`/`enum`/`let`,
  вызовы, поля и методы.
- **Сниппеты** для всех конструкций: функции, `async fn`, `let` с типом и с выводом,
  `if`/`while`/`for-in`/C-`for`, класс с `init` и методами, `enum`, `match`/`case`,
  обе формы лямбд, `spawn`, каналы/`select`, `@test`, `assert`/`assert_eq`,
  `ai_infer`/`ai_embed`/`tensor`/`matmul`, `alloc`/`memcopy` и другие.
- **Автодополнение, hover, подписи сигнатур, форматирование, диагностика** — через
  LSP-сервер `tooling/latent-lsp` (собственный минимальный LSP-клиент, без
  `vscode-languageclient`).
- **Компиляция в WASM** двумя путями:
  - CLI `latentc compile <file> <out.wasm>` (если бинарник найден);
  - `compiler.wasm` (Rust-компилятор, собранный в WebAssembly) через C-ABI
    `latent_alloc` / `latent_compile`.
- **Запуск** скомпилированной программы в Node: `WebAssembly.Instance` с импортом
  `env.print`, который читает из линейной памяти строку `[len u32 LE][utf8]`.
  Вывод идёт в канал **Latent**.
- **Статус-бар**: состояние LSP-сервера; клик — перезапуск.
- **Graceful degradation**: если LSP-сервер или `compiler.wasm` не найдены,
  расширение не падает — подсветка и сниппеты работают всегда, а в статус-баре
  и канале «Latent» появляется предупреждение.

## Установка

### Из VSIX (рекомендуется)

```bash
code --install-extension latent-1.0.0.vsix
```

Или в VS Code: **Extensions → … → Install from VSIX…** и выбрать
`latent-1.0.0.vsix`.

### Из папки (для разработки)

Скопируйте каталог `editors/vscode` в каталог расширений VS Code:

- Windows: `%USERPROFILE%\.vscode\extensions\jegius.latent-lang-1.0.0`
- Linux/macOS: `~/.vscode/extensions/jegius.latent-lang-1.0.0`

Затем перезапустите VS Code. Альтернатива — открыть `editors/vscode` в VS Code
и нажать **F5** (запуск Extension Development Host).

### Ожидаемая структура репозитория

Расширение ищет инструменты рядом с собой (`editors/vscode` → корень репозитория):

```
tooling/latent-lsp/bin/server.mjs   # LSP-сервер (опционально)
web-ide/compiler.wasm               # компилятор Rust → WASM
target/debug/latentc[.exe]          # CLI-компилятор (опционально)
```

Если расширение установлено отдельно от репозитория, укажите пути в настройках
(см. ниже).

## Настройки

| Настройка | Тип | По умолчанию | Описание |
|---|---|---|---|
| `latent.latentcPath` | string | `""` | Путь к CLI `latentc`. Пусто — `<repo>/target/debug/latentc(.exe)`, затем `latentc` в `PATH`. |
| `latent.nodePath` | string | `""` | Node.js для запуска LSP-сервера и `.mjs`-скриптов. Пусто — `node` из `PATH`. |
| `latent.lspServerPath` | string | `""` | Путь к `server.mjs` LSP-сервера. Пусто — `<repo>/tooling/latent-lsp/bin/server.mjs`. |
| `latent.compilerWasmPath` | string | `""` | Путь к `compiler.wasm`. Пусто — `<repo>/web-ide/compiler.wasm`. |
| `latent.enableDiagnostics` | boolean | `true` | Показывать диагностику в панели «Проблемы». |
| `latent.enableLsp` | boolean | `true` | Запускать LSP-сервер. |
| `latent.formatOnSave` | boolean | `false` | Форматировать `.lat` при сохранении (через LSP). |

## Команды и горячие клавиши

| Команда | Заголовок | Клавиши (Windows/Linux) | macOS |
|---|---|---|---|
| `latent.run` | Latent: Запустить | `Ctrl+Alt+R` | `Cmd+Alt+R` |
| `latent.compile` | Latent: Скомпилировать в WASM | `Ctrl+Alt+C` | `Cmd+Alt+C` |
| `latent.check` | Latent: Проверить | `Ctrl+Alt+K` | `Cmd+Alt+K` |
| `latent.format` | Latent: Форматировать документ | `Ctrl+Alt+F` | `Cmd+Alt+F` |
| `latent.openDocs` | Latent: Открыть документацию | `Ctrl+Alt+D` | `Cmd+Alt+D` |
| `latent.openPlayground` | Latent: Открыть Playground | `Ctrl+Alt+P` | `Cmd+Alt+P` |
| `latent.restartLsp` | Latent: Перезапустить LSP-сервер | `Ctrl+Alt+Shift+R` | `Cmd+Alt+Shift+R` |

Команды также доступны в палитре команд, контекстном меню редактора и на панели
заголовка редактора (кнопка ▶ для `.lat`-файлов).

- **Запустить** компилирует открытый файл и исполняет его, вывод — в канал «Latent».
- **Скомпилировать в WASM** пишет `<имя>.wasm` рядом с исходником (для сохранённого файла).
- **Проверить** компилирует без записи файла и публикует диагностику с позициями
  («на строке L:C»).
- **Форматировать** применяет правки LSP-сервера; без LSP команда сообщит об этом.

## Сборка VSIX

Из каталога `editors/vscode`:

```bash
pnpm dlx @vscode/vsce package --no-dependencies
# или с явным именем файла:
pnpm dlx @vscode/vsce package --no-dependencies --out latent-1.0.0.vsix
```

Готовый `latent-1.0.0.vsix` появится в `editors/vscode`. Файл не коммитится
(игнорируется `.gitignore` в корне репозитория).

## Публикация в Marketplace

```bash
pnpm dlx @vscode/vsce login jegius
pnpm dlx @vscode/vsce publish --no-dependencies
```

Для публикации нужен Personal Access Token Azure DevOps с областью
*Marketplace (Manage)*. Перед публикацией обновите `version` в `package.json`,
добавьте запись в `CHANGELOG.md` и пересоберите VSIX.

## Ограничения

- **Host-примитивы.** Каналы (`channel`, `ch <- v`, `<-ch`, `send`/`recv`), AI-примитивы
  (`ai_infer`, `ai_embed`, `ai_generate!`, `tensor`, `matmul`, …) и контракты в движке №2
  (Rust → WASM) дают ошибку компиляции: они требуют host-рантайма JS-движка.
  Сниппеты и подсветка для них есть, но скомпилировать такую программу в `.wasm`
  и запустить в расширении нельзя.
- **Запуск только скомпилированного WASM.** Расширение не запускает JS-интерпретатор
  (движок №1); AI-примеры из `web-ide/examples` нужно смотреть в playground.
- **Форматирование и автодополнение требуют LSP-сервера.** Без него доступны только
  подсветка, сниппеты и запуск.
- **Сервер LSP — отдельный компонент** (`tooling/latent-lsp`), не входит в VSIX.
  При установке из Marketplace путь нужно указать в `latent.lspServerPath`.
- **Синхронизация документа — полная.** Клиент отправляет в `didChange` полный текст
  (замена диапазона всего документа), а не отдельные правки; для LSP 3.17 это допустимо
  и совместимо с инкрементальной синхронизацией сервера.
- **`latent.compile`** перезаписывает `<имя>.wasm` рядом с исходником без подтверждения.
- Компилятор может выдать невалидный WASM для некоторых конструкций (известная
  особенность движка №2) — расширение покажет ошибку загрузки модуля при запуске.
- Диагностика компилятора не содержит кодов ошибок (только текст), поэтому в панели
  «Проблемы» нет `code`.

## Разработка и тесты

```bash
cd editors/vscode
node --check src/extension.js
node --experimental-test-coverage --test "test/*.test.mjs"
```

Тесты не требуют VS Code API: проверяются `package.json`, грамматика, сниппеты,
`runner.js` (компиляция через `web-ide/compiler.wasm` и запуск), `lsp-client.js`
(с фейковым LSP-сервером) и `docs.js`.

## Лицензия

MIT. См. [LICENSE](LICENSE).
