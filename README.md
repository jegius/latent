# Latent

**AI-native язык программирования, компилируемый в WebAssembly.**
Rust-компилятор, self-hosted компилятор на самом Latent, браузерная IDE и полноценная
инфраструктура: документация, MCP-сервер документации, плагины для VS Code и IntelliJ IDEA.

[![Docs](https://img.shields.io/badge/docs-jegius.github.io%2Flatent-blue)](https://jegius.github.io/latent/)
[![Playground](https://img.shields.io/badge/playground-open-3574f0)](https://jegius.github.io/latent/playground/)
[![Self-hosted](https://img.shields.io/badge/self--hosted-fixed%20point-success)](selfhost/README.md)

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
- тесты и проверки: `@test`, `assert`, `assert_eq`, `@forall`, `snapshot`.

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
mcp/docs-mcp/        MCP-сервер документации (stdio + HTTP) для нейросетей
editors/vscode/      Расширение VS Code (подсветка, сниппеты, LSP, запуск)
editors/idea/        Плагин IntelliJ IDEA (подсветка, completion, LSP, запуск)
scripts/             build-wasm.sh, sync-playground.mjs, verify-wasm.mjs, ...
```

## Разработка

```pwsh
cargo test                                  # тесты Rust-компилятора
node --test "web-ide/test/*.test.js"        # тесты web IDE
node --test "selfhost/test/*.test.mjs"      # регресс self-hosted компилятора
node selfhost/bootstrap.mjs                 # bootstrap: stage2 === stage3

cd docs && pnpm install && pnpm run build   # сборка документации
node docs/scripts/validate-examples.mjs     # проверка примеров из доки
```

Публикация сайта и playground на GitHub Pages выполняется автоматически workflow
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) при push в `main` /
`part10-toolchain`: документация попадает в `/latent/`, IDE — в `/latent/playground/`.

## Документация

Полное описание языка — в [`docs/`](docs/README.md):

- **Начало работы:** установка, hello world, CLI, web IDE;
- **Туториал:** от первой программы до capstone-проекта;
- **Гайд:** синтаксис, типы, операторы, функции, массивы/строки, классы, enum/match,
  лямбды, ошибки, конкурентность, AI-фичи, тесты и контракты, память и WASM;
- **Справочник:** грамматика, лексика, типы, операторы, builtins, ошибки, CLI, WASM ABI;
- **Спецификации:** self-hosted компилятор, паритет с Rust, два движка, кодоген;
- **Tooling:** IDE, LSP, MCP, плагины, bootstrap.

Для нейросетей: `docs/static/llms.txt` (индекс) и `llms-full.txt` (полный текст), а также
MCP-сервер `mcp/docs-mcp` (stdio/HTTP) с tools `search_docs`, `read_doc`,
`get_language_reference`, `get_example`, `check_code`.

## Лицензия

Проект распространяется в том виде, в котором находится в репозитории (см. `LICENSE`,
если файл присутствует). Уточните лицензию у владельца репозитория перед использованием
в сторонних проектах.
