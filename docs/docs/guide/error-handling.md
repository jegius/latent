---
title: Обработка ошибок
sidebar_label: Обработка ошибок
sidebar_position: 11
description: В Latent нет исключений — коды возврата, Result-подобные значения, assert и диагностика компилятора.
---

# Обработка ошибок

## Исключений нет

В языке **нет** `try`/`catch`/`throw`, `panic`, `exit`. Ошибки обрабатываются
тремя способами:

1. **код возврата** — `main` возвращает `int`, функции возвращают sentinel
   (`-1`, `0`, `null`);
2. **sum-типы** — `Ok`/`Err` (аналог `Result`) и `match`;
3. **assert/trap** — для проверок, которые должны немедленно остановить
   программу.

## Коды возврата

```latent
fn divide(a: int, b: int) -> int {
    if (b == 0) {
        return -1; // соглашение: отрицательное — ошибка
    }
    return a / b;
}

fn main() -> int {
    let r = divide(10, 0);
    if (r < 0) {
        print("cannot divide");
        return 1;
    }
    print("result:", r);
    return 0;
}
```

`main` возвращает код, который host может использовать как `exit code`
(в Node.js — `process.exitCode`). CLI `latentc` компилирует, а не исполняет,
поэтому коды возврата программы к нему не относятся.

## `Ok`/`Err` и `match`

```latent
fn check_divisor(b: int) {
    if (b == 0) {
        return Err("division by zero");
    }
    return Ok(b);
}

fn safe_divide(a: int, b: int) -> int {
    return match check_divisor(b) {
        case Ok(v): a / v,
        case Err(msg): -1,
    };
}

fn main() -> int {
    print("10 / 2 =", safe_divide(10, 2));
    print("1 / 0 =", safe_divide(1, 0));
    return safe_divide(10, 2);
}
```

- `Ok`/`Err` доступны без объявления (встроенные варианты; теги `0` и `1`);
- обработка — через `match`;
- оператора `?` и методов `map`/`unwrap` нет;
- свои ошибки можно описать `enum`:

```latent
enum MyError { NotFound, Invalid(int) }

fn describe(e: MyError) -> string {
    return match e {
        case NotFound(): "not found",
        case Invalid(code): "invalid code",
    };
}

fn main() -> int {
    print(describe(NotFound));
    print(describe(Invalid(7)));
    return 0;
}
```

## `assert` и `assert_eq`

```latent
fn main() -> int {
    let x = 10;
    assert(x > 0);
    assert_eq(x, 10);
    assert_eq(x * 2, 20, "double"); // сообщение игнорируется кодогеном
    return 0;
}
```

| Движок | `assert(false)` | `assert_eq(a, b)` |
|---|---|---|
| №1 (JS) | ошибка исполнения (`assertion failed`) | структурное равенство |
| №2 (Rust → WASM) | trap `unreachable` | числа — i32-значения, строки — по содержимому, массивы — указатели |

`assert_eq("a" + "b", "ab")` в движке №2 теперь проходит: строки сравниваются
по содержимому (`STR_EQ`), а не по указателям.

## Диагностика компилятора

Ошибки компиляции — это не исключения времени исполнения; они возвращаются
строкой и печатаются CLI как `error: ...`.

| Стадия | Пример текста | Есть позиция? |
|---|---|---|
| Лексер | `Неожиданный символ '#' на строке 1:14` | да |
| Парсер | `Ошибка парсинга на строке 1:20: ожидалось ';', найдено RBrace` | да |
| Типы | `Неопределённая переменная 'x' на строке 3:12` | да |
| Типы | `Несовпадение типов на строке 2:8: ожидалось 'bool', найдено 'float'` | да (грубая) |
| Кодоген | `Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)` | **нет** |
| Кодоген | `Unknown function: foo`, `Unknown field: P.z` | **нет** |

Особенности:

- несколько ошибок типов объединяются через `; `;
- `expected`/`found` в тексте о несовпадении типов инвертированы;
- ошибки кодогена — английские/русские свободные строки без номера строки;
- **невалидный WASM не является ошибкой компиляции**: некоторые программы
  «компилируются» в невалидный модуль (см. [WASM](./wasm-and-execution.md)).
  Именно поэтому документация проверяет каждый пример через
  `WebAssembly.validate()`.

## Runtime-ошибки (traps)

В движке №2 следующие ситуации — trap WASM, а не «мягкая» ошибка:

- деление на ноль (`i32.div_s`), переполнение `i32::MIN / -1`;
- ложный `assert`;
- недостижимый `unreachable`;
- некорректный `call_indirect` (несовпадение сигнатуры);
- выход за границы памяти (нет проверок) — порча памяти или trap.

В движке №1 это JS-исключения интерпретатора.

## Ограничения движка №2

- Нет исключений — только traps.
- `assert` — trap, а не отчёт; `assert_eq` сравнивает числа по i32, строки —
  по содержимому, массивы — по указателям.
- `snapshot`, `ai_contract`, `enforce_contract` — ошибка host-рантайма.
- Нет `MissingReturn`-диагностики: если функция с `-> int` не возвращает
  значение ни в одной ветке, кодоген подставит `0`.

Дальше: [Конкурентность](./concurrency.md).
