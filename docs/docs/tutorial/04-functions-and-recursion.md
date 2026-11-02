---
title: "Глава 4. Функции и рекурсия"
sidebar_label: "04. Функции и рекурсия"
sidebar_position: 5
description: Объявление функций, параметры, возврат, рекурсия, взаимная рекурсия и область видимости.
---

# Глава 4. Функции и рекурсия

## Объявление функции

```latent
fn add(a: int, b: int) -> int {
    return a + b;
}

fn main() -> int {
    print("add(2, 3) =", add(2, 3));
    return add(2, 3);
}
```

Синтаксис:

```text
fn имя(параметр: Тип, ...) -> ТипВозврата { тело }
```

- параметры через запятую; аннотации типов необязательны;
- `-> Тип` необязателен: без аннотации тип результата выводится как `i32`
  (если в теле есть `return выражение`) или `void`;
- функции можно вызывать до их объявления — компилятор сначала регистрирует
  сигнатуры всех функций.

## Функции без аннотаций

```latent
fn square(x) {
    return x * x;
}

fn apply_twice(f, x) {
    return f(f(x));
}

fn main() -> int {
    print("square(7) =", square(7));
    print("apply_twice =", apply_twice(fn(v) => v + 1, 3));
    return square(7);
}
```

Без аннотаций параметры получают статический тип `i32`; для `float`/`string`
аннотации необходимы (см. главу 2). Именованную функцию **нельзя** передать
как значение — оборачивайте её в лямбду (`fn(v) => square(v)`).

## Рекурсия

```latent
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

fn main() -> int {
    print("factorial(10) =", factorial(10));
    print("fib(20) =", fib(20));
    return 0;
}
```

Рекурсия — обычный вызов функции; оптимизации хвостовых вызовов нет, поэтому
глубина ограничена размером стека WASM.

## Взаимная рекурсия

```latent
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

fn main() -> int {
    print("is_even(10):", is_even(10));
    print("is_odd(7):", is_odd(7));
    return 0;
}
```

Функции видны друг другу независимо от порядка объявления — это следствие
«хойстинга» сигнатур.

## Несколько возвращаемых значений? Нет

Функция возвращает одно значение. Для «нескольких» результатов используют
массивы, классы или enum. Например, gcd и lcm:

```latent
fn gcd(a: int, b: int) -> int {
    if (b == 0) {
        return a;
    }
    return gcd(b, a % b);
}

fn lcm(a: int, b: int) -> int {
    return (a / gcd(a, b)) * b;
}

fn main() -> int {
    print("gcd(48, 36) =", gcd(48, 36));
    print("lcm(6, 8) =", lcm(6, 8));
    return 0;
}
```

## Ранний выход

`return` работает не только в конце функции:

```latent
fn sign(n: int) -> int {
    if (n > 0) {
        return 1;
    }
    if (n < 0) {
        return -1;
    }
    return 0;
}

fn main() -> int {
    print(sign(7), sign(-3), sign(0));
    return 0;
}
```

## Упражнение

Напишите рекурсивную функцию `power(base, exp)`, вычисляющую `base^exp` за
`O(log exp)` (возведение в квадрат): `power(x, n) = power(x*x, n/2)` для
чётного `n`.

```latent
fn power(x: int, n: int) -> int {
    if (n == 0) {
        return 1;
    }
    if (n % 2 == 0) {
        return power(x * x, n / 2);
    }
    return x * power(x, n - 1);
}

fn main() -> int {
    print("2^10 =", power(2, 10));
    print("3^5 =", power(3, 5));
    return 0;
}
```

Дальше: [Массивы и строки](./05-arrays-and-strings.md).
