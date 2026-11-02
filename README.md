# Latent

**AI-native язык программирования, компилируемый в WebAssembly.**
Rust-компилятор, self-hosted компилятор на самом Latent, браузерная IDE и полноценная
инфраструктура: документация, MCP-сервер документации, плагины для VS Code и IntelliJ IDEA.

[![Docs](https://img.shields.io/badge/docs-jegius.github.io%2Flatent-blue)](https://jegius.github.io/latent/)
[![Playground](https://img.shields.io/badge/playground-open-3574f0)](https://jegius.github.io/latent/playground/)
[![Self-hosted](https://img.shields.io/badge/self--hosted-fixed%20point-success)](selfhost/README.md)
[![Coverage](https://img.shields.io/badge/coverage-rust%2091%25%20%C2%B7%20web--ide%2099.8%25-success)](#качество-кода)

- 📖 **Документация:** https://jegius.github.io/latent/
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
Latent** (`selfhost/`, bootstrap с фиксированной точкой `stage2 === stage3`).

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
src/                 Rust-компилятор Latent → WASM (лексинг, парсинг, тайпчек, кодоген)
selfhost/            Self-hosted компилятор на самом Latent (bootstrap, фиксированная точка)
web-ide/             Браузерная IDE: движок №1 (JS-интерпретатор) и движок №2 (Rust→WASM)
docs/                Docusaurus-сайт с полной документацией языка
tooling/language-data/  Machine-readable описание языка (keywords/builtins/types)
tooling/latent-lsp/  LSP-сервер: диагностика, completion, hover, форматирование
tooling/selfhost-coverage/  Инструментальное покрытие self-hosted компилятора
mcp/docs-mcp/        MCP-сервер документации (stdio + HTTP) для нейросетей
editors/vscode/      Расширение VS Code (подсветка, сниппеты, LSP, запуск)
editors/idea/        Плагин IntelliJ IDEA (подсветка, completion, запуск)
scripts/             build-wasm.sh, sync-playground.mjs, check-golden.mjs, coverage-rust.ps1
```

## Качество кода

| Компонент | Тесты | Покрытие строк |
|---|---|---|
| Rust-компилятор (`src/`) | 265 | **91.00%** (`scripts/coverage-rust.ps1`, llvm-cov) |
| web IDE (`web-ide/`) | 337 | **99.79%** (branch 97.51%) |
| MCP-сервер (`mcp/docs-mcp/`) | 235 | **96.01%** |
| LSP-сервер (`tooling/latent-lsp/`) | 133 | — |
| VS Code extension (`editors/vscode/`) | 70 | 98.77% |
| Self-hosted компилятор (`selfhost/`) | 141 | function coverage — `tooling/selfhost-coverage` |

Код декомпозирован по SOLID: в Rust и JS ни один файл не превышает ~300–350 строк,
`selfhost/src/*.lat` — ≤300 строк на часть (см. [ARCHITECTURE.md](ARCHITECTURE.md)).
Кодировка, стиль и правила — [docs/tooling/contributing](docs/docs/tooling/contributing.md).

## Разработка

```pwsh
cargo test                                  # тесты Rust-компилятора
cargo build --release --target wasm32-unknown-unknown   # свежий compiler.wasm
node --test "web-ide/test/*.test.js"        # тесты web IDE (337)
node --test "selfhost/test/*.test.mjs"      # регресс self-hosted компилятора (141)
node selfhost/build.mjs && node selfhost/bootstrap.mjs  # bootstrap: stage2 === stage3
node scripts/check-golden.mjs               # байт-в-байт совместимость WASM
node --test "mcp/docs-mcp/test/*.test.mjs"  # MCP (235)
node --test "tooling/latent-lsp/test/*.test.mjs"  # LSP (133)

cd docs && pnpm install && pnpm run build   # сборка документации
node docs/scripts/validate-examples.mjs     # проверка примеров из доки
```

Публикация сайта и playground — автоматически workflow
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) при push в `main` /
`part10-toolchain`: документация попадает в `/latent/`, IDE — в `/latent/playground/`.
Сборка плагинов — [`.github/workflows/plugins.yml`](.github/workflows/plugins.yml)
(артефакты `.vsix` и IDEA zip), проверки — [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Документация для AI

- `https://jegius.github.io/latent/llms.txt` — индекс документации (llmstxt.org);
- `https://jegius.github.io/latent/llms-full.txt` — полный текст документации;
- MCP-сервер `mcp/docs-mcp` (stdio/HTTP): `search_docs`, `read_doc`,
  `get_language_reference`, `get_example`, `check_code` — подключение к
  Claude Desktop / Claude Code / Cursor / VS Code описано в
  [`mcp/docs-mcp/README.md`](mcp/docs-mcp/README.md);
- полный справочник языка — [`docs/docs/reference/complete-language.md`](docs/docs/reference/complete-language.md).

## Лицензия

Проект распространяется в том виде, в котором находится в репозитории (см. `LICENSE`,
если файл присутствует). Уточните лицензию у владельца репозитория перед использованием
в сторонних проектах.
