# Latent

**AI-native язык программирования, компилируемый в WebAssembly.**
Rust-компилятор, self-hosted компилятор на самом Latent, файловые модули, браузерная IDE
и полноценная инфраструктура: документация на двух языках, killer-демо, MCP-сервер
документации, плагины для VS Code и IntelliJ IDEA.

[![Docs RU](https://img.shields.io/badge/docs-%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-blue)](https://jegius.github.io/latent/)
[![Docs EN](https://img.shields.io/badge/docs-english-blue)](https://jegius.github.io/latent/en/)
[![Playground](https://img.shields.io/badge/playground-open-3574f0)](https://jegius.github.io/latent/playground/)
[![Demos](https://img.shields.io/badge/demos-8%20killer%20features-ff2d95)](https://jegius.github.io/latent/demos/)
[![Self-hosted](https://img.shields.io/badge/self--hosted-fixed%20point-success)](selfhost/README.md)
[![Coverage](https://img.shields.io/badge/coverage-rust%2092%25%20%C2%B7%20web--ide%2097.5%25%20%C2%B7%20selfhost%20100%25-success)](#качество-кода)

- 📖 **Документация:** https://jegius.github.io/latent/ (RU) · https://jegius.github.io/latent/en/ (EN)
- 🎯 **Killer-фичи:** [guide/killer-features](docs/docs/guide/killer-features.md) — почему Latent, а не JS/TS
- 🧪 **Web IDE (playground):** https://jegius.github.io/latent/playground/ (модули, оба движка)
- 💥 **Killer-демо:** https://jegius.github.io/latent/demos/ — горутины/каналы, AI-native,
  self-hosted компилятор в браузере, WASM-песочница, модули, бенчмарки, canvas, физика
- 🤖 **MCP-сервер документации:** [`mcp/docs-mcp`](mcp/docs-mcp/README.md)
- 🧩 **Плагины:** [VS Code](editors/vscode/README.md) · [IntelliJ IDEA](editors/idea/README.md)
- 🏗 **Архитектура:** [ARCHITECTURE.md](ARCHITECTURE.md)
- ✅ **Self-hosted компилятор:** [`selfhost/`](selfhost/README.md) — без Rust (seed + WASM)

## Что такое Latent

Latent — статически типизированный язык в духе TypeScript/Rust/Go, который компилируется
в компактный WebAssembly-модуль и запускается в браузере или в Node.js. В языке есть:

- **CSP-конкурентность как синтаксис:** `spawn`, `channel()`, `ch <- v`, `<-ch`, `select`, `yield`;
- **AI-native примитивы в грамматике:** `ai_infer`, `ai_embed`, `ai_stream`/`stream_next`,
  `tensor`/`semantic`/`matmul`/`cosine_similarity`, `ai_generate!`, контракты;
- **файловые модули:** `import { a, b as c } from "./x.lat";`, `export fn/class/enum`,
  линковка на этапе компиляции (CLI, web IDE, `latentc bundle` для selfhost);
- переменные, функции, классы, перечисления, `match`, замыкания;
- массивы/строки, встроенные примитивы линейной памяти (`alloc`, `load8`, `store32`, …);
- тесты: `test "name" { ... }`, `assert`, `assert_eq`, `@forall`, `snapshot`.

Компилятор Latent→WASM написан на Rust (`src/`) и **самостоятельно реализован на самом
Latent** (`selfhost/`, bootstrap с фиксированной точкой `stage2 === stage3`; компиляция
без Rust из `seed.wasm`; паритет 64/65, поведенческий паритет модулей).

### Killer-фичи и модули

- [Killer-фичи Latent](docs/docs/guide/killer-features.md) — честный разбор: CSP-горутины,
  AI в синтаксисе, self-hosted компилятор в браузере, WASM-песочница,
  детерминированная память, модули, dual-engine; где JS/TS выигрывают.
- [Модули](docs/docs/guide/modules.md) — синтаксис, линковка, CLI `bundle`, web IDE,
  selfhost и ограничения v1.

```latent
// math.lat
export fn square(x: int) -> int { return x * x; }
export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
    fn norm2() -> int { return square(this.x) + square(this.y); }
}

// main.lat
import { square, Point } from "./math.lat";
fn main() -> int { return (new Point(3, 4)).norm2(); } // 25
```

```pwsh
target/debug/latentc compile main.lat main.wasm   # читает дерево импортов с диска
target/debug/latentc bundle  main.lat bundle.lat  # плоский bundle для selfhost
```

### Latent в вебе и фронтенде

Latent задуман как **WASM-ядро для веб-приложений**: тяжёлая логика (алгоритмы, парсинг,
валидация, обработка данных, конкурентные пайплайны) компилируется в компактный модуль,
а UI остаётся на JS/React/Vue/Svelte. В документации — отдельный раздел и живые демо:

- [Latent во фронтенде](docs/docs/guide/web-and-frontend.md) — ABI, интеграция с
  React/Vue/Svelte/Vite, Web Workers, Cache API, ленивая загрузка и чанки;
- [Latent в браузере за 5 минут](docs/docs/getting-started/web-browser.md);
- **[killer-демо](https://jegius.github.io/latent/demos/)**:
  [горутины и каналы](https://jegius.github.io/latent/demos/concurrency/),
  [AI-native](https://jegius.github.io/latent/demos/ai/),
  [self-hosted компилятор в браузере](https://jegius.github.io/latent/demos/selfhost/),
  [WASM-песочница](https://jegius.github.io/latent/demos/sandbox/),
  [модули](https://jegius.github.io/latent/demos/modules/),
  [бенчмарк JS vs WASM](https://jegius.github.io/latent/demos/bench/),
  [canvas-фильтры](https://jegius.github.io/latent/demos/image/),
  [физика 30 000 частиц](https://jegius.github.io/latent/demos/physics/);
- примеры: [калькулятор](docs/docs/examples/frontend-calculator.md),
  [обработка данных](docs/docs/examples/frontend-data-processing.md),
  [строки и UTF-8](docs/docs/examples/frontend-strings.md),
  [React-компонент](docs/docs/examples/frontend-react.md),
  [canvas](docs/docs/examples/frontend-canvas.md),
  [свой playground](docs/docs/examples/frontend-compiler-playground.md).

## Быстрый старт

```pwsh
# 1. Собрать компилятор (Rust; для компиляции пользовательских программ Rust не обязателен:
#    есть self-hosted bootstrap из seed.wasm)
cargo build --bin latentc

# 2. Скомпилировать программу (многофайловый проект — тоже)
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
[playground](https://jegius.github.io/latent/playground/), создайте нужные файлы
(дерево проекта) и нажмите **Run**.

## Структура репозитория

```
src/                 Rust-компилятор Latent → WASM (+ src/modules: загрузчик, линкер, bundle)
selfhost/            Self-hosted компилятор на самом Latent (23 части, seed.wasm, fixed point)
web-ide/             Браузерная IDE: движок №1 (JS-интерпретатор с модулями/host-фичами)
                     и движок №2 (Rust→WASM, Vite-чанки, модульный ABI)
docs/                Docusaurus-сайт: RU + EN (79+79 страниц), llms.txt, playground, демо
docs/static/demos/   Killer-демо: concurrency/ai/selfhost/sandbox/modules + bench/image/physics
tooling/language-data/  Machine-readable описание языка (keywords/builtins/types)
tooling/latent-lsp/  LSP-сервер: диагностика, completion, hover, форматирование
tooling/selfhost-coverage/  Инструментальное покрытие self-hosted компилятора
mcp/docs-mcp/        MCP-сервер документации (stdio + HTTP) для нейросетей
editors/vscode/      Расширение VS Code (подсветка, сниппеты, LSP, запуск)
editors/idea/        Плагин IntelliJ IDEA (подсветка, completion, запуск)
scripts/             sync-playground, check-golden, coverage-rust, check-embedded-wasm, verify-all
```

## Качество кода

| Компонент | Тесты | Покрытие |
|---|---|---|
| Rust-компилятор (`src/`, включая модули) | 351 | **92.11%** строк (llvm-cov, `scripts/coverage-rust.ps1`) |
| web IDE (`web-ide/`) | 414 | **97.51%** строк / 91.47% ветвей |
| Self-hosted компилятор (`selfhost/`) | 173 | **100%** функций / 97.94% строк (`tooling/selfhost-coverage`) |
| MCP-сервер (`mcp/docs-mcp/`) | 300 | **99.67%** строк / 96.45% ветвей (src) |
| LSP-сервер (`tooling/latent-lsp/`) | 146 | **94.59%** строк / 94.00% функций |
| VS Code extension (`editors/vscode/`) | 70 | 98.77% строк |
| IntelliJ IDEA plugin (`editors/idea/`) | 49 | сборка `buildPlugin` в CI |

Код декомпозирован по SOLID: в Rust и JS нет файлов больше ~350 строк,
`selfhost/src/*.lat` — ≤300 строк на часть (23 части, max 279; см.
[ARCHITECTURE.md](ARCHITECTURE.md) и [selfhost-style.md](docs/docs/specs/selfhost-style.md)).
Golden-набор: `node scripts/check-golden.mjs --strict` — 48/48 (поведение + модульные
fixtures, без SKIP).

## Разработка

```pwsh
node scripts/verify-all.mjs --golden        # единая проверка всего репозитория
cargo test --all-targets                    # Rust-компилятор (351 тест)
node scripts/check-golden.mjs --strict      # байт-в-байт WASM + модульные fixtures
node selfhost/build.mjs && node selfhost/bootstrap.mjs       # fixed point (Rust)
node selfhost/bootstrap-wasm.mjs            # fixed point без Rust (seed)
node --test "selfhost/test/*.test.mjs"      # selfhost (173)
node --test "web-ide/test/*.test.js" "web-ide/test/*.test.mjs"  # web IDE (414)
node --test "mcp/docs-mcp/test/*.test.mjs"  # MCP (300)
node --test "tooling/latent-lsp/test/*.test.mjs"  # LSP (146)

node docs/static/demos/build-demos.mjs      # wasm-модули демо, vendor-интерпретатор, seed
cd docs && pnpm install && pnpm run build   # сборка документации (RU + EN)
node docs/scripts/validate-examples.mjs     # примеры RU; EN — через LATENT_DOCS_DIR
```

## Публикация

- **Документация + playground + демо:** GitHub Pages, workflow
  [`.github/workflows/pages.yml`](.github/workflows/pages.yml) при push в `main` /
  `part10-toolchain`: RU — `/latent/`, EN — `/latent/en/`, IDE — `/latent/playground/`,
  демо — `/latent/demos/`.
- **Плагины:** [`.github/workflows/plugins.yml`](.github/workflows/plugins.yml) собирает
  `.vsix` (VS Code) и zip (IntelliJ IDEA) как артефакты.
- **Проверки:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — cargo test,
  покрытие Rust, golden, selfhost (Rust + Rust-free), web IDE, docs, MCP/LSP, IDEA.

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
