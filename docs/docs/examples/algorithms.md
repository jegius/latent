---
title: "Алгоритмы: рекурсия и сортировка"
description: "Разбор примеров recursion.lat и sorting.lat: рекурсия, взаимная рекурсия, пузырьковая сортировка, бинарный поиск; вывод в web IDE."
sidebar_position: 3
---

# Алгоритмы

## `recursion.lat` — рекурсия и взаимная рекурсия

`web-ide/examples/recursion.lat`:

```latent
// Recursive functions: factorial, fibonacci, ackermann

fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

fn fib(n: int) -> int {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

fn ackermann(m: int, n: int) -> int {
    if (m == 0) {
        return n + 1;
    }
    if (n == 0) {
        return ackermann(m - 1, 1);
    }
    return ackermann(m - 1, ackermann(m, n - 1));
}

fn main() -> int {
    print("factorial(10) =", factorial(10));
    print("fib(20) =", fib(20));
    print("ackermann(2, 3) =", ackermann(2, 3));

    // Mutual recursion: is_even / is_odd
    print("is_even(10) =", is_even(10));
    print("is_odd(7) =", is_odd(7));

    return 0;
}

fn is_even(n: int) -> bool {
    if (n == 0) {
        return true;
    }
    return is_odd(n - 1);
}

fn is_odd(n: int) -> bool {
    if (n == 0) {
        return false;
    }
    return is_even(n - 1);
}
```

Вывод в web IDE (движок №1):

```text
factorial(10) = 3628800
fib(20) = 6765
ackermann(2, 3) = 9
is_even(10) = true
is_odd(7) = true
```

Разбор:

- функции **хойстятся**: `main` вызывает `is_even`/`is_odd`, объявленные после
  него, — это нормально и для движка №2;
- взаимная рекурсия работает (сигнатуры обеих функций зарегистрированы до
  разбора тел);
- `bool`-возврат: в движке №1 печатается `true`/`false`, в №2 — `1`/`0`;
- рекурсия без аннотации возврата тоже допустима, но функция тогда получает
  результат `i32` (см. [типы](../reference/types.md)).

Движок №2: пример компилируется в валидный WASM; арифметика/сравнения — как
описано в [операторах](../reference/operators.md).

## `sorting.lat` — сортировка и бинарный поиск

`web-ide/examples/sorting.lat`:

```latent
// Classic algorithms: bubble sort + binary search

fn bubble_sort(arr: [int]) -> [int] {
    let n = arr.length;
    for (let i = 0; i < n; i = i + 1) {
        for (let j = 0; j < n - i - 1; j = j + 1) {
            if (arr[j] > arr[j + 1]) {
                let tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
            }
        }
    }
    return arr;
}

fn binary_search(arr: [int], target: int) -> int {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
        let mid = (lo + hi) / 2;
        if (arr[mid] == target) {
            return mid;
        }
        if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}

fn main() -> int {
    let data = [64, 34, 25, 12, 22, 11, 90];
    print("original:", data);

    let sorted = bubble_sort(data);
    print("sorted:  ", sorted);

    let idx = binary_search(sorted, 22);
    print("binary_search(22) -> index", idx);

    let missing = binary_search(sorted, 100);
    print("binary_search(100) -> index", missing);

    return 0;
}
```

Вывод (движок №1):

```text
original: [64, 34, 25, 12, 22, 11, 90]
sorted:   [11, 12, 22, 25, 34, 64, 90]
binary_search(22) -> index 2
binary_search(100) -> index -1
```

Разбор:

- массив передаётся по ссылке и мутируется на месте: `bubble_sort(data)`
  сортирует `data`, возвращая тот же указатель;
- `arr[j] = arr[j + 1]` — присваивание в индекс (в №2 — `i32.store`);
- `(lo + hi) / 2` — важная деталь: в движке №1 деление всегда float, но в
  этом примере суммы `lo + hi` чётные, поэтому `mid` получается целым и поиск
  работает. В общем случае при нечётной сумме `arr[1.5]` даст `undefined`-эффект
  и поиск сломается. В движке №2 деление — целочисленное (`i32.div_s`), и такой
  проблемы нет; для переносимого кода полагайтесь на №2-семантику или
  используйте `int(...)`-приведение в №1;
- `-1` как «не найдено» — соглашение примера.

Движок №2: пример компилируется; массив печатается как указатель (см.
[движки](../specs/engines.md)). Если нужен читаемый вывод в №2 — печатайте
элементы в цикле.

## Замечания для переноса на движок №2

- Деление `(lo + hi) / 2` в №2 — целочисленное; убедитесь, что это желаемое
  поведение.
- Сравнение массивов `==` в №2 — по указателям; для поиска используйте
  поэлементно.
- `print(arr)` в №2 печатает указатель, а не содержимое.

## Связанные разделы

- [Основы](./basics.md) — массивы, циклы, функции.
- [Функциональный стиль](./functional.md) — map/filter/reduce.
- [Операторы](../reference/operators.md) — деление и сравнения.
