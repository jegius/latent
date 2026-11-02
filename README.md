# Latent

**AI-native язык программирования, компилируемый в WebAssembly.**
Rust-компилятор, self-hosted компилятор на самом Latent, браузерная IDE и полноценная
инфраструктура: документация на двух языках, MCP-сервер документации, плагины для
VS Code и IntelliJ IDEA.

[![Docs RU](https://img.shields.io/badge/docs-%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-blue)](https://jegius.github.io/latent/)
[![Docs EN](https://img.shields.io/badge/docs-english-blue)](https://jegius.github.io/latent/en/)
[![Playground](https://img.shields.io/badge/playground-open-3574f0)](https://jegius.github.io/latent/playground/)
[![Self-hosted](https://img.shields.io/badge/self--hosted-fixed%20point-success)](selfhost/README.md)
[![Coverage](https://img.shields.io/badge/coverage-rust%2091%25%20%C2%B7%20web--ide%2099.8%25%20%C2%B7%20mcp%2099.7%25-success)](#качество-кода)

- 📖 **Документация:** https://jegius.github.io/latent/ (RU) · https://jegius.github.io/latent/en/ (EN)
- 🧪 **Web IDE (playground):** https://jegius.github.io/latent/playground/
- 🤖 **MCP-сервер документации:** [`mcp/docs-mcp`](mcp/docs-mcp/README.md)
- 🧩 **Плагины:** [VS Code](editors/vscode/README.md) · [IntelliJ IDEA](editors/idea/README.md)
- 🏗 **Архитектура:** [ARCHITECTURE.md](ARCHITECTURE.md)
- ✅ **Self-hosted компилятор:** [`selfhost/`](selfhost/README.md)

## Что такое Latent

Latent — статически типизированный язык в духе TypeScript/Rust/Go, который компилируется
в компактный WebAssembly-модуль и запускается в браузере или в Node.js. В языке есть:

- переменные, функции, классы, перечисления, `match`, замыкания;
- массивы и строки с методами, встроенные примитивы линейной памяти;
- `async`/`await`, горутины `spawn`, каналы, `select`/`yield` (host-рантайм);
- AI-примитивы: `ai_infer`, `ai_embed`, `tensor`/`semantic`, `ai_generate!`, контракты;
- тесты и проверки: `test "name" { ... }`, `assert`, `assert_eq`, `@forall`, `snapshot`.

Компилятор Latent→WASM написан на Rust (`src/`) и **самостоятельно реализован на самом
Latent** (`selfhost/`, bootstrap с фиксированной точкой `stage2 === stage3`, паритет с
эталоном 64/65, функциональное покрытие 93.5%).

### Latent в вебе и фронтенде

Latent задуман как **WASM-ядро для веб-приложений**: тяжёлая логика (алгоритмы, парсинг,
валидация, обработка данных) компилируется в компактный модуль, а UI остаётся на
JS/React/Vue/Svelte. В документации — отдельный раздел с проверенными кейсами:

- [Latent во фронтенде](docs/docs/guide/web-and-frontend.md) — ABI, интеграция с
  React/Vue/Svelte/Vite, Web Workers, Cache API, ленивая загрузка и чанки, ограничения;
- [Latent в браузере за 5 минут](docs/docs/getting-started/web-browser.md) — готовый
  HTML + `WebAssembly.instantiate`;
- **[интерактивные демо](https://jegius.github.io/latent/demos/)** — бенчмарк
  JS против Latent→WASM (hash, sieve, matmul, quicksort, UTF-8), фильтры изображений
  на canvas и физика 30 000 частиц: живые метрики, без сборки и зависимостей,
  с компиляцией `.lat` прямо в браузере (см.
  [разбор](docs/docs/examples/frontend-showcase.md));
- примеры: [калькулятор](docs/docs/examples/frontend-calculator.md),
  [обработка данных](docs/docs/examples/frontend-data-processing.md),
  [строки и UTF-8](docs/docs/examples/frontend-strings.md),
  [React-компонент](docs/docs/examples/frontend-react.md),
  [canvas/визуализация](docs/docs/examples/frontend-canvas.md),
  [свой playground на compiler-as-WASM](docs/docs/examples/frontend-compiler-playground.md).

## Быстрый старт

```pwsh
# 1. Собрать компилятор (Rust toolchain)
cargo build --bin latentc

# 2. Скомпилировать программу в WASM
target/debug/latentc compile hello.lat hello.wasm

# 3. Запустить WASM (Node.js, хост-функция env.print)
node -e "const fs=require('fs');const inst=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync('hello.wasm')),{env:{print:(p)=>{const m=inst.exports.memory.buffer,d=new DataView(m),l=d.getUint32(p,true);console.log(Buffer.from(m,p+4,l).toString())}}});inst.exports.main()"
```

```latent
// hello.lat
fn main() -> int {
    let name = "Latent";
    print("Привет, " + name + "!");
    return 0;
}
```

Проще всего — в браузерной IDE: откройте
[playground](https://jegius.github.io/latent/playground/), вставьте код и нажмите **Run**.

## Структура репозитория

```
src/                 Rust-компилятор Latent → WASM (лексер, парсер, тайпчек, кодоген)
selfhost/            Self-hosted компилятор на самом Latent (23 части, bootstrap)
web-ide/             Браузерная IDE: движок №1 (JS-интерпретатор) и движок №2 (Rust→WASM)
docs/                Docusaurus-сайт: RU + EN (i18n), llms.txt, playground
tooling/language-data/  Machine-readable описание языка (keywords/builtins/types)
tooling/latent-lsp/  LSP-сервер: диагностика, completion, hover, форматирование
tooling/selfhost-coverage/  Инструментальное покрытие self-hosted компилятора
mcp/docs-mcp/        MCP-сервер документации (stdio + HTTP) для нейросетей
editors/vscode/      Расширение VS Code (подсветка, сниппеты, LSP, запуск)
editors/idea/        Плагин IntelliJ IDEA (подсветка, completion, запуск)
scripts/             sync-playground, check-golden, coverage-rust, verify-all
```

## Качество кода

| Компонент | Тесты | Покрытие |
|---|---|---|
| Rust-компилятор (`src/`) | 265 | **91.00%** строк (llvm-cov, `scripts/coverage-rust.ps1`) |
| web IDE (`web-ide/`) | 368 | **99.53%** строк / 96.98% ветвей |
| MCP-сервер (`mcp/docs-mcp/`) | 300 | **99.67%** строк / 96.45% ветвей (src) |
| LSP-сервер (`tooling/latent-lsp/`) | 133 | — |
| VS Code extension (`editors/vscode/`) | 70 | 98.77% строк |
| IntelliJ IDEA plugin (`editors/idea/`) | 49 | сборка `buildPlugin` в CI |
| Self-hosted компилятор (`selfhost/`) | 166 | **94.56%** функций / 96.68% строк (`tooling/selfhost-coverage`) |

Код декомпозирован по SOLID: в Rust и JS нет файлов больше ~300–350 строк,
`selfhost/src/*.lat` — ≤300 строк на часть (23 части, max 278; см.
[ARCHITECTURE.md](ARCHITECTURE.md) и [selfhost-style.md](docs/docs/specs/selfhost-style.md)).

## Разработка

```pwsh
cargo test                                  # тесты Rust-компилятора
cargo build --release --target wasm32-unknown-unknown   # свежий compiler.wasm
node --test "web-ide/test/*.test.js"        # тесты web IDE (337)
node --test "selfhost/test/*.test.mjs"      # регресс self-hosted компилятора (141)
node selfhost/build.mjs && node selfhost/bootstrap.mjs  # bootstrap: stage2 === stage3
node tooling/selfhost-coverage/run.mjs --min 90         # покрытие selfhost
node scripts/check-golden.mjs               # байт-в-байт совместимость WASM
node --test "mcp/docs-mcp/test/*.test.mjs"  # MCP (300)
node --test "tooling/latent-lsp/test/*.test.mjs"  # LSP (133)
node scripts/verify-all.mjs                 # все быстрые проверки одной командой

cd docs && pnpm install && pnpm run build   # сборка документации (RU + EN)
node docs/scripts/validate-examples.mjs     # проверка примеров (RU)
LATENT_DOCS_DIR=docs/i18n/en/docusaurus-plugin-content-docs/current \
  node docs/scripts/validate-examples.mjs   # проверка примеров (EN)
```

## Публикация

- **Документация + web IDE:** GitHub Pages, workflow
  [`.github/workflows/pages.yml`](.github/workflows/pages.yml) при push в `main` /
  `part10-toolchain`: RU — `/latent/`, EN — `/latent/en/`, IDE — `/latent/playground/`.
- **Плагины:** [`.github/workflows/plugins.yml`](.github/workflows/plugins.yml) собирает
  `.vsix` (VS Code) и zip (IntelliJ IDEA) как артефакты.
- **Проверки:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — cargo test,
  покрытие Rust, selfhost bootstrap, тесты web IDE/доки/MCP/LSP.

## Документация для AI

- `https://jegius.github.io/latent/llms.txt` / `llms-full.txt` — RU;
- `https://jegius.github.io/latent/llms-en.txt` / `llms-en-full.txt` — EN;
- MCP-сервер `mcp/docs-mcp` (stdio/HTTP): `search_docs`, `read_doc`,
  `get_language_reference`, `get_example`, `check_code` — подключение к
  Claude Desktop / Claude Code / Cursor / VS Code описано в
  [`mcp/docs-mcp/README.md`](mcp/docs-mcp/README.md);
- сводный справочник: [`reference/complete-language`](docs/docs/reference/complete-language.md)
  (RU) и [EN](docs/i18n/en/docusaurus-plugin-content-docs/current/reference/complete-language.md).

## Лицензия

Проект распространяется в том виде, в котором находится в репозитории (см. `LICENSE`,
если файл присутствует). Уточните лицензию у владельца репозитория перед использованием
в сторонних проектах.
