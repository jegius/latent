---
title: "IntelliJ IDEA: плагин Latent"
description: "Плагин editors/idea: возможности (подсветка, completion, диагностика, запуск), сборка через Gradle, установка из диска, настройки."
sidebar_position: 3
---

# IntelliJ IDEA: плагин Latent

Плагин `editors/idea` добавляет язык Latent в IntelliJ IDEA: FileType/Language
для `.lat`, подсветку, completion, сворачивание, матчинг скобок, комментарии,
запуск через `latentc` + Node и диагностику от внешнего компилятора.

:::note
Каталог `editors/idea` собирается Gradle-проектом (Kotlin DSL + IntelliJ
Platform Gradle Plugin 2.x, JDK 17). Если в вашей копии ветки каталога ещё нет
— плагин в этой ревизии не добавлен; ниже описан его контракт и способ сборки.
:::

## Сборка

```bash
cd editors/idea
./gradlew buildPlugin          # Linux/macOS
gradlew.bat buildPlugin        # Windows
```

Требования: JDK 17 (в окружении проекта —
`C:\Users\Admin\Documents\deepseek-harness\default-workspace\tools\jdk17`),
доступ к сети для скачивания IntelliJ Platform/Gradle.

```powershell
$env:JAVA_HOME = 'C:\Users\Admin\Documents\deepseek-harness\default-workspace\tools\jdk17\jdk-17.0.20.1+1'
cd editors\idea
.\gradlew.bat buildPlugin
```

Результат — zip в `editors/idea/build/distributions/`.

## Установка из диска

1. `Settings → Plugins → ⚙ → Install Plugin from Disk…`
2. Выберите собранный `.zip` из `build/distributions/`.
3. Перезапустите IDE; для `.lat`-файлов включится язык Latent.

## Возможности

| Возможность | Описание |
|---|---|
| FileType/Language `Latent` | расширение `.lat`, иконка, регистрация в IDE |
| Подсветка синтаксиса | keywords, типы, строки/escape, числа, комментарии, операторы, `@`-аннотации, AI-примитивы (SyntaxHighlighter) |
| Lexer/ParserDefinition | hand-written lexer или JFlex; PSI token-level |
| Completion | ключевые слова, builtins, сниппеты; данные из `tooling/language-data/language.json` (извлекаются в ресурсы плагина генерируемым файлом) |
| Аннотатор | минимальные проверки + диагностика от внешнего компилятора (`latentc`/`compiler.wasm`) по сохранению |
| Commenter | `//` и `/* */` |
| BraceMatcher, FoldingBuilder | матчинг `(){}[]`, сворачивание блоков/комментариев |
| EnterHandler/Indent | автоотступ по `{}` |
| Run Configuration | компиляция `latentc` и запуск `.wasm` через Node; вывод — в Run-консоль |
| Настройки | пути к `latentc`/`node`/`compiler.wasm` |
| Actions | Compile / Run / Check / Format (по возможности) |

## Запуск программы

1. Настройте пути: `Settings → Tools → Latent` (или общие настройки плагина) —
   `latentc`, `node`, `compiler.wasm`.
2. Создайте Run Configuration `Latent` для файла `.lat` (или используйте
   действие Run из контекстного меню).
3. Плагин компилирует файл (`latentc compile … out.wasm` либо через
   `compiler.wasm`), затем запускает WASM в Node с `env.print`.

Требуется Node.js в `PATH` или указанный в настройках; компилятор — «чистое»
подмножество Latent (движок №2), host-фичи (AI, каналы, тензоры) не
скомпилируются.

## Настройки

| Настройка | Смысл |
|---|---|
| Latent compiler path | путь к `latentc` (или пусто — поиск в `target/debug`, `PATH`) |
| Node.js path | путь к `node` для LSP/запуска WASM |
| Compiler WASM path | путь к `web-ide/compiler.wasm` (fallback, если CLI нет) |
| Диагностика вкл./выкл. | запускать ли компилятор по сохранению |

## Проверка

```bash
cd editors/idea
./gradlew buildPlugin
```

Артефакт должен появиться в `build/distributions/`. По возможности —
`./gradlew verifyPlugin` (требует сеть и совместимую версию IntelliJ Platform).

## Ограничения

- Плагин не содержит собственного тайпчекера: диагностика — от внешнего
  компилятора (или отсутствует, если компилятор не найден).
- Подсветка не семантическая: строится по лексеру, без разрешения символов.
- Запуск требует Node.js; WASM исполняется отдельным процессом.
- Сборка требует JDK 17 и доступа к сети (Gradle/Platform).

## Связанные разделы

- [VS Code](./vscode.md) — расширение с LSP-клиентом.
- [Web IDE](./web-ide.md) · [MCP](./mcp.md)
- [CLI](../reference/cli.md) — `latentc` и запуск WASM.
- [Bootstrap](./bootstrap.md) — сборка `latentc`/`compiler.wasm`.
