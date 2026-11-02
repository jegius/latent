---
title: Встроенные функции
sidebar_position: 1
description: Встроенные функции Latent len, push, pop и методы массивов и строк.
tags: [builtins, len, push, массивы]
---

# Встроенные функции

| Функция | Сигнатура | Описание |
|---|---|---|
| `len` | `len(arr\|str) -> int` | Длина массива или строки |
| `push` | `push(arr, value)` | Добавить элемент в массив |
| `pop` | `pop(arr)` | Удалить последний элемент |
| `print` | `print(...)` | Вывести значения в stdout |

```latent
fn main() -> int {
    let values: [int] = [1, 2, 3];
    push(values, 4);
    print("длина:", len(values));
    return len(values);
}
```

Метод `.length` работает для строк и массивов и эквивалентен `len`.
