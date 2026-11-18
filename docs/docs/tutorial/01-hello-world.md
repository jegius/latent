---
title: "Глава 1. Hello, world"
sidebar_label: "01. Hello, world"
sidebar_position: 2
description: Первая программа на Latent — main, print, комментарии и код возврата.
---

# Глава 1. Hello, world

## Программа

```latent
// Первая программа на Latent.
// Точка входа — функция main. Она возвращает int — код возврата.

fn main() -> int {
    print("Hello, world!");
    return 0;
}
```

Запустите её в [playground](../getting-started/web-ide.mdx) кнопкой **Run** или
скомпилируйте в WASM:

```bash
cargo build --bin latentc
./target/debug/latentc compile hello.lat hello.wasm
```

Чтобы увидеть результат выполнения в Node.js, используйте host-рантайм из
главы [Hello, world (getting-started)](../getting-started/hello-world.md).

## Что здесь важно

- **`fn main() -> int`** — точка входа. Компилятор экспортирует `main` из
  WASM-модуля; host вызывает её и получает `int`.
- **`return 0;`** — код возврата. `0` — успех, ненулевое значение — ошибка.
  Если `main` объявлена без `return`, компилятор подставит `0`.
- **`print(...)`** — встроенная функция; принимает любое число аргументов.
- **Комментарии**: `//` до конца строки и `/* ... */` (блоки можно вкладывать).

## Несколько строк

```latent
fn main() -> int {
    print("Latent");
    print("compiles to WebAssembly");
    let answer = 42;
    print("answer:", answer);
    return 0;
}
```

В движке №2 `print` вызывает host-функцию `env.print` для **каждого**
аргумента — поэтому `answer` окажется на отдельной строке. В движке №1 все
аргументы печатаются одной строкой через пробел. Это первое заметное различие
движков; остальные собраны в
[руководстве](../guide/wasm-and-execution.md#ограничения-движка-2).

## Комментарии

```latent
/* Блочный комментарий.
   /* Блоки можно вкладывать. */
   Всё это — комментарий. */

fn main() -> int {
    let x = 10; // строчный комментарий до конца строки
    print(x /* комментарий в середине выражения */ + 5);
    return 0;
}
```

## Упражнение

Напишите программу, которая печатает ваше имя и текущий год, а возвращает
`0`. Затем измените код возврата на `7` и проверьте его в Node.js:

```bash
node run.mjs hello.wasm
echo "exit code: $?"
# exit code: 7
```

Дальше: [Переменные и типы](./02-variables-and-types.md).
