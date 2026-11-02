---
title: "Глава 8. Лямбды и функции высшего порядка"
sidebar_label: "08. Лямбды и функции высшего порядка"
sidebar_position: 9
description: Две формы лямбд, замыкания, передача функций, косвенные вызовы.
---

# Глава 8. Лямбды и функции высшего порядка

## Две формы лямбды

```latent
fn main() -> int {
    // выражение-тело
    let double = fn(x) => x * 2;

    // блочное тело
    let add_one = fn(x) {
        let y = x + 1;
        return y;
    };

    print("double:", double(21));
    print("add_one:", add_one(41));
    return double(21);
}
```

- `fn(x) => выражение` — короткая форма;
- `fn(x) { ... }` — блочная форма с `return`;
- параметры и тип возврата можно аннотировать (`fn(x: int) -> int => ...`), но
  аннотация возврата у лямбды игнорируется кодогенератором;
- лямбда — обычное значение: её можно присвоить, передать, вернуть.

## Функции высшего порядка

```latent
fn apply(f, x) {
    return f(x);
}

fn apply_twice(f, x) {
    return f(f(x));
}

fn main() -> int {
    let inc = fn(x) => x + 1;
    print("apply:", apply(inc, 10));
    print("apply_twice:", apply_twice(inc, 10));
    return apply_twice(inc, 10);
}
```

Именованную функцию **нельзя** передать как значение напрямую (в движке №2
это ошибка `Undefined variable: square`) — оберните её в лямбду:

```latent
fn square(x: int) -> int {
    return x * x;
}

fn map_values(values: [int], f) -> [int] {
    let out = [];
    for (let v in values) {
        out.push(f(v));
    }
    return out;
}

fn main() -> int {
    let squared = map_values([1, 2, 3, 4], fn(x) => square(x));
    print("length:", squared.length);
    print("last:", squared[3]);
    return squared.length;
}
```

## Замыкания

Лямбда захватывает свободные переменные из окружающей функции:

```latent
fn main() -> int {
    let base = 100;
    let add_base = fn(x) => x + base;
    print("add_base(5):", add_base(5));

    let scale = 3;
    let apply_scale = fn(x) => x * scale;
    print("apply_scale(7):", apply_scale(7));
    return add_base(5);
}
```

В движке №2 замыкание — это пара `[индекс функции][указатель на окружение]`;
захваченные значения упаковываются в окружение и читаются в прологе функции.
Захватываются только `i32`-значения: захват `float` даёт невалидный WASM.

## Рекурсивная лямбда? Нет

Лямбда не знает своего имени, поэтому прямую рекурсию через лямбду записать
нельзя. Используйте именованную функцию:

```latent
fn fact(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * fact(n - 1);
}

fn main() -> int {
    print("fact(6):", fact(6));
    return fact(6);
}
```

## Ограничения движка №2

- Лямбды поддерживаются, но захват — только `i32`/указатели; `float`-захваты
  дают невалидный WASM.
- Именованную функцию нельзя использовать как значение — только через
  лямбду-обёртку (`fn(x) => square(x)`).
- Аннотация типа возврата лямбды парсится, но кодоген её не использует.
- Косвенный вызов (`call_indirect`) требует совпадения сигнатур; при передаче
  лямбды в нетипизированный параметр она получает `i32`-сигнатуру.
- Арность лямбды проверяется typechecker'ом: `f()` при `fn(x) => ...` — ошибка
  `Несовпадение арности`.

Дальше: [Тесты и контракты](./09-tests-and-contracts.md).
