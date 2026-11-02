---
title: "Функциональный стиль: map/filter/reduce и лямбды"
description: "Разбор fp_patterns.lat и lambdas.lat: map/filter/reduce, композиция, лямбды обеих форм, замыкания, функции высшего порядка, for-in."
sidebar_position: 6
---

# Функциональный стиль

## `fp_patterns.lat` — map / filter / reduce

`web-ide/examples/fp_patterns.lat`:

```latent
// Functional patterns: map, filter, reduce over arrays

fn map_double(arr: [int]) -> [int] {
    let result = [];
    for (let i = 0; i < arr.length; i = i + 1) {
        result.push(arr[i] * 2);
    }
    return result;
}

fn filter_even(arr: [int]) -> [int] {
    let result = [];
    for (let i = 0; i < arr.length; i = i + 1) {
        if (arr[i] % 2 == 0) {
            result.push(arr[i]);
        }
    }
    return result;
}

fn reduce_sum(arr: [int]) -> int {
    let acc = 0;
    for (let i = 0; i < arr.length; i = i + 1) {
        acc = acc + arr[i];
    }
    return acc;
}

fn main() -> int {
    let numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    print("numbers:", numbers);

    let doubled = map_double(numbers);
    print("doubled: ", doubled);

    let evens = filter_even(numbers);
    print("evens:   ", evens);

    let total = reduce_sum(numbers);
    print("sum:     ", total);

    // Composition: sum of doubled evens
    let pipeline = reduce_sum(map_double(filter_even(numbers)));
    print("sum of doubled evens:", pipeline);

    return pipeline;
}
```

Вывод (движок №1):

```text
numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
doubled:  [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
evens:    [2, 4, 6, 8, 10]
sum:      55
sum of doubled evens: 60
```

Разбор: это «ручные» map/filter/reduce на циклах и `push` — без замыканий.
Композиция `reduce_sum(map_double(filter_even(numbers)))` — обычный вызов
вложенных функций.

Движок №2: компилируется; `print(arr)` печатает указатель (см.
[движки](../specs/engines.md)).

## `lambdas.lat` — лямбды, замыкания, высший порядок

`web-ide/examples/lambdas.lat`:

```latent
// First-class functions & lambdas: closures, higher-order functions, for-in.

fn apply_twice(f, x) {
    return f(f(x));
}

fn map_arr(arr, f) {
    let r = [];
    for (let item in arr) {
        r.push(f(item));
    }
    return r;
}

fn main() -> int {
    // lambda with expression body
    let double = fn(x) => x * 2;
    print("double(21) =", double(21));

    // lambda with block body
    let scale = fn(x) {
        let y = x + 1;
        return y * 10;
    };
    print("scale(4) =", scale(4));

    // higher-order: pass lambda to function
    let squared = map_arr([1, 2, 3, 4], fn(x) => x * x);
    print("squared =", squared);

    // nested application
    print("apply_twice(double, 5) =", apply_twice(double, 5));

    return squared[3];
}
```

Вывод (движок №1):

```text
double(21) = 42
scale(4) = 50
squared = [1, 4, 9, 16]
apply_twice(double, 5) = 20
```

`main` возвращает `16` (`squared[3]`).

Разбор:

- две формы лямбды: `fn(x) => expr` и `fn(x) { ... }`;
- лямбды — значения: передаются в функции (`map_arr`, `apply_twice`);
- `for (let item in arr)` — обход массива;
- замыкания: лямбда может использовать внешние переменные.

Движок №2: пример компилируется в валидный WASM (лямбды → функции +
`call_indirect`, env с захватами), но **исполнение в №2 не поддерживается
в IDE**; кроме того, `print` массивов печатает указатель, а `main` в №2 может
вернуть неожиданное значение — лямбды в №2 имеют результат только `i32`,
float-результаты/захваты ломаются. Для переносимого кода используйте лямбды с
целочисленными параметрами/результатами и без захвата float.

## Что важно помнить

- Функции высшего порядка в Latent — через значения-функции (указатель на
  замыкание); в движке №2 это `[table_slot][env_ptr]` и `call_indirect`.
- `print` лямбды/массива в №2 даёт указатель — не используйте как «вывод
  данных».
- Аннотация возврата лямбды (`fn(x) -> int { ... }`) синтаксически допустима,
  но в №2 результат всегда `i32` (см.
  [внутреннее устройство кодогена](../specs/internals-codegen.md#лямбды-и-замыкания)).

## Связанные разделы

- [Основы](./basics.md) · [Алгоритмы](./algorithms.md)
- [Типы → лямбды](../reference/types.md) ·
  [Операторы](../reference/operators.md)
- [Движки](../specs/engines.md)
