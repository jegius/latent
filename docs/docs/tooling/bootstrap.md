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

:::warning
**Поставляемый `web-ide/compiler.wasm` старше текущих `src/`**: в нём нет
memory-builtins (`alloc`, `load8`, `store8`, `load32`, `store32`, `memcopy`) и
части фиксов. Поэтому:

- `docs/scripts/validate-examples.mjs` валидирует блоки **этим** файлом
  (пересборка меняет результаты);
- в IDE `alloc(...)` даст «Неопределённая переменная 'alloc'».

Пересоберите `compiler.wasm` перед публикацией, если нужны свежие фичи.
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
# Rust
cargo test

# selfhost
node selfhost/build.mjs
node selfhost/bootstrap.mjs                 # FIXED POINT
node --test "selfhost/test/*.test.mjs"

# web-ide
node --test "web-ide/test/*.test.js"

# docs
cd docs && pnpm install && pnpm run build
node docs/scripts/validate-examples.mjs

# mcp
node --test "mcp/docs-mcp/test/*.test.mjs"

# lsp
node --test "tooling/latent-lsp/test/*.test.mjs"

# vscode
node --check editors/vscode/src/extension.js
node --test "editors/vscode/test/*.test.mjs"

# idea (нужен JDK 17)
cd editors/idea && ./gradlew buildPlugin
```

Ожидания: всё зелёное; `bootstrap.mjs` печатает `FIXED POINT`.

## Частые проблемы

| Симптом | Причина/решение |
|---|---|
| `linker 'link.exe' not found` | нет MSVC: собирайте `--target x86_64-pc-windows-gnu` (нужен MinGW) |
| `can't find crate for std` при wasm-сборке | не установлен `wasm32-unknown-unknown`: `rustup target add …` |
| `build-wasm.sh` не находит toolchain | скрипт рассчитан на macOS/arm; используйте `cargo build --target wasm32-unknown-unknown` |
| `bootstrap.mjs: spawn latentc ENOENT` | соберите `latentc` или задайте `LATENTC` |
| `stage2 !== stage3` | изменился `src/`/`shc.lat` без пересборки; пересоберите `build.mjs`; несовпадение — регрессия |
| `validate-examples: компилятор не найден` | нет `web-ide/compiler.wasm` — соберите (п. 2) |
| IDE не грузит движок №2 | `compiler.wasm` недоступен/старый; проверьте Network и версию |

## Связанные разделы

- [Self-hosted компилятор](../specs/selfhost.md)
- [CLI `latentc`](../reference/cli.md)
- [WASM ABI](../reference/wasm-abi.md)
- [Contributing](./contributing.md)
