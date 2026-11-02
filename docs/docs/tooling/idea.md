---
title: "IntelliJ IDEA: плагин Latent"
description: "Плагин editors/idea: структура (42 Java-файла), сборка Gradle 8.10.2 + IntelliJ Platform 2024.2, установка из zip, возможности (подсветка, completion, аннотации, structure view, run configuration), настройки и честный статус сборки."
sidebar_position: 3
---

# IntelliJ IDEA: плагин Latent

Плагин `editors/idea` добавляет язык Latent в IntelliJ IDEA: FileType/Language
для `.lat`, подсветку и настраиваемую цветовую схему, автодополнение,
аннотации лексических ошибок, Structure View, сворачивание, комментарии,
отступы — и запуск программ через `latentc` с fallback на `compiler.wasm`.

## Статус: собирается

Плагин собран и упакован (`buildPlugin`):

```text
> Task :compileJava
> Task :jar
> Task :buildPlugin
BUILD SUCCESSFUL in 59s
```

Артефакт — `editors/idea/build/distributions/latent-idea-1.0.0.zip`
(≈237 КБ; внутри `latent-idea/lib/latent-idea-1.0.0.jar` с
`META-INF/plugin.xml`). Каталог `build/` в `.gitignore`, поэтому в чистой копии
архив нужно собрать самому — исходники компилируются без ошибок.

| Параметр | Значение |
|---|---|
| Плагин `id` / имя / версия | `dev.latent.idea` / `Latent` / `1.0.0` |
| Совместимость | IDEA Community/Ultimate 2023.3–2024.3 (`since-build=233`, `until-build=243.*`) |
| Gradle | 8.10.2 (wrapper), IntelliJ Platform Gradle Plugin 2.1.0 |
| Целевая платформа | IntelliJ IDEA Community 2024.2 |
| JDK / байткод | 17 (`sourceCompatibility/targetCompatibility = 17`) |
| Исходники | 42 Java-файла (~3 254 строки) + 7 тестовых |
| Ресурсы | `META-INF/plugin.xml`, `language/latent-language.json`, `liveTemplates/Latent.xml`, `runner/latent-runner.mjs`, `runner/compiler.wasm` |

`verifyPluginProjectConfiguration` выдаёт два предупреждения (не ошибки):

- `since-build=233` ниже целевой платформы 2024.2 (`242`);
- платформа 2024.2 рекомендует `sourceCompatibility=21`.

Плагин сознательно собирается под JDK 17 и байткод 17, чтобы работать во всех
IDE 2023.3–2024.3.

## Сборка

```powershell
$env:JAVA_HOME = 'C:\Users\Admin\Documents\deepseek-harness\default-workspace\tools\jdk17\jdk-17.0.20.1+1'
cd editors\idea
.\gradlew.bat buildPlugin
# результат: build\distributions\latent-idea-1.0.0.zip
```

```bash
# Linux/macOS
cd editors/idea
JAVA_HOME=/path/to/jdk-17 ./gradlew buildPlugin
```

Требования: JDK 17, доступ к сети (Gradle 8.10.2 и IntelliJ Platform 2024.2
скачиваются при первой сборке). `buildSearchableOptions` и `instrumentCode`
отключены в `build.gradle.kts` — headless-IDE для сборки не нужен.

:::note Если Java не может писать в каталог репозитория
В песочнице DSH встречался `java.nio.file.AccessDeniedException` на
`editors/idea/.intellijPlatform` (Java-процесс не мог создавать файлы внутри
`C:\Users\Admin\IdeaProjects`), а `GRADLE_USER_HOME`/`java.io.tmpdir` по
умолчанию указывали в недоступные каталоги. Обход — собрать копию каталога в
рабочей папке и задать временные пути:

```powershell
$dst = '...\latent-work\idea-copy'
Copy-Item editors\idea\* $dst -Recurse -Exclude build,.gradle,.intellijPlatform
$env:GRADLE_USER_HOME = '...\latent-work\idea-build\gradle-home'
$env:TEMP = $env:TMP = '...\latent-work\idea-build\tmp'
$env:JAVA_HOME = '...\tools\jdk17\jdk-17.0.20.1+1'
cd $dst; .\gradlew.bat buildPlugin
```
:::

## Установка из диска

1. Соберите архив (`.\gradlew.bat buildPlugin`).
2. `Settings → Plugins → ⚙ → Install Plugin from Disk…`
3. Выберите `build/distributions/latent-idea-1.0.0.zip`.
4. Перезапустите IDE; для `.lat`-файлов включится язык Latent.

## Возможности

| Возможность | Что реализовано |
|---|---|
| FileType/Language `Latent` | расширение `.lat`, иконка, `Language`/`FileType` в `plugin.xml` |
| Лексер | рукописный (`LatentScanner`), без JFlex: 37 ключевых слов (24 жёстких + 13 мягких), операторы, числа (`42`, `3.14`, `1e10`, `1.5e-3`), строки с escape `\n \t \\ \"`, вложенные `/* */`, `//`, `@`-декораторы |
| ParserDefinition/PSI | token-level PSI (`LatentParser`, `LatentFile`, `LatentDeclarationElement`) |
| Подсветка | `SyntaxHighlighter`: KEYWORD, SOFT_KEYWORD, TYPE, STRING, NUMBER, BOOLEAN, COMMENT, OPERATOR, FUNCTION_DECL, CLASS_DECL, ANNOTATION, AI_PRIMITIVE, IDENTIFIER; страница **Settings → Editor → Color Scheme → Latent** |
| Аннотатор | незакрытая строка/комментарий, неверный escape/число, неожиданный символ, несогласованные скобки (лексика/структура, без тайп-чека) |
| Автодополнение | ключевые слова, типы, builtins из `language.json`, функции/классы/enum текущего файла, методы после `.`, декораторы после `@` |
| Live templates | `fn`, `let`, `if`, `ifelse`, `while`, `for`, `forin`, `class`, `enum`, `match`, `lambda`, `spawn`, `select`, `test`, `assert`, `ai_generate`, `ai_infer`, `ai_contract` |
| Structure View | функции, классы с методами, enum с вариантами (эвристический разбор токенов) |
| Редактирование | сворачивание `{ ... }`/классов/enum/блочных комментариев, парные скобки, Enter с отступом 4, автозакрытие кавычек, комментарии `//` и `/* */` |
| Новый файл | шаблон `Latent Main.lat` в диалоге New → File |
| Run Configuration | **Latent**: компиляция `latentc`, fallback — `compiler.wasm`, запуск WASM в Node (`runner/latent-runner.mjs`), `print` — по строке на аргумент, exit code = `main % 256` |
| Настройки | `Settings → Tools → Latent`: пути к `latentc`, `node`, `compiler.wasm` |

## Запуск программы

1. `Settings → Tools → Latent` — при необходимости укажите `latentc`, `node`,
   `compiler.wasm` (по умолчанию — поиск в `PATH`/проекте).
2. `Run → Edit Configurations… → + → Latent` и выберите `.lat`-файл (либо
   правой кнопкой в редакторе → `Run 'Latent …'`, либо зелёная кнопка напротив
   `fn main`).
3. Плагин компилирует файл (`latentc compile <file> <out.wasm>`) во временный
   `*.wasm` и запускает его через `node runner/latent-runner.mjs run <wasm>`.

Если `latentc` не найден, используется `compiler.wasm` по C-ABI
`latent_alloc`/`latent_compile`. Встроенная копия
`src/main/resources/runner/compiler.wasm` — **снимок на момент сборки плагина**;
её можно переопределить настройкой.

## Проверка

```bash
cd editors/idea
./gradlew buildPlugin                    # сборка zip
./gradlew test                           # 49 тестов, 0 падений
./gradlew verifyPluginProjectConfiguration
```

Тесты — `src/test/java`: лексер/сканер (16), структура файла (5), отступы (5),
JSON-данные языка (3), подсветка (5), лексер-обёртка (2) и платформенный smoke
(12: парсер/аннотатор/completion на `BasePlatformTestCase`). Проверено:
`BUILD SUCCESSFUL`, 49/49 `PASSED`.

## Ограничения

- Плагин **не заменяет компилятор**: диагностика типов, неопределённых имён и
  арности остаётся за `latentc`; аннотатор показывает только лексические и
  структурные проблемы (чтобы не давать ложных срабатываний).
- Нет форматтера, рефакторингов, отладчика и LSP-клиента; Structure View
  построен на эвристическом разборе токенов.
- Подсветка не семантическая: без разрешения символов.
- Host-only примитивы (`tensor`, `ai_infer`, каналы) движок №2 не компилирует —
  это ограничение языка, а не плагина.
- Для запуска нужен Node.js; для компиляции — `latentc` либо `compiler.wasm`.
- **Встроенная копия `runner/compiler.wasm` устарела**: 470 717 байт, собрана
  до декомпозиции `src/` и **не содержит memory-builtins** (`alloc(4)` →
  «Неопределённая переменная 'alloc'»). Если нужны memory-builtins, укажите в
  настройках актуальный `web-ide/compiler.wasm` (630 340 байт) — см.
  [bootstrap](./bootstrap.md#2-compilerwasm-для-web-ide-движок-2).
- Сборка требует JDK 17 и сети; в песочнице DSH — ещё и копии каталога
  (см. врезку выше).

## Связанные разделы

- [VS Code](./vscode.md) — расширение с LSP-клиентом.
- [Web IDE](./web-ide.md) · [MCP](./mcp.md)
- [CLI](../reference/cli.md) — `latentc` и запуск WASM.
- [Bootstrap](./bootstrap.md) — сборка `latentc`/`compiler.wasm`.
