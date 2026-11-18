---
title: "Chapter 2. Variables and types"
sidebar_label: "02. Variables and types"
sidebar_position: 3
description: let, type inference, annotations, int/float/bool/string, mutability, and scope.
---

# Chapter 2. Variables and types

## Declaring a variable

A variable is declared with `let`; the initializer is mandatory, and so is the
semicolon:

```latent
fn main() -> int {
    let count = 3;              // type inferred: int
    let ratio: float = 2.5;     // explicit annotation
    let name: string = "Latent";
    let ready: bool = true;
    let values: [int] = [10, 20, 30];

    print(count, ratio, name, ready);
    print("array length:", values.length);
    return count;
}
```

The rules:

- `let имя = выражение;` — the type is inferred;
- `let имя: Тип = выражение;` — an explicit annotation;
- a name consists of Latin letters/digits/`_` and starts with a letter or `_`;
- variables are **mutable**: `let` does not turn the value into a constant.

## Assignment

```latent
fn main() -> int {
    let counter = 0;
    counter = counter + 1;
    counter = counter + 1;
    print("counter:", counter);
    return counter;
}
```

Assignment is an expression (it returns the assigned value), so chains such as
`a = b = 1;` are syntactically possible, but the documentation never writes them
that way.

## Basic types

| Type | Literals | Note |
|---|---|---|
| `int` | `0`, `42`, `-7` | 32-bit integer in WASM |
| `float` | `3.14`, `1.5e-3` | 64-bit (`f64`) |
| `bool` | `true`, `false` | stored in WASM as i32 `0/1` |
| `string` | `"text"` | `[длина][UTF-8]` in linear memory |
| `[T]` | `[1, 2, 3]`, `[]` | array; elements take 4 bytes each in memory |
| `null` | `null` | represented as `0` |
| `void`/`unit` | — | absence of a value (the type of `main` without `->`) |

The `channel` type (`channel`, `channel<T>()`) and user-defined types (classes,
enums) are parsed, but their semantics belong to the following chapters.

## Type inference works for functions too

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

Parameter and return type annotations are **optional**:

```latent
fn triple(x) {
    return x * 3;
}

fn main() -> int {
    return triple(14);
}
```

Still, annotating is worthwhile: without `-> float` the compiler does not know
that the function returns a `float`, and in engine #2 the result will be `i32`.
Explicit types are part of the contract.

:::caution Numbers in engine #2

A literal with a zero fractional part (`1`, `2.0`, `7.0`) compiles as `i32`. To get
an actual `float`:

```latent
fn main() -> int {
    let pi: float = 3.14;   // fractional literal — f64
    let half: float = float(1) / float(2);
    print(pi);
    print(half);
    return 0;
}
```

For details and the full list of limitations, see
[variables and types](../guide/variables-and-types.md#engine-2-limitations).

:::

## Scope

```latent
fn main() -> int {
    let x = 1;
    if (true) {
        let x = 2;      // a new variable in the inner block
        print("inner:", x);
    }
    print("outer:", x); // 1
    return x;
}
```

Variables are visible from their declaration to the end of the block. Inside a
block you can declare a new variable with the same name — the outer one is not
affected.

## Exercise

Declare `width` and `height` variables of type `int`, compute the area and the
perimeter of a rectangle, print them, and return the area.

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

Next: [Operators and control flow](./03-operators-and-control-flow.md).
