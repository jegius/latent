---
title: "Глава 2. Переменные и типы"
sidebar_label: "02. Переменные и типы"
sidebar_position: 3
description: let, вывод типов, аннотации, int/float/bool/string, изменяемость и область видимости.
---

# Глава 2. Переменные и типы

## Объявление переменной

Переменная объявляется через `let`; инициализатор обязателен, точка с запятой —
тоже:

```latent
fn main() -> int {
    let count = 3;              // тип выведен: int
    let ratio: float = 2.5;     // явная аннотация
    let name: string = "Latent";
    let ready: bool = true;
    let values: [int] = [10, 20, 30];

    print(count, ratio, name, ready);
    print("array length:", values.length);
    return count;
}
```

Правила:

- `let имя = выражение;` — тип выводится;
- `let имя: Тип = выражение;` — явная аннотация;
- имя — латинские буквы/цифры/`_`, начинается с буквы или `_`;
- переменные **изменяемы**: `let` не делает значение константой.

## Присваивание

```latent
fn main() -> int {
    let counter = 0;
    counter = counter + 1;
    counter = counter + 1;
    print("counter:", counter);
    return counter;
}
```

Присваивание — выражение (возвращает присвоенное значение), поэтому цепочки
`a = b = 1;` синтаксически возможны, но в документации мы так не пишем.

## Базовые типы

| Тип | Литералы | Примечание |
|---|---|---|
| `int` | `0`, `42`, `-7` | 32-битное целое в WASM |
| `float` | `3.14`, `1.5e-3` | 64-битное (`f64`) |
| `bool` | `true`, `false` | в WASM хранится как i32 `0/1` |
| `string` | `"text"` | `[длина][UTF-8]` в линейной памяти |
| `[T]` | `[1, 2, 3]`, `[]` | массив; элементы в памяти по 4 байта |
| `null` | `null` | представляется как `0` |
| `void`/`unit` | — | отсутствие значения (тип `main` без `->`) |

Тип `channel` (`channel`, `channel<T>()`) и пользовательские типы (классы,
enum) разбираются парсером, но их семантика — в следующих главах.

## Вывод типов работает и для функций

```latent
fn double(x: int) -> int {
    return x * 2;
}

fn main() -> int {
    let result = double(21);
    print("double:", result);
    return 0;
}
```

Аннотации параметров и возвращаемого типа **необязательны**:

```latent
fn triple(x) {
    return x * 3;
}

fn main() -> int {
    return triple(14);
}
```

Но аннотировать всё же полезно: без `-> float` компилятор не знает, что
функция возвращает `float`, и в движке №2 результат будет `i32`. Явные типы —
часть контракта.

:::caution Числа в движке №2

Литерал с нулевой дробной частью (`1`, `2.0`, `7.0`) компилируется как
`i32`. Чтобы получить именно `float`:

```latent
fn main() -> int {
    let pi: float = 3.14;   // дробный литерал — f64
    let half: float = float(1) / float(2);
    print(pi);
    print(half);
    return 0;
}
```

Подробности и полный список ограничений — в
[переменных и типах](../guide/variables-and-types.md#ограничения-движка-2).

:::

## Область видимости

```latent
fn main() -> int {
    let x = 1;
    if (true) {
        let x = 2;      // новая переменная во внутреннем блоке
        print("inner:", x);
    }
    print("outer:", x); // 1
    return x;
}
```

Переменные видны от объявления до конца блока. Внутри блока можно объявить
новую переменную с тем же именем — внешняя не изменится.

## Упражнение

Объявите переменные `width` и `height` типа `int`, вычислите площадь и
периметр прямоугольника, напечатайте их и верните площадь.

```latent
fn main() -> int {
    let width: int = 6;
    let height: int = 7;
    let area = width * height;
    let perimeter = 2 * (width + height);
    print("area:", area);
    print("perimeter:", perimeter);
    return area;
}
```

Дальше: [Операторы и управление](./03-operators-and-control-flow.md).
