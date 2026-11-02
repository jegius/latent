---
title: Variables and Types
sidebar_label: Variables and Types
sidebar_position: 3
description: let, type inference, annotations, int/float/bool/string, arrays, functions, null, and representation in memory.
---

# Variables and Types

## `let`

```text
'let' IDENT (':' Type)? '=' Expression ';'
```

The initializer is mandatory; the type is inferred or given by an annotation.
Variables are **mutable** — `let` is not a constant.

```latent
fn main() -> int {
    let count = 3;              // inferred: int
    let ratio: float = 2.5;     // explicit annotation
    let name: string = "Latent";
    let ready: bool = true;
    let values: [int] = [10, 20, 30];

    count = count + 1;          // assignment is allowed
    print(count, ratio, name, ready);
    print(values.length);
    return count;
}
```

## Type annotations

| Form | Meaning |
|---|---|
| `int`, `float`, `bool`, `string` | primitive types |
| `[T]` | array of `T` (for example, `[int]`, `[[int]]`) |
| `fn(A, B) -> R` | function type |
| `Name` | user type: a class or an enum |
| `Name<T, ...>` | generic annotation; the arguments are types or numbers |
| `channel` | channel type |

Parser specifics for annotations:

- generic arguments may be numbers: `Embedding<1536>` → `Named("1536")`;
- `null` **cannot** be used as an annotation (`fn f() -> null` is an error);
- `void`/`unit` are syntactically valid, but `return;` in a function annotated
  `-> void`/`-> unit` yields invalid WASM — just do not write `->`;
- there are no union types (`int | string`): `|` in an annotation is an error;
- `channel<int>` in an annotation is **not** parsed as a generic (there is a
  dedicated `channel` branch); the generic form works in an expression:
  `channel<int>()`.

## Type inference

The system is Hindley–Milner-like: calls are unified, functions are generalized,
annotations are optional.

- a numeric literal is always `float` in the type system;
- `int` and `float` **unify in both directions** (which is why `let x: int = 42`
  type-checks even though the literal is `float`);
- `bool`, `string`, `null`, `unit` unify only with themselves;
- `Named(a) ~ Named(b)` only when the names are equal; there is no structural
  typing of classes/enums;
- an occurs check is performed (`Бесконечный тип`).

The type checker verifies: undefined names, `if`/`while` conditions = `bool`,
`for-in` iterables = array, `let`/parameter/return annotations, and the arity of
ordinary calls. It does **not** verify: operand types of arithmetic and
comparisons, array homogeneity, builtin arity, or class fields.

## Type representation in WASM (engine #2)

| Type | WASM | Memory |
|---|---|---|
| `int` | `i32` | 32-bit signed |
| `float` | `f64` | IEEE-754 double |
| `bool` | `i32` | `0`/`1` |
| `string` | `i32` | pointer to `[len u32][UTF-8]` |
| `[T]` | `i32` | pointer to `[len][4-byte elements]` |
| `fn(...) -> R` | `i32` | `[table index][env pointer]` |
| class/enum | `i32` | pointer to a block in linear memory |
| `null` | `i32` | `0` |

## Numbers: important engine #2 rules

The code generator selects instructions by **syntactic** type rather than by the
result of type checking. The practical consequences:

- a literal with a zero fractional part (`1`, `2.0`, `1e3`) compiles as `i32`;
  a fractional one (`1.5`, `3.14`) compiles as `f64`;
- `let x: float = 1.0;` yields **invalid WASM** (a slot of type `f64`, a value of
  type `i32`);
- `let x: int = 1.5;` is likewise invalid;
- mixed arithmetic `1.5 + 1` is invalid: both operands must be "fractional"
  (`1.5 + 2.5`) or converted with `float(...)`;
- `%` on `float` always compiles to `i32.rem_s` — invalid;
- the array `[1.5, 2.5]` is invalid: elements are written with `i32.store`;
- a function without an annotation that returns a `float` gets an `i32`
  signature — annotate `-> float`.

Safe ways to work with `float`:

```latent
fn main() -> int {
    let pi: float = 3.14;                 // fractional literal
    let half: float = float(1) / float(2); // explicit conversion
    let square: float = 1.5 * 2.5;        // both operands fractional
    print(pi);
    print(half);
    print(square);
    return 0;
}
```

Conversions: `int(x)` (a string is parsed, a float is truncated toward zero),
`float(x)`, `str(x)`, `sqrt(x)` (the result is `float` — use it only in a float
context: `print(sqrt(16))` is invalid).

## Scope and shadowing

```latent
fn main() -> int {
    let x = 1;
    if (true) {
        let x = 2;      // a new variable in the inner block
        print("inner:", x);
    }
    let x = 10;         // a repeated let in the same block is just a new slot
    print("outer:", x);
    return x;
}
```

## Engine #2 limitations

- All the "compiles, but the WASM is invalid" cases: mixing `int`/`float`, float
  arrays, float class fields, float closure captures, `-> int` with
  `return <float>`, `return;` in `-> void`.
- `null` cannot be annotated; `null` is `0`, and `null == 0` is true.
- Type errors report rough positions, and `expected`/`found` are inverted in the
  message text (`let x: string = 42;` → `ожидалось 'float', найдено 'string'`).

## Engine #1 differences

- All numbers are `float`: `7 / 2 == 3.5`.
- `1.0` and `1` are indistinguishable; there are no codegen float restrictions.
- `print(true)` → `true`, `print(null)` → `null`.

Next: [Operators](./operators.md).
