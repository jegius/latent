---
title: "Chapter 4. Functions and recursion"
sidebar_label: "04. Functions and recursion"
sidebar_position: 5
description: Declaring functions, parameters, return, recursion, mutual recursion, and scope.
---

# Chapter 4. Functions and recursion

## Declaring a function

```latent
fn add(a: int, b: int) -> int {
    return a + b;
}

fn main() -> int {
    print("add(2, 3) =", add(2, 3));
    return add(2, 3);
}
```

The syntax:

```text
fn имя(параметр: Тип, ...) -> ТипВозврата { тело }
```

- parameters are comma-separated; type annotations are optional;
- `-> Тип` is optional: without an annotation the result type is inferred as `i32`
  (if the body contains `return выражение`) or `void`;
- functions can be called before they are declared — the compiler first registers
  the signatures of all functions.

## Functions without annotations

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

Without annotations, parameters get the static type `i32`; annotations are
required for `float`/`string` (see chapter 2). A named function **cannot** be
passed as a value — wrap it in a lambda (`fn(v) => square(v)`).

## Recursion

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

Recursion is an ordinary function call; there is no tail-call optimization, so the
depth is limited by the size of the WASM stack.

## Mutual recursion

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

The functions see each other regardless of declaration order — a consequence of
signature "hoisting".

## Multiple return values? No

A function returns one value. For "multiple" results, use arrays, classes, or
enums. For example, gcd and lcm:

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

## Early exit

`return` works not only at the end of a function:

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

## Exercise

Write a recursive function `power(base, exp)` that computes `base^exp` in
`O(log exp)` (by squaring): `power(x, n) = power(x*x, n/2)` for an even `n`.

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

Next: [Arrays and strings](./05-arrays-and-strings.md).
