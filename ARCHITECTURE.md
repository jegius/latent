# Архитектура репозитория Latent

Latent — язык программирования, компилируемый в WebAssembly, с self-hosted
компилятором, браузерной IDE и набором инструментов. В репозитории живут
**две независимые реализации языка** и экосистема вокруг них.

## 1. Компоненты верхнего уровня

| Компонент | Путь | Язык | Роль |
|---|---|---|---|
| Rust-компилятор («движок №2») | `src/` | Rust | `lexer → parser → typechecker → codegen` в WASM-модуль; C-ABI для браузера |
| CLI компилятора | `src/bin/latentc.rs` | Rust | `latentc compile/check/version` |
| Self-hosted компилятор | `selfhost/` | Latent | `selfhost/src/*.lat` → `shc.lat` → stage1/2/3, фиксированная точка |
| JS-интерпретатор («движок №1») | `web-ide/compiler/` | JS | исполнение Latent в браузере напрямую (AST-walker) |
| Web IDE | `web-ide/` | HTML/JS | playground: редактор, движки №1/№2, примеры, форматтер |
| Документация | `docs/` | Markdown + Docusaurus | руководство, справочник, спецификации, туториал |
| MCP-сервер документации | `mcp/docs-mcp/` | Node (zero deps) | доступ AI к докам: tools/resources/prompts, stdio и HTTP |
| LSP + данные о языке | `tooling/latent-lsp/`, `tooling/language-data/` | Node | completion/hover/diagnostics/formatting для редакторов |
| Плагины IDE | `editors/vscode/`, `editors/idea/` | JS / Kotlin | подсветка, запуск, LSP-клиент, диагностика |
| Golden/регрессия | `scripts/check-golden.mjs`, `scripts/golden/` | Node | байт-в-байт проверка WASM и поведенческие прогоны |
| Покрытие | `scripts/coverage-rust.ps1` | PowerShell | llvm-cov по `src/` (включая обходной путь для Windows-gnu) |

## 2. Движки: почему их два

* **Движок №1 (`web-ide/compiler/*.js`)** — интерпретатор: парсит Latent в JS-AST
  и исполняет его. Умеет host-фичи (каналы, AI, тензоры), но не компилирует в WASM.
* **Движок №2 (`src/`, собранный в `web-ide/compiler.wasm`)** — настоящий
  компилятор в WASM. Исполняется браузером, host-фичи, требующие рантайма
  (каналы, AI, промисы), дают понятную ошибку или компилируются в суррогат
  (`spawn` → последовательно, `select` → первая ветка, `await` → passthrough).

Один и тот же исходник должен вести себя согласованно; расхождения и известные
ограничения зафиксированы в
[`docs/docs/specs/rust-architecture.md`](docs/docs/specs/rust-architecture.md)
и документации `reference/`.

## 3. Потоки данных

```
                 ┌────────────── web-ide (браузер) ──────────────┐
 source.lat ──►  │ движок №1: JS-интерпретатор  → результат       │
                 │ движок №2: compiler.wasm:                     │
                 │   latent_alloc → latent_compile → [status,len, │
                 │   payload]  (payload = .wasm или текст ошибки)│
                 └───────────────────────────────────────────────┘
```

```
 src/** ──cargo build --release --target wasm32-unknown-unknown──► latent.wasm
        └─cargo build --bin latentc──► latentc.exe
 latentc.exe + selfhost/shc.lat ──► stage1.wasm ──► stage2.wasm ──► stage3.wasm
                                    stage2 == stage3  (FIXED POINT)
```

```
 tooling/language-data/language.json ──► tooling/latent-lsp ──► editors/{vscode,idea}
                                      └─► docs (справочники генерируются/сверяются)
 docs/docs/**.md ──► mcp/docs-mcp (индекс + поиск) ──► AI-клиенты
```

## 4. Инварианты

1. **`latent::compile_source` и C-ABI** (`latent_alloc`, `latent_free`,
   `latent_compile`, `latent_version`) — стабильный контракт для web-ide и
   `scripts/build-wasm.sh`. Менять имена/формат буфера нельзя.
2. **Golden-WASM**: декомпозиция и рефакторинг Rust-компилятора не меняют ни
   одного байта выходного модуля на golden-наборе
   (`node scripts/check-golden.mjs`).
3. **Self-hosted фиксированная точка**: `stage2.wasm === stage3.wasm`,
   `node selfhost/bootstrap.mjs` печатает `FIXED POINT`.
4. **Стиль**: комментарии/документация — русский, идентификаторы — английский,
   UTF-8 без BOM; исходные файлы Rust — < 350 строк (данные и тесты-наборы —
   осознанные исключения).
5. **Публичные проверки**: `cargo test`, `node --test` для web-ide/selfhost/
   tooling/mcp, сборка docs — зелёные.

## 5. Как собирать и проверять

```pwsh
# Rust-компилятор
cargo +stable-x86_64-pc-windows-gnu test
cargo +stable-x86_64-pc-windows-gnu build --release --target wasm32-unknown-unknown
node scripts/check-golden.mjs           # байт-в-байт + поведение
pwsh scripts/coverage-rust.ps1          # покрытие строк (llvm-cov)

# Self-hosted компилятор (в копии каталога, чтобы не мешать параллельным работам)
node selfhost/build.mjs && node selfhost/bootstrap.mjs
node --test "selfhost/test/*.test.mjs"

# Web IDE и инструменты
node --test "web-ide/test/*.test.js"
node --test "tooling/latent-lsp/test/*.test.mjs"
node --test "mcp/docs-mcp/test/*.test.mjs"

# Документация
cd docs && npm install && npm run build
```

## 6. Окружение (Windows)

* Rust: `C:\Users\Admin\.cargo\bin\cargo.exe`, toolchain
  `stable-x86_64-pc-windows-gnu` (MSVC-линкера в системе нет).
* MinGW: `C:\Users\Admin\tools\mingw\mingw64\bin` — обязательно в `PATH`.
* Node: `C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`.
* JDK 17 — для сборки IntelliJ-плагина.

Подробная карта Rust-компилятора, C-ABI, инвариантов кодогена и решений по
декомпозиции — в
[`docs/docs/specs/rust-architecture.md`](docs/docs/specs/rust-architecture.md).
