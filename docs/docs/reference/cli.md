---
title: "CLI: latentc"
description: "Команды и аргументы компилятора latentc, коды возврата, формат вывода, запуск полученного WASM в Node и ABI main/print."
sidebar_position: 8
---

# CLI `latentc`

Источник: `src/bin/latentc.rs`. `latentc` — единственный бинарник пакета
(`Cargo.toml`, `[lib] crate-type = ["cdylib", "rlib"]`; бинарник объявлен в
`src/bin/latentc.rs`). Версия — `0.1.0`.

## Сборка

```bash
cargo build --bin latentc
# бинарник: target/debug/latentc (или target/release/latentc)
```

На Windows без MSVC-линкера собирайте под GNU-таргет (см.
[tooling/bootstrap](../tooling/bootstrap.md)):

```powershell
cargo build --bin latentc --target x86_64-pc-windows-gnu
# C:\...\latent\target\x86_64-pc-windows-gnu\debug\latentc.exe
```

## Команды

```text
latentc compile <file.lat> [out.wasm]   — скомпилировать файл в WASM
latentc check <file.lat>                — лексинг + парсинг + типизация + кодоген
latentc version | --version | -v        — версия компилятора
```

Строка использования, которую печатает бинарник при ошибке/без аргументов:

```text
latentc 0.1.0
usage:
  latentc compile <file.lat> [out.wasm]
  latentc check <file.lat>
  latentc version
```

### `latentc compile`

- `out.wasm` необязателен. По умолчанию путь = входной путь без завершающего
  `.lat` + `.wasm` (`path.trim_end_matches(".lat") + ".wasm"`). Например
  `examples/sorting.lat` → `examples/sorting.wasm`.
- При успехе в stdout: `<вход> -> <выход> (<N> bytes)`.
- При ошибке компиляции в stderr: `error: <диагностика>` (см.
  [errors](./errors.md)); файл не создаётся.
- I/O-ошибки: `cannot read <path>: <причина>`, `cannot write <out>: <причина>`.

```bash
latentc compile examples/sorting.lat && node run.js examples/sorting.wasm
```

### `latentc check`

Полный проход компиляции (включая кодоген), но файл не пишется:

- успех: `ok: <N> bytes of wasm`;
- ошибка: `error: <диагностика>`.

Несмотря на название, `check` — это не только синтаксическая проверка: он
компилирует программу до конца, поэтому ловит и ошибки кодогена (например
`Builtin 'tensor' не поддерживается…`).

## Коды возврата

| Код | Когда |
|---|---|
| `0` | успех (`compile`, `check`, `version`) |
| `1` | ошибка компиляции/чтения/записи, неверные аргументы, неизвестная команда |
| `101` | panic Rust (например, файл с UTF-8 BOM в debug-сборке) |

Других кодов нет. `check`/`compile` на битом файле печатают `error: <диагностика>`
и возвращают `1`; файл при ошибке не создаётся.

:::warning
**BOM не поддерживается.** Файл `UTF-8 with BOM` ломает лексер: wasm-сборка
выдаёт ошибку с некорректной колонкой, а debug-сборка `latentc` падает
(exit 101). Сохраняйте исходники без BOM.
:::

## Запуск полученного WASM в Node

Модуль программы (не компилятора!) импортирует `env.print(i32)` и экспортирует
`memory` и `main` (если `main` объявлена). Минимальный хост:

```js
import { readFileSync } from 'node:fs';

const bytes = readFileSync('examples/sorting.wasm');
const { instance } = await WebAssembly.instantiate(bytes, {
  env: {
    print: (ptr) => {
      const dv = new DataView(instance.exports.memory.buffer);
      const len = dv.getUint32(ptr, true);            // [len u32 LE][utf8]
      const text = new TextDecoder().decode(
        new Uint8Array(instance.exports.memory.buffer, ptr + 4, len));
      console.log(text);
    },
  },
});

const result = instance.exports.main();   // i32 (или f64, если main -> float)
console.log('main() =', result);
```

Особенности:

- `print` вызывается **на каждый аргумент**, поэтому `print("x =", x)` в
  движке №2 даёт две строки.
- Если `main` не объявлена, модуль валиден, но экспорта `main` нет — хост
  должен это учитывать.
- Если `main` объявлена с параметрами (`fn main(a: int)`), экспорт всё равно
  типа `(params...) -> i32`; вызов без аргументов даёт нулевые значения (это
  валидный WASM, но не «нормальный» сценарий).
- Если программа использует host-only фичи, компиляция завершится ошибкой —
  такого WASM просто не будет.

## Запуск WASM-компилятора (движок №2)

`compiler.wasm` — это сам компилятор, собранный под `wasm32-unknown-unknown`
(`cargo build --release --target wasm32-unknown-unknown`). Его ABI — не
`env.print`, а `latent_alloc/latent_compile/latent_free/latent_version`:

```js
const bytes = readFileSync('web-ide/compiler.wasm');
const { instance } = await WebAssembly.instantiate(bytes, {});
const ex = instance.exports;

const enc = new TextEncoder().encode('fn main() -> int { return 42; }');
const srcPtr = ex.latent_alloc(enc.length);
new Uint8Array(ex.memory.buffer).set(enc, srcPtr);
const resPtr = ex.latent_compile(srcPtr, enc.length);

const dv = new DataView(ex.memory.buffer);
const status = dv.getUint32(resPtr, true);      // 1 — wasm, 0 — ошибка
const len = dv.getUint32(resPtr + 4, true);
const payload = new Uint8Array(ex.memory.buffer, resPtr + 8, len).slice();
```

Подробный контракт — в [WASM ABI](./wasm-abi.md#c-abi-компилятора-движок-2-в-браузере).

## Связанные разделы

- [WASM ABI](./wasm-abi.md) — что именно экспортирует/импортирует модуль.
- [Диагностики](./errors.md) — тексты, которые печатает CLI.
- [tooling/bootstrap](../tooling/bootstrap.md) — сборка компилятора и
  self-hosted цепочки.
