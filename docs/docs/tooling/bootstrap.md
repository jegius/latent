---
title: "Bootstrap и пересборка"
description: "Как собрать latentc, пересобрать compiler.wasm для web IDE, собрать self-hosted компилятор и прогнать тесты; проверки для контрибьюторов."
sidebar_position: 5
---

# Bootstrap и пересборка

Шпаргалка для контрибьюторов: как пересобрать компилятор, WASM для IDE,
self-hosted компилятор, документацию и прогнать проверки.

## Что нужно

| Инструмент | Версия/путь (в окружении проекта) |
|---|---|
| Rust + cargo | `C:\Users\Admin\.cargo\bin\cargo.exe` (1.99.x) |
| wasm-target | `rustup target add wasm32-unknown-unknown` (уже установлен) |
| Node.js | `C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` (v24) |
| JDK 17 (для IDEA-плагина) | `C:\Users\Admin\Documents\deepseek-harness\default-workspace\tools\jdk17` |
| MinGW (для нативного `latentc` на Windows) | `C:\Users\Admin\tools\mingw` |

На Windows нет MSVC-линкера, поэтому нативный бинарник собирается под
GNU-таргет `x86_64-pc-windows-gnu`.

Rust нужен только для `latentc` и разового восстановления seed. Сборка
self-hosted компилятора и пользовательских программ идёт **без Rust** — см.
[«Сборка без Rust-тулчейна»](#сборка-без-rust-тулчейна).

## 1. Нативный `latentc`

```powershell
cd C:\Users\Admin\IdeaProjects\latent
# обычный путь (если есть линкер):
cargo build --bin latentc
# Windows без MSVC:
cargo build --bin latentc --target x86_64-pc-windows-gnu
```

Бинарники:

- `target/debug/latentc(.exe)` — обычная сборка;
- `target/x86_64-pc-windows-gnu/debug/latentc.exe` — GNU-сборка.

`selfhost/bootstrap.mjs` ищет `target/debug/latentc` по умолчанию; путь можно
переопределить переменной `LATENTC`.

## 2. `compiler.wasm` для web IDE (движок №2)

```bash
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/latent.wasm web-ide/compiler.wasm
cp target/wasm32-unknown-unknown/release/latent.wasm web-ide/latent.wasm
```

`scripts/build-wasm.sh` делает то же, но **жёстко ищет macOS/arm-toolchain**
(`stable-aarch64-apple-darwin`) — на Windows/Linux используйте команды выше или
поправьте `TOOLCHAIN_DIR` в скрипте.

:::note
**Поставляемый `web-ide/compiler.wasm` актуален**: он собран из текущих `src/`
и содержит memory-builtins (`alloc`, `load8`, `store8`, `load32`, `store32`,
`memcopy`), `spawn`/`yield`/`async`/`await`/`select`, `test`-блоки, модульный ABI
(`latent_compile_files`, `latent_bundle_files`) и актуальные фиксы. Проверено:
`alloc(8)` + `store8`/`store32`/`load8`/`load32`/`memcopy` компилируются в
валидный WASM.

- Артефакт: `web-ide/compiler.wasm` = `web-ide/latent.wasm` (651 473 байт,
  версия `latent 0.1.0`), пересобран из текущего `src/` (включая модули).
- `docs/scripts/validate-examples.mjs` валидирует блоки **этим** файлом: при
  пересборке `compiler.wasm` перезапустите проверку — часть маркеров
  «не компилируется» может устареть.
- Встроенная копия в IDEA-плагине
  (`editors/idea/src/main/resources/runner/compiler.wasm`) синхронизирована с
  этим же артефактом (`node scripts/check-embedded-wasm.mjs`).
:::

## 3. Self-hosted компилятор

```bash
# 1) пересобрать shc.lat из частей (детерминированно)
node selfhost/build.mjs

# 2) bootstrap: stage1 -> stage2 -> stage3, проверить фиксированную точку
node selfhost/bootstrap.mjs
# ожидается: FIXED POINT: stage2 === stage3
```

- `build.mjs` конкатенирует `selfhost/src/*.lat` в отсортированном порядке;
  `shc.lat` — генерируемый файл, не редактируйте вручную.
- `bootstrap.mjs` использует `latentc` (`LATENTC` для переопределения),
  компилирует `shc.lat`, затем компилирует им самим, сравнивает байты.
- ABI компилятора: вход по адресу 3145728, выход по 65536 (см.
  [selfhost](../specs/selfhost.md#abi-компилятора)); поставляемая
  читалка/писалка — в `bootstrap.mjs`.

### Сборка без Rust-тулчейна

Rust нужен только для **первой** сборки компилятора. В репозитории лежит
`selfhost/seed.wasm` — уже собранный selfhost-компилятор (sha256 в
`selfhost/seed.json`), которым можно собрать `shc.lat` и замкнуться без
`cargo`/`latentc`:

```bash
# shc.lat из частей — только Node
node selfhost/build.mjs

# seed -> stage1' -> stage2' -> stage3'; ожидается FIXED POINT (без Rust)
node selfhost/bootstrap-wasm.mjs

# то же, но не писать stage-sh-*.wasm
node selfhost/bootstrap-wasm.mjs --no-write
```

Цепочка и артефакты:

```text
seed.wasm        -> shc.lat -> selfhost/stage-sh-1.wasm
stage-sh-1.wasm  -> shc.lat -> selfhost/stage-sh-2.wasm
stage-sh-2.wasm  -> shc.lat -> selfhost/stage-sh-3.wasm
stage-sh-2 === stage-sh-3   (FIXED POINT, stage2' === stage3')
```

`stage-sh-*.wasm` покрыты `.gitignore` и не пересекаются с `stage1/2/3.wasm`
Rust-цепочки.

**CLI без Rust** — seed работает как обычный компилятор:

```bash
node selfhost/wasm-compiler.mjs compile hello.lat        # -> hello.wasm
node selfhost/wasm-compiler.mjs check hello.lat          # код 1 + текст ошибки
node selfhost/wasm-compiler.mjs run hello.lat            # print() + main()
node selfhost/wasm-compiler.mjs version                  # версия, sha256, fixed point
node selfhost/wasm-compiler.mjs version --compiler selfhost/stage-sh-2.wasm
```

**Обновление seed** после правок `selfhost/src/*.lat` (без Rust):

```bash
node selfhost/build.mjs
node selfhost/bootstrap-wasm.mjs                  # сначала проверьте FIXED POINT
node selfhost/bootstrap-wasm.mjs --refresh-seed   # новый seed.wasm + seed.json
node selfhost/bootstrap-wasm.mjs --refresh-seed --dry-run   # только diff
node selfhost/bootstrap-wasm.mjs --verify-seed    # sha256 seed + shc.lat
```

`--refresh-seed` пишет файлы только при фиксированной точке, печатает diff
(размеры, sha256, число/смещение отличающихся байт) и обновляет `seed.json`
(`seedSha256`, `seedBytes`, `shcSha256`, `shcBytes`, `seedRevision`, даты).
`seed.wasm` и `seed.json` коммитятся вместе. Коммитить stage-артефакты не нужно.

`seed` — доверенная начальная точка: `bootstrap-wasm.mjs` сверяет его sha256 с
`seed.json` при каждом запуске (несовпадение — код 2). Проверить вручную:
`node selfhost/bootstrap-wasm.mjs --verify-seed` или `sha256sum selfhost/seed.wasm`.

Ограничение: обновление без Rust работает, пока текущий seed компилирует новый
`shc.lat`. Если изменение требует новой конструкции языка, один раз нужен Rust
(`node selfhost/bootstrap.mjs --update-seed`), после чего снова можно без Rust.

## 4. Документация и playground

```bash
# playground для Docusaurus (Lead): копирует web-ide/ -> docs/static/playground/
node scripts/sync-playground.mjs

cd docs
pnpm install
pnpm run build            # docusaurus build (onBrokenLinks: throw)
pnpm run start            # dev-сервер: http://localhost:3000/latent/
node scripts/validate-examples.mjs   # все ```latent блоки
```

- `validate-examples.mjs` компилирует **все** блоки ```latent в
  `docs/docs/**`, используя `web-ide/compiler.wasm`; блоки, помеченные
  `// ошибка: ...` / `// Не компилируется движком №2: ...` (или
  `latent expected-error`), ожидаются невалидными.
- `docs/static/playground/` — копия `web-ide/` (без `node_modules`, тестов и
  README); публикуется по `/latent/playground/`.

## 5. Полный набор проверок

```bash
# Rust: 265 тестов
cargo test
# покрытие Rust (llvm-cov, обход GNU-ld): 91.00% строк / 93.53% функций
pwsh scripts/coverage-rust.ps1
# golden-набор: 48 программ совпали байт-в-байт, 0 расхождений, 0 пропусков
node scripts/check-golden.mjs

# selfhost: 173 теста, покрытие 100% функций / 97.94% строк + фиксированная точка (Rust-путь)
node selfhost/build.mjs
node selfhost/bootstrap.mjs                 # FIXED POINT
node --test "selfhost/test/*.test.mjs"

# selfhost без Rust: только Node (CI job selfhost-norust)
node selfhost/build.mjs
node selfhost/bootstrap-wasm.mjs            # FIXED POINT (stage2' === stage3')
node selfhost/wasm-compiler.mjs version
node --test selfhost/test/bootstrap-wasm.test.mjs

# web-ide: 414 тестов, 97.51% строк / 91.47% ветвей / 98.52% функций
cd web-ide && pnpm test
cd web-ide && pnpm coverage
cd web-ide && pnpm run check:structure

# docs: 79 страниц RU + 79 EN; llms.txt/llms-en.txt генерируются сборкой
cd docs && pnpm install && pnpm run build
node docs/scripts/validate-examples.mjs     # 213 блоков: 173 валидны, 34 помечены, 6 module-part

# mcp: 300 тестов
node --test "mcp/docs-mcp/test/*.test.mjs"

# lsp: 146 тестов
node --test "tooling/latent-lsp/test/*.test.mjs"

# vscode: 70 тестов (покрытие строк 98.77%), собран latent-1.0.0.vsix
node --check editors/vscode/src/extension.js
node --test "editors/vscode/test/*.test.mjs"

# idea (нужен JDK 17): Gradle buildPlugin
cd editors/idea && ./gradlew buildPlugin
```

Ожидания: всё зелёное; `bootstrap.mjs` печатает `FIXED POINT`.

:::note Про IDEA-плагин
`buildPlugin` требует JDK 17, Gradle 8.10.2 (скачивается wrapper'ом) и
IntelliJ Platform 2024.2 из сети. Если Java-процесс не может писать в каталог
репозитория (встречалось в песочнице DSH), сборка идёт в копии каталога в
рабочей папке. Подробности и текущий статус — в [IntelliJ IDEA](./idea.md).
:::

## Частые проблемы

| Симптом | Причина/решение |
|---|---|
| `linker 'link.exe' not found` | нет MSVC: собирайте `--target x86_64-pc-windows-gnu` (нужен MinGW) |
| `can't find crate for std` при wasm-сборке | не установлен `wasm32-unknown-unknown`: `rustup target add …` |
| `build-wasm.sh` не находит toolchain | скрипт рассчитан на macOS/arm; используйте `cargo build --target wasm32-unknown-unknown` |
| `bootstrap.mjs: spawn latentc ENOENT` | соберите `latentc` или задайте `LATENTC` |
| `bootstrap-wasm.mjs: seed.json не совпадает с seed.wasm` | seed повреждён/подменён; восстановите из git или пересоберите доверенным компилятором (`--refresh-seed`), проверьте `--verify-seed` |
| `stage-sh-2 !== stage-sh-3` | `shc.lat` не воспроизводит себя: устарел seed или регрессия; пересоберите `build.mjs`, проверьте Rust-цепочкой, затем `--refresh-seed` |
| `seed не скомпилировал shc.lat: error: ...` | новый `shc.lat` использует конструкции, которых нет в текущем seed; разово соберите Rust-путь (`node selfhost/bootstrap.mjs --update-seed`) |
| `stage2 !== stage3` | изменился `src/`/`shc.lat` без пересборки; пересоберите `build.mjs`; несовпадение — регрессия |
| `validate-examples: компилятор не найден` | нет `web-ide/compiler.wasm` — соберите (п. 2) |
| IDE не грузит движок №2 | `compiler.wasm` недоступен; проверьте Network и вкладку WASM |
| IDEA: `AccessDeniedException: ...\.intellijPlatform` | Java-процесс не может писать в каталог репозитория (песочница); соберите копию каталога в рабочей папке (см. [idea](./idea.md)) |
| IDEA: `Could not create parent directory for lock file ...gradle-8.10.2-bin` | задайте `GRADLE_USER_HOME` в путь, куда Java может писать |

## Связанные разделы

- [Self-hosted компилятор](../specs/selfhost.md)
- [CLI `latentc`](../reference/cli.md)
- [WASM ABI](../reference/wasm-abi.md)
- [Contributing](./contributing.md)
