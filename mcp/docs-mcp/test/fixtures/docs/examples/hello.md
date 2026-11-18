---
title: Пример вычисления суммы
sidebar_position: 1
description: Учебный пример Latent — сумма квадратов массива.
tags: [примеры, массивы, циклы]
---

# Сумма квадратов

Программа суммирует квадраты чисел массива.

```latent
fn square(x: int) -> int {
    return x * x;
}

fn main() -> int {
    let numbers = [1, 2, 3];
    let total = 0;
    for (let n in numbers) {
        total = total + square(n);
    }
    return total;
}
```

Результат — `14`.
