---
title: Hello, world
sidebar_label: Hello, world
sidebar_position: 2
description: Первая программа на Latent — компиляция в WASM и запуск в Node.js и в playground.
---

# Hello, world

Создайте файл `hello.lat`:

```latent
fn main() -> int {
    print("Hello, world!");
    return 0;
}
```

Точка входа — функция `main`. Она должна вернуть `int` (код возврата); если
`main` не объявлена, модуль скомпилируется, но экспорта `main` в нём не будет.

## Компиляция

```bash
cargo build --bin latentc
./target/debug/latentc compile hello.lat hello.wasm
# hello.lat -> hello.wasm (NNN bytes)
```

На Windows путь к бинарнику — `target\debug\latentc.exe`:

```pwsh
cargo build --bin latentc
.\target\debug\latentc.exe compile hello.lat hello.wasm
```

Быстрая проверка без записи файла:

```bash
./target/debug/latentc check hello.lat
# ok: NNN bytes of wasm
```

## Запуск в Node.js

Скомпилированный модуль импортирует `env.print(i32)` и экспортирует `main` и
`memory`. `print` в WASM-модуле получает **указатель на строку**; строка в
линейной памяти имеет формат `[длина u32 LE][байты UTF-8]`.

Сохраните рядом с `hello.wasm` файл `run.mjs`:

```javascript
// run.mjs — минимальный host-рантайм для WASM-модуля Latent.
import {readFileSync} from 'node:fs';

const bytes = readFileSync(process.argv[2] || 'hello.wasm');
let instance;

const imports = {
  env: {
    print: (ptr) => {
      const view = new DataView(instance.exports.memory.buffer);
      const len = view.getUint32(ptr, true);
      const text = new TextDecoder().decode(
        new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
      );
      console.log(text);
    },
  },
};

instance = await WebAssembly.instantiate(bytes, imports);

if (typeof instance.exports.main !== 'function') {
  console.error('в модуле нет экспортированной main()');
  process.exit(2);
}
const code = instance.exports.main();
process.exitCode = typeof code === 'number' ? code : 0;
```

Запуск:

```bash
node run.mjs hello.wasm
# Hello, world!
```

`process.exitCode` станет `0`, потому что `main` вернула `0`.

Есть и готовый отладочный скрипт в репозитории:

```bash
node scripts/verify-wasm.mjs hello.wasm --run
# validate: ok
# instantiate: ok
# Hello, world!
# main() = 0
```

## Запуск в playground

В браузере тот же исходник можно исполнить кнопкой **Run** — это движок №1
(JS-интерпретатор). Кнопка **Compile / Engine #2** прогоняет Rust-компилятор и
показывает WASM-байты, но не исполняет их: чтобы запустить скомпилированный
модуль, используйте host-рантайм из этой главы. Откройте
[playground](./web-ide.mdx) и попробуйте оба режима.

## Что произошло под капотом

1. Лексер разбил исходник на токены (`src/lexer/`).
2. Парсер построил AST (`src/parser/`).
3. Типчекер проверил программу и вывел типы (`src/typechecker/`).
4. Кодогенератор собрал бинарный WASM-модуль (`src/codegen/`):
   секции типов, импортов, функций, памяти, экспортов, кода и данных.
5. Host инстанцировал модуль, передав `env.print`, и вызвал `main`.

Обратите внимание на строки: строковый литерал живёт в секции `data` модуля и
кодируется как `[длина][UTF-8]`. Именно поэтому `print` берёт указатель, а не
строку JS.

## Упражнение

Скомпилируйте программу, которая печатает несколько значений и возвращает
осмысленный код:

```latent
fn main() -> int {
    let year = 2026;
    let language = "Latent";
    print(language + " ready in", year);
    return 42;
}
```

```bash
./target/debug/latentc compile hello.lat hello.wasm
node run.mjs hello.wasm
echo "exit code: $?"
# Latent ready in 2026
# exit code: 42
```

Дальше: [CLI компилятора](./cli.md) → [Web IDE](./web-ide.mdx) →
[Туториал](../tutorial/index.md).
