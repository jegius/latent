---
title: "Chapter 3. Operators and control flow"
sidebar_label: "03. Operators and control flow"
sidebar_position: 4
description: Arithmetic, comparisons, logic, bitwise operators, if/else, while, and both kinds of for.
---

# Chapter 3. Operators and control flow

## Arithmetic

```latent
fn main() -> int {
    let a = 17;
    let b = 5;
    print("a + b =", a + b);
    print("a - b =", a - b);
    print("a * b =", a * b);
    print("a / b =", a / b);   // integer division: 3
    print("a % b =", a % b);   // remainder: 2
    print("2 + 3 * 4 =", 2 + 3 * 4);     // 14 — multiplication binds tighter
    print("(2 + 3) * 4 =", (2 + 3) * 4); // 20 — parentheses
    return 0;
}
```

Division is an important difference between the engines:

- **engine #2 (Rust → WASM)**: `17 / 5 == 3`, integer division truncates toward
  zero, the remainder is `i32.rem_s` (`7 % 3 == 1`);
- **engine #1 (JS)**: all numbers are `float`, so `17 / 5 == 3.4`.

Write portable code so that this difference does not affect the result, or use
`int(x)` explicitly for the conversion. The full table of divergences is in
[engine differences](../guide/wasm-and-execution.md#engine-differences).

## Comparisons and logic

```latent
fn main() -> int {
    let a = 17;
    let b = 5;
    print("a == b:", a == b);
    print("a != b:", a != b);
    print("a > b:", a > b, " a < b:", a < b);
    print("a >= b:", a >= b, " a <= b:", a <= b);

    let t = true;
    let f = false;
    print("t && f:", t && f);
    print("t || f:", t || f);
    print("!t:", !t);
    return 0;
}
```

`&&` and `||` short-circuit: the right-hand side is not evaluated if the result is
already known. This means `false && (1 / 0 > 0)` will not divide by zero in
engine #1 (in engine #2 the expression is compiled, but `1/0` in WASM is a trap
if execution ever reaches it).

## Bitwise operators

```latent
fn main() -> int {
    print("1 << 4 =", 1 << 4);   // 16
    print("16 >> 2 =", 16 >> 2); // 4
    print("7 & 3 =", 7 & 3);     // 3
    print("1 | 2 =", 1 | 2);     // 3
    print("5 ^ 1 =", 5 ^ 1);     // 4
    return 0;
}
```

`>>` is an arithmetic right shift (`i32.shr_s`), `<<` is a logical left shift.

## Full operator list

From the "tightest" to the "loosest" (as in the Pratt parser):

| Precedence | Operators | Associativity |
|---|---|---|
| 1 (postfix) | `f(x)`, `a[i]`, `obj.field` | left |
| 2 (prefix) | `-x`, `!x`, `await x`, `<-ch` | right |
| 3 | `*`, `/`, `%` | left |
| 4 | `+`, `-` | left |
| 5 | `<<`, `>>` | left |
| 6 | `&` | left |
| 7 | `^`, `\|` | left |
| 8 | `==`, `!=` | left |
| 9 | `<`, `>`, `<=`, `>=` | left |
| 10 | `&&` | left |
| 11 | `\|\|` | left |
| 12 | `ch <- v` | right |
| 13 | `=` | right |

## `if` / `else if` / `else`

The condition must be in parentheses, the body in braces:

```latent
fn classify(n: int) -> string {
    if (n < 0) {
        return "negative";
    } else if (n == 0) {
        return "zero";
    } else {
        return "positive";
    }
}

fn main() -> int {
    print(classify(-5));
    print(classify(0));
    print(classify(7));
    return 0;
}
```

**The condition must be `bool`**. In engine #2, `if (1) { ... }` is a type error
(`Несовпадение типов ... ожидалось 'float', найдено 'bool'`), even though in
dynamic languages `1` is usually truthy. Engine #1 accepts truthiness; for portable
code write `if (flag)` or `if (x != 0)`.

## `while`

```latent
fn main() -> int {
    let n = 27;
    let steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    print("collatz(27) steps:", steps);
    return steps;
}
```

There are no separate `break`/`continue` statements: a loop ends when its
condition says so.

## C-style `for`

```latent
fn main() -> int {
    let sum = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        sum = sum + i;
    }
    print("sum 1..10:", sum);
    return sum;
}
```

Header: `for (инициализация; условие; шаг)`. Any of the three parts may be empty:
`for (;;)` is an infinite loop (leave it with a `return` from the function).

## `for-in` over an array

```latent
fn main() -> int {
    let numbers = [1, 2, 3, 4];
    let total = 0;
    for (let n in numbers) {
        total = total + n;
    }
    print("total:", total);
    return total;
}
```

`for (let x in ...)` works with arrays; iterating over a string is a type error
(engine #2). The index is not available here; use a C-style `for` if you need it.

## Exercise

Write FizzBuzz for the numbers from 1 to 20: if the number is divisible by 15
print `FizzBuzz`, otherwise by 3 print `Fizz`, otherwise by 5 print `Buzz`,
otherwise print the number itself.

```latent
fn main() -> int {
    for (let i = 1; i <= 20; i = i + 1) {
        if (i % 15 == 0) {
            print("FizzBuzz");
        } else if (i % 3 == 0) {
            print("Fizz");
        } else if (i % 5 == 0) {
            print("Buzz");
        } else {
            print(i);
        }
    }
    return 0;
}
```

Next: [Functions and recursion](./04-functions-and-recursion.md).
