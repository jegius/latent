# Latent для IntelliJ IDEA

Плагин IntelliJ IDEA с полноценной поддержкой языка **Latent** — компилируемого в
WebAssembly языка из репозитория [jegius/latent](https://github.com/jegius/latent).

Плагин собирается IntelliJ Platform Gradle Plugin 2.x и совместим с IDEA Community/Ultimate
2023.3 — 2024.3 (`since-build=233`, `until-build=243.*`).

## Возможности

| Возможность | Что реализовано |
|---|---|
| Файлы | `*.lat`, file type «Latent», иконка |
| Лексер | рукописный (без JFlex): 37 ключевых слов (24 жёстких + 13 мягких), операторы, числа (`42`, `3.14`, `1e10`, `1.5e-3`), строки с escape `\n \t \\ \"`, вложенные `/* */`, `//`, `@`-декораторы |
| Подсветка | KEYWORD, SOFT_KEYWORD, TYPE, STRING, NUMBER, BOOLEAN, COMMENT, OPERATOR, FUNCTION_DECL, CLASS_DECL, ANNOTATION, AI_PRIMITIVE, IDENTIFIER; страница **Settings → Editor → Color Scheme → Latent** |
| Аннотации | незакрытая строка/комментарий, неверный escape/число, неожиданный символ, несогласованные скобки |
| Автодополнение | ключевые слова, типы, builtins из `language.json`, функции/классы/enum текущего файла, методы после `.`, декораторы после `@` |
| Сниппеты | live templates: `fn`, `let`, `if`, `ifelse`, `while`, `for`, `forin`, `class`, `enum`, `match`, `lambda`, `spawn`, `select`, `test`, `assert`, `ai_generate`, `ai_infer`, `ai_contract` |
| Навигация | Structure View (функции, классы с методами, enum с вариантами) |
| Редактирование | сворачивание `{ ... }`, классов/enum и блочных комментариев; парные скобки; Enter с отступом 4 пробела; автозакрытие кавычек; комментарии `//` и `/* */` |
| Запуск | конфигурация **Latent**: компиляция через `latentc`, fallback — `web-ide/compiler.wasm`, запуск WASM в Node.js с `env.print` и exit code по `main` |
| Новый файл | шаблон `Latent Main.lat` в диалоге New → File |

## Сборка

Требования:

* JDK 17 (проверено на Temurin 17.0.20.1);
* доступ в сеть для загрузки Gradle 8.10.2 и IntelliJ Platform 2024.2.

```bash
cd editors/idea
export JAVA_HOME=/path/to/jdk-17      # Windows: $env:JAVA_HOME="C:\...\jdk-17"
./gradlew buildPlugin                 # Windows: .\gradlew.bat buildPlugin
```

Готовый архив: `build/distributions/latent-idea-1.0.0.zip`.

Проверки:

```bash
./gradlew test                          # 45+ тестов: лексер, структура, отступы,
                                        # JSON-данные, парсер/аннотатор/completion на платформе
./gradlew verifyPluginProjectConfiguration
```

> Примечание: `verifyPluginProjectConfiguration` выдаёт предупреждения о том, что
> `since-build=233` ниже целевой платформы 2024.2 и что платформа 2024.2 рекомендует
> `sourceCompatibility=21`. Плагин сознательно собирается под JDK 17 и байткод 17,
> чтобы работать во всех IDEA 2023.3–2024.3.

## Установка

1. Соберите архив (`./gradlew buildPlugin`) или возьмите готовый
   `build/distributions/latent-idea-1.0.0.zip`.
2. IDEA → **Settings → Plugins → ⚙ → Install Plugin from Disk…**
3. Выберите zip и перезапустите IDE.
4. Откройте любой `.lat`-файл (например, `web-ide/examples/functions.lat`).

## Настройки

**Settings → Tools → Latent**:

| Поле | Назначение | По умолчанию |
|---|---|---|
| Путь к `latentc` | компилятор Latent (`latentc compile <file> <out.wasm>`) | `latentc` (поиск в `PATH`) |
| Путь к `node` | Node.js для запуска WASM и fallback-компиляции | `node` |
| Путь к `compiler.wasm` | необязательный `web-ide/compiler.wasm` | `<project>/web-ide/compiler.wasm`, затем встроенная копия |

Если `latentc` не найден, плагин компилирует через `compiler.wasm` (C-ABI
`latent_alloc` / `latent_compile`) тем же Node-runner'ом. Встроенная копия
`runner/compiler.wasm` — снимок `web-ide/compiler.wasm` на момент сборки плагина;
её можно переопределить в настройках.

## Запуск

* **Run → Edit Configurations… → + → Latent** — выберите `.lat`-файл.
* Или нажмите правой кнопкой в редакторе → **Run 'Latent …'** (плагин создаст
  конфигурацию для текущего файла).
* Горячая клавиша запуска — стандартная `Ctrl+Shift+F10`.

Компиляция выполняется во временный `*.wasm`, затем запускается
`node runner/latent-runner.mjs run <file>.wasm`. Строки Latent читаются из линейной памяти
как `[len u32 LE][utf8]`; `print` выводит аргументы отдельными строками; exit code —
результат `main` (модуль 256).

## Горячие клавиши

| Действие | Клавиши |
|---|---|
| Автодополнение | `Ctrl+Space` |
| Структура файла | `Alt+7` / `Ctrl+F12` |
| Свернуть/развернуть блок | `Ctrl+-` / `Ctrl++` |
| Комментарий | `Ctrl+/` |
| Запуск | `Ctrl+Shift+F10` |

## Ограничения

* Плагин **не заменяет компилятор**: диагностика типов, неопределённых имён и арности
  остаётся за `latentc`/`latentc check`. Аннотатор показывает только лексические и
  структурные проблемы, чтобы не давать ложных срабатываний.
* Нет форматтера, рефакторингов, отладчика и LSP-клиента; Structure View построен на
  эвристическом разборе токенов (как и задумано для этого плагина).
* Host-only примитивы (`tensor`, `ai_infer`, каналы, `spawn`/`select`) в движке №2
  дают ошибку компиляции — это ограничение языка, а не плагина.
* Для запуска нужен Node.js; для компиляции — `latentc` либо `compiler.wasm`.
* Плагин не подключает Kotlin stdlib и не содержит сторонних зависимостей (JSON
  разбирается Gson из состава IntelliJ Platform).

## Публикация в JetBrains Marketplace

1. Убедитесь, что версия в `build.gradle.kts` (`pluginConfiguration.version`) обновлена.
2. `./gradlew buildPlugin` — получите zip.
3. Подпишите: `./gradlew signPlugin` (нужны `CERTIFICATE_CHAIN`, `PRIVATE_KEY`,
   `PRIVATE_KEY_PASSWORD`).
4. Загрузите через [Marketplace](https://plugins.jetbrains.com/) или
   `./gradlew publishPlugin` с токеном `PUBLISH_TOKEN`.
5. Плагин ид `dev.latent.idea`, имя «Latent», vendor — Latent Language.

## Структура

```
editors/idea/
  build.gradle.kts, settings.gradle.kts, gradle.properties
  gradle/wrapper/                   Gradle 8.10.2
  src/main/java/dev/latent/idea/    лексер, PSI, подсветка, completion, annotator,
                                    folding, structure view, run configuration, settings
  src/main/resources/
    META-INF/plugin.xml, pluginIcon.svg
    language/latent-language.json   копия tooling/language-data/language.json
    liveTemplates/Latent.xml        сниппеты
    runner/latent-runner.mjs        запуск и fallback-компиляция
    runner/compiler.wasm            встроенный компилятор (fallback)
    fileTemplates/internal/Latent Main.lat.ft
  src/test/java/dev/latent/idea/    JUnit-тесты и BasePlatformTestCase
```
