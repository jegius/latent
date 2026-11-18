---
title: "Chapter 7. Enums and match"
sidebar_label: "07. Enums and match"
sidebar_position: 8
description: Sum types, constructors, pattern matching, Result-like values; engine limitations.
---

# Chapter 7. Enums and match

:::caution Engine #2

`enum` and pattern matching are **engine #2** (Rust → WASM). The JS interpreter
(engine #1) does not support `enum` (it reports `Unexpected token '{'`), so such
programs have to be run as a compiled WASM module
(see [hello-world](../getting-started/hello-world.md)) or via the CLI runner. In
the playground they can be **compiled** (Engine #2), but not executed.

:::

## Declaring an enum

```latent
enum Color { Red, Green, Blue }

fn name(c: Color) -> string {
    return match c {
        case Red(): "red",
        case Green(): "green",
        case Blue(): "blue",
        default: "unknown",
    };
}

fn main() -> int {
    print(name(Green));
    print(name(Blue));
    return 0;
}
```

The syntax:

```text
enum Имя { Вариант, Вариант(Тип, ...), Вариант }
```

- the comma between variants is **mandatory**; a trailing one is allowed;
- a variant without fields is a tag (`i32`), not a pointer;
- a variant with fields is a pointer to `[тег][поле0][поле1]...` in linear
  memory;
- tags are assigned in order: `Red = 0`, `Green = 1`, `Blue = 2`.

## Variants with data

```latent
enum Shape { Circle(int), Rect(int, int), Empty }

fn area(s: Shape) -> int {
    return match s {
        // A 0-ary variant is matched by the tag value; it must come before
        // variants with fields (for those the tag is read through the pointer).
        case Empty(): 0,
        case Circle(r): 3 * r * r,
        case Rect(w, h): w * h,
    };
}

fn main() -> int {
    print("circle:", area(Circle(10)));
    print("rect:", area(Rect(3, 4)));
    return area(Circle(10));
}
```

Note the `case Empty():` — **with parentheses**. It is a constructor with zero
arguments. If you write `case Empty:` without parentheses, the parser creates a
binding pattern `Empty` (see below), and such a branch will match everything.

There is a second rule as well: **0-ary variants must come before variants with
fields in a `match`**. For a 0-ary variant the tag value itself is checked, while
for a variant with fields the code generator reads the tag through the pointer; if
a tag value falls into a branch with fields, that branch reads memory at a small
address and may falsely match the tag `0`.

## Match: the rules

`match` is an **expression** that returns a value:

```text
match scrutinee {
    case Паттерн: выражение,
    case Паттерн: выражение,
    default: выражение,
}
```

- branches are separated by **commas**; the last comma is optional;
- the body of a branch is an **expression**, not a block (`{ ... }` is not
  allowed);
- `case` can be omitted: `match n { 1: "one", default: "many" }`;
- `default` and `_` are wildcards; they must come last;
- literal patterns: numbers and strings (bool literals are **not** supported by the
  parser: `case true:` reports `ожидалось 'pattern', найдено Bool(true)`);
- an identifier pattern (`case x:`) **binds** the value to a name and always
  matches — it is "catch everything with a name";
- a constructor pattern (`case Circle(r):`) checks the tag and binds the fields.

An example with binding:

```latent
fn classify(n: int) -> string {
    return match n {
        case 0: "zero",
        case 1: "one",
        default: "many",
    };
}

fn abs_value(n: int) -> int {
    return match n {
        case x: x * 2, // binding: always matches
    };
}

fn main() -> int {
    print(classify(0));
    print(classify(7));
    print(abs_value(-3));
    return 0;
}
```

## Result-like values

The compiler has built-in `Ok`/`Err` constructors (and `Some`/`None`) available
without a declaration:

```latent
fn from_result(r) -> int {
    return match r {
        case Ok(v): v,
        case Err(e): -1,
    };
}

fn main() -> int {
    print("ok:", from_result(Ok(42)));
    print("err:", from_result(Err("bad")));
    return from_result(Ok(7));
}
```

:::caution Option

`Some`/`None` share the tag `0`, so in engine #2 the `Some`/`None` patterns are
semantically unreliable. For portable code use `Ok`/`Err`: they have the tags `0`
and `1` and are distinguished correctly.

:::

## How it works in memory

| Value | Representation |
|---|---|
| `Red` (0-ary variant) | the tag number (for example, `0`) |
| `Circle(10)` | a pointer: `[tag=0][10]`, 8 bytes |
| `Rect(3, 4)` | a pointer: `[tag=1][3][4]`, 12 bytes |
| `Ok(7)` | a pointer: `[tag=0][7]` |
| `Err("bad")` | a pointer: `[tag=1][ptr-to-string]` |

Fields are stored in 4 bytes each, so an enum with `float` fields produces invalid
WASM in engine #2 — use integer fields (or `int(float(x))`).

## Engine #2 limitations

- `enum` is engine #2 only; the JS interpreter knows nothing about it.
- Bool patterns are not supported by the parser.
- The bodies of `match` branches are expressions; `return`/`print` inside a branch
  as a statement are allowed only if the whole branch is an expression that
  returns a value (a `match` with void branches produces invalid WASM).
- Nested constructors in patterns are not checked (binding is top-level only).
- Duplicate variants and duplicate `enum`s are not diagnosed.

Next: [Lambdas and higher-order functions](./08-lambdas-and-higher-order.md).
