---
title: Установка
sidebar_label: Установка
sidebar_position: 1
description: Требования и сборка Rust-компилятора latentc, WASM-движка №2 (compiler.wasm) и docs.
---

# Установка

Есть три вещи, которые можно собрать/запустить:

1. **Rust-компилятор `latentc`** — CLI: `.lat` → `.wasm`, проверка синтаксиса и
   типов.
2. **Движок №2 для браузера** — `web-ide/compiler.wasm` (тот же Rust-код,
   собранный под `wasm32-unknown-unknown`).
3. **Документация и playground** — Docusaurus-сайт в `docs/`.

## Требования

| Компонент | Что нужно |
|---|---|
| Компилятор `latentc` | Rust (stable) с cargo; на Windows — линкер (MSVC или MinGW) |
| Движок №2 (`compiler.wasm`) | `rustup target add wasm32-unknown-unknown` |
| Web IDE, тесты, docs | Node.js ≥ 18 (рекомендуется 20+), pnpm для docs |
| Docusaurus | Node.js ≥ 18, pnpm |

Проверить окружение:

```bash
rustc --version
cargo --version
node --version
```

## 1. Клонирование

```bash
git clone https://github.com/jegius/latent
cd latent
git checkout part10-toolchain
```

## 2. Сборка CLI `latentc`

```bash
cargo build --bin latentc
```

Бинарник появится в `target/debug/latentc` (`target\debug\latentc.exe` на
Windows). Проверьте:

```bash
./target/debug/latentc version
# latentc 0.1.0
```

Если на Windows нет MSVC-линкера, используйте GNU-тулчейн с MinGW:

```pwsh
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup run stable-x86_64-pc-windows-gnu cargo build --bin latentc
```

Возможна и release-сборка:

```bash
cargo build --release --bin latentc
```

## 3. Сборка движка №2 (`compiler.wasm`)

Добавьте WASM-цель:

```bash
rustup target add wasm32-unknown-unknown
```

Затем — скриптом (bash; он сам ищет rustup-тулчейн, у которого есть `std`
для wasm32):

```bash
bash scripts/build-wasm.sh
# Using cargo: ...
# OK: compiler.wasm = <N> bytes -> web-ide/
```

Скрипт кладёт артефакт в `web-ide/compiler.wasm` и копию в
`web-ide/latent.wasm`. Ручной эквивалент (например, на Windows без bash):

```pwsh
cargo build --release --target wasm32-unknown-unknown
Copy-Item target\wasm32-unknown-unknown\release\latent.wasm web-ide\compiler.wasm
Copy-Item target\wasm32-unknown-unknown\release\latent.wasm web-ide\latent.wasm
```

Проверка, что модуль действительно компилирует Latent:

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('web-ide/compiler.wasm');WebAssembly.instantiate(b,{env:{print(){}}}).then(({instance})=>{const e=instance.exports;console.log('compiler ok, version ptr', e.latent_version());});"
```

## 4. Node-окружение: тесты и проверки

```bash
node --test "web-ide/test/*.test.js"
node --test "selfhost/test/*.test.mjs"
node scripts/verify-wasm.mjs target/debug/hello.wasm --run
```

Компилятор и примеры не требуют npm-зависимостей: только Node.js и
`web-ide/compiler.wasm`.

## 5. Документация (этот сайт)

```bash
cd docs
pnpm install
pnpm run build      # соберёт llms.txt и статический сайт в docs/build/
pnpm run start      # dev-сервер с hot reload
```

Проверить все ` ```latent `-примеры документации компилятором:

```bash
node docs/scripts/validate-examples.mjs
```

Зависимости для docs ставятся через pnpm; `npm install` не используется.
Каталог `docs/node_modules` в git не попадает.

## 6. Playground локально

Playground — это копия `web-ide/` в `docs/static/playground/`, которую при
сборке сайта делает `scripts/sync-playground.mjs`. Для запуска без Docusaurus:

```bash
cd web-ide
python3 -m http.server 8000
# открыть http://localhost:8000
```

Важно: открывать `web-ide/index.html` как `file://` нельзя — браузер заблокирует
загрузку `compiler.wasm`; нужен HTTP-сервер.

## Частые проблемы

| Симптом | Причина и решение |
|---|---|
| `error: linker 'link.exe' not found` (Windows) | Нет MSVC — соберите через `stable-x86_64-pc-windows-gnu` |
| `error[E0463]: can't find crate for 'std'` при wasm-сборке | Не установлена цель: `rustup target add wasm32-unknown-unknown` |
| `web-ide/compiler.wasm` отсутствует | Движок №2 не собран; IDE останется на движке №1 |
| docs: `onBrokenLinks` падает | Битая внутренняя ссылка; используйте относительные ссылки на `.md` |
| `validate-examples` падает | В документации появился невалидный `latent`-блок — см. сообщение |

Дальше: [Hello, world](./hello-world.md) → [CLI](./cli.md) →
[Web IDE](./web-ide.mdx).
