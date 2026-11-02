---
title: Управление потоком
sidebar_label: Управление потоком
sidebar_position: 5
description: if/else, while, for-in, C-стиль for, spawn/select/yield и их реальная семантика.
---

# Управление потоком

## `if` / `else if` / `else`

```latent
fn sign(n: int) -> string {
    if (n > 0) {
        return "positive";
    } else if (n < 0) {
        return "negative";
    } else {
        return "zero";
    }
}

fn main() -> int {
    print(sign(7));
    print(sign(-3));
    print(sign(0));
    return 0;
}
```

- скобки вокруг условия обязательны, тело — блок `{ ... }`;
- **условие обязано быть `bool`** (движок №2): `if (42)` — ошибка
  `Несовпадение типов … ожидалось 'float', найдено 'bool'`;
- `else if` разворачивается во вложенный `if`;
- `if` — **инструкция**, а не выражение: значение из веток не возвращается.

```latent
fn main() -> int {
    let x = 1;
    if (x == 0) {
        print("zero");
    } else if (x == 1) {
        print("one");
    } else {
        print("many");
    }
    return 0;
}
```

## `while`

```latent
fn collatz_steps(start: int) -> int {
    let n = start;
    let steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    return steps;
}

fn main() -> int {
    print("collatz(27):", collatz_steps(27));
    return 0;
}
```

- условие — `bool` (движок №2);
- `break`/`continue` **нет**: выход только по условию или через `return`.

## `for` в стиле C

```text
for (init; cond; step) { ... }
```

```latent
fn main() -> int {
    let sum = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        sum = sum + i;
    }
    print("sum:", sum);
    return sum;
}
```

- `init` — `let`, выражение-присваивание или пусто;
- `cond` и `step` можно опустить (`for (;;)`) — тогда цикл вечный до `return`;
- typechecker **не** проверяет, что `cond` — `bool`: `for (;; 1; )` компилируется
  и может зациклиться.

## `for-in` по массиву

```latent
fn main() -> int {
    let values = [3, 1, 4, 1, 5];
    let max = values[0];
    for (let v in values) {
        if (v > max) {
            max = v;
        }
    }
    print("max:", max);
    return max;
}
```

- `let` в заголовке обязателен: `for (x in arr)` — ошибка;
- аннотация типа элемента парсится и игнорируется;
- iterable обязан быть **массивом**: строка/объект — ошибка типизации
  (`for (let c in "abc")` в движке №2 не работает, хотя работает в движке №1);
- индекс внутри цикла недоступен — используйте C-стиль.

## `spawn`

```latent
fn worker(x: int) {
    print("worker:", x);
}

fn main() -> int {
    spawn worker(7);      // движок №2: обычный вызов, выполняется сразу
    spawn {
        print("inline");
    }
    return 0;
}
```

В движке №1 это горутина (планировщик), в движке №2 — **последовательное
исполнение** в текущей функции (см. [конкурентность](./concurrency.md)).

## `select`

```latent
// Не компилируется движком №2: канал требует host-рантайма.
fn main() -> int {
    let ch = channel();
    select {
        case v <- ch: {
            print("received:", v);
        }
        default: {
            print("nothing ready");
        }
    }
    return 0;
}
```

Движок №1: блокирующий выбор готового канала. Движок №2: выражения каналов
не вычисляются, исполняется тело **первой** ветки (или `default`, если веток
нет). Тело ветки — обязательно блок.

## `yield`

```latent
fn main() -> int {
    yield; // движок №2: no-op; движок №1: уступить планировщику
    return 0;
}
```

## Ограничения движка №2

- Условия `if`/`while` обязаны быть `bool`; `for` C-стиля не проверяется.
- `for-in` — только массивы.
- `break`/`continue` отсутствуют в языке.
- `if` не является выражением.
- `spawn` — последовательный код, `yield` — no-op, `select` — первая ветка;
  `channel` и `<-` — ошибка host-рантайма.

Дальше: [Функции](./functions.md).
