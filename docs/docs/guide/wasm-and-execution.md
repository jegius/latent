---
title: WASM и исполнение
sidebar_label: WASM и исполнение
sidebar_position: 16
description: ABI скомпилированного модуля, запуск в Node.js, различия движков и полный список ограничений движка №2.
---

# WASM и исполнение

## Что генерирует компилятор

`compile_source` (`src/lib.rs`) — чистый конвейер
лексер → парсер → typechecker → кодоген, результат — байты WASM-модуля.

### Импорты

Ровно **один** импорт:

```text
env.print : (i32) -> ()
```

Функция `env.print` получает указатель на строку в линейной памяти. Все функции
модуля сдвинуты на 1 относительно индекса импорта.

### Экспорты

- `memory` — линейная память модуля (начальный размер 16 страниц, `max` нет);
- `main` — **только если** объявлена верхнеуровневая `fn main`;
  тип результата — `i32`, `f64` (при `-> float`) или void.

Без `main` модуль валиден, но экспортирует только память.

### Строки

Строка в памяти — `[len u32 LE][байты UTF-8]`, указатель — на `len`.
`print` вызывается на каждый аргумент отдельно; хост читает `len`, затем
`len` байт.

Эталонный host-шим — `scripts/verify-wasm.mjs`; в браузере — `web-ide/`.

### Хелперы модуля (не экспортируются)

`__latent_alloc`, `__latent_mem_copy`, `__latent_str_len`,
`__latent_str_concat`, `__latent_str_eq`, `__latent_str_char_at`,
`__latent_i32_to_str`, `__latent_f64_to_str`, `__latent_str_to_i32`.

## Запуск в Node.js

```javascript
// run.mjs — минимальный WASM-хост для Latent.
import {readFileSync} from 'node:fs';

const bytes = readFileSync(process.argv[2]);
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
const code = instance.exports.main?.() ?? 0;
process.exitCode = typeof code === 'number' ? code : 0;
```

```bash
./target/debug/latentc compile hello.lat hello.wasm
node run.mjs hello.wasm
```

Готовые проверки:

```bash
node scripts/verify-wasm.mjs hello.wasm --run --expect=0
node scripts/integration.mjs         # сквозные примеры через latentc
```

## Различия движков

| Конструкция | №2 (Rust → WASM) | №1 (JS-интерпретатор) |
|---|---|---|
| `7 / 2` | `3` (усечение `i32`) | `3.5` (все числа float) |
| `"привет".length` | `12` (UTF-8 байты) | `6` (UTF-16 units) |
| `"abc"[1]` | `98` (байт) | `"b"` (символ) |
| `[1] == [1]` | `0` (указатели) | `1` (структурно) |
| `print(true)` | `1` | `true` |
| `print(null)` | `0` | `null` |
| `print([1,2])` | число-указатель | `[1, 2]` |
| `print(1.5)` | `1.500000` | `1.5` |
| `print("a", 1)` | две строки | одна строка `a 1` |
| `enum` | ✅ | ❌ `Unexpected token '{'` |
| битовые операторы | ✅ | ❌ ошибка лексера |
| блочные комментарии | ✅ | ❌ `Unexpected token '/'` |
| `for (let c in "abc")` | ❌ ошибка типов | ✅ 3 итерации |
| `async`/`await` | суррогат (passthrough) | промисы |
| `spawn`/`select`/`yield` | суррогаты | планировщик |
| `channel`, AI, тензоры | ❌ ошибка host-рантайма | ✅ |
| `test`-блоки | не исполняются | исполняются после `main` |
| `1e3` | `1000.0` | `1` (экспонента не поддержана) |
| `1.2.3` | ошибка парсинга | `1.2` |

## Host-фичи в браузере: как запускать

Движок №2 — это **компилятор host-free подмножества**; каналы, AI, тензоры и
контракты он сознательно отвергает. Но в playground это не означает, что
программа не запускается: браузерная IDE автоматически выбирает движок №1.

1. `CompilerService.compileForRun()` ищет host-фичи по токенам исходника
   (`web-ide/compiler/host-features.js`): `channel`, `<-`, `send`/`recv`,
   `spawn`, `select`, `yield`, `tensor`, `semantic`, `matmul`, `ai_*`,
   `test`, `snapshot`, контракты.
2. Host-программа компилируется и исполняется движком №1; если движок №2 был
   загружен, в статус-баре остаётся `engine #1 (host runtime)`.
3. Чистая программа по-прежнему компилируется движком №2 для вкладки WASM.
4. Если №2 вернул ошибку «требует host-рантайма» (или любую другую), Run
   откатывается на №1; ошибка №2 не показывается как финальная.

Пример: `web-ide/examples/channels.lat` запускается обычным Run и даёт

```text
producing 1
...
consumer finished: 5 items, sum = 55
fan-in total: 730
Result: 730
```

AI-примеры в обычном Run включают **mock** автоматически (сеть и ключ не
нужны). Для реальной модели используйте **Run with AI** — тогда работают
настроенный AI Gateway, pre-fetch и self-repair.

При явном выборе **Engine #2** host-программа не компилируется: IDE показывает
объяснение и кнопку **Run in engine #1**, чтобы можно было сразу перейти к
полному рантайму. Переписывать движок №2 под host-фичи не требуется.

## Ограничения движка №2

### Host-примитивы: ошибка, а не заглушка

```text
Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)
Builtin 'ai_infer' не поддерживается движком №2 (требует host-рантайма)
Builtin 'tensor' не поддерживается движком №2 (требует host-рантайма)
Метод 'send' не поддерживается движком №2 (требует host-рантайма)
```

Полный список: `channel`, `tensor`, `semantic`, `matmul`,
`cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones`, `snapshot`,
`ai_contract`, `enforce_contract`, `ai_infer`, `ai_embed`, `ai_stream`,
`stream_next`, операторы `ch <- v`/`<-ch`, `ai_generate!`.

### Молчаливые суррогаты (компилируются, но семантика иная)

- `spawn { }` / `spawn f()` — последовательное исполнение в текущей функции;
- `select` — выражения каналов не вычисляются, исполняется первая ветка;
- `yield` — no-op;
- `await` — passthrough; `async fn` — обычная функция;
- верхнеуровневые `let`/выражения — типизируются, но не эмитятся;
- вложенные `fn`, декорированные `fn`/`class` — не регистрируются;
- `test`-блоки — типизируются, но не эмитятся.

### «Компилируется, но WASM невалиден»

Кодоген выбирает инструкции по синтаксическому типу и не делает приведений.
Типовые случаи:

| Пример | Почему |
|---|---|
| `let x: float = 1.0;` | литерал `1.0` — `i32.const`, слот `f64` |
| `let x: int = 1.5;` | слот `i32`, значение `f64` |
| `1.5 + 1` | смешанные `f64`/`i32` операнды |
| `if (a > 3.0)` при `a: float` | сравнение `f64` с `i32` |
| `5.5 % 2.0` | `%` всегда `i32.rem_s` |
| `[1.5, 2.5]` | элементы пишутся `i32.store` |
| `class P { v: float; ... }` | float-поле/параметр в i32-сигнатуре метода |
| `let x = 1.5; let f = fn() => x;` | float-захват через `i32.store` |
| `fn f() -> float { return 5.0; }` | возврат i32 для f64-сигнатуры |
| `fn f() -> unit { return; }` | сигнатура с результатом, `return` без значения |
| `let x = print("a");` | void-вызов как значение |
| `print(sqrt(16))` | статический тип `sqrt` считается `Int` |
| `match` с void-ветками | `if` ожидает i32-результат |
| void-метод в позиции инструкции | `drop` после void-вызова |

Поэтому документация проверяет **каждый** `latent`-пример через
`web-ide/compiler.wasm` и `WebAssembly.validate()`; отдельно проверяются
ожидаемо-невалидные блоки (маркеры `// Не компилируется движком №2`, `// ошибка`,
`// host-only`).

### Семантические ограничения

- Нет модулей, импортов, пакетов, наследования, generic-классов.
- Нет GC/освобождения памяти, нет проверки границ.
- Нет исключений; `assert` — trap, `assert_eq` — сравнение i32-битов.
- Нет перегрузки функций и операторов; дубликаты не диагностируются.
- Нет `break`/`continue`, `if`-выражений, составных присваиваний.
- Ошибки типа «invalid WASM» компилятором не обнаруживаются.

## Проверка примеров документации

```bash
node docs/scripts/validate-examples.mjs
```

Скрипт читает все `docs/docs/**/*.md(x)`, извлекает блоки ```` ```latent ````,
компилирует их через `web-ide/compiler.wasm` (ABI
`latent_alloc`/`latent_compile`), валидирует WASM и печатает сводку. Для
ожидаемо-невалидных блоков проверяется, что они **не** дают валидный модуль.
