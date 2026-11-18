---
title: Enums and Pattern Matching
sidebar_label: Enums and match
sidebar_position: 9
description: Sum types, tags, constructors, match expressions, patterns, and engine #2 pitfalls.
---

# Enums and Pattern Matching

## Declaration

```text
enum Имя { Вариант, Вариант(Тип, ...), ... }
```

- a comma between variants is **mandatory** (`enum E { A B }` is an error), a
  trailing one is allowed;
- the tag is the ordinal number of the variant: `enum Color { Red, Green, Blue }` →
  `Red=0`, `Green=1`, `Blue=2`;
- a variant without fields is a **tag number** (`i32`);
- a variant with fields is a pointer to a block `[tag][field0][field1]...`; the
  fields are 4 bytes each.

```latent
enum Shape { Circle(int), Rect(int, int), Empty }

fn area(s: Shape) -> int {
    return match s {
        // A 0-ary variant must come before variants with fields:
        // for it a value-tag is checked, not a tag behind a pointer.
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

## Construction

```latent
enum Color { Red, Green, Blue }

fn code(c: Color) -> int {
    return match c {
        case Red(): 0,
        case Green(): 1,
        case Blue(): 2,
    };
}

fn main() -> int {
    print("red:", code(Red));
    print("green:", code(Green));
    return code(Blue);
}
```

- `Circle(10)` is a constructor call of the variant;
- `Red` is a tag value (no parentheses);
- `Red()` in an **expression** is a type error: a 0-ary variant is registered as a
  value, not as a function. In a **pattern**, `case Red():` is a valid constructor
  with zero fields.

## `match`

`match` is an expression:

```text
match scrutinee {
    case Паттерн: выражение,
    ...
    default: выражение,
}
```

```latent
fn classify(n: int) -> string {
    return match n {
        case 0: "zero",
        case 1: "one",
        default: "many",
    };
}

fn main() -> int {
    print(classify(0));
    print(classify(5));
    return 0;
}
```

Pattern rules:

| Pattern | Example | Behavior |
|---|---|---|
| number literal | `case 0:` | value comparison |
| string literal | `case "a":` | comparison via `str_eq` |
| wildcard | `case _:` / `default:` | always, usually last |
| identifier | `case x:` | **binds** the value, always matches |
| constructor | `case Circle(r):` | checks the tag, binds the fields |
| 0-ary constructor | `case Empty():` | compares the tag (parentheses required!) |

Syntax restrictions:

- branches are separated by commas; the last comma is optional;
- a branch body is an **expression**, not a block: `case 1: { 5 }` is an error;
- `case` may be omitted: `match n { 1: "one", default: "many" }`;
- bool literals are not supported in patterns: `case true:` is the error
  `ожидалось 'pattern', найдено Bool(true)`;
- a `match` with void branches (`print(...)` in a branch) produces invalid WASM —
  a branch must return a value, or use `match` as a statement with `;`
  and a single branch type;
- a `match` without `;` used as a statement is a parse error.

## `Ok`/`Err` without a declaration

```latent
fn from_result(r) -> int {
    return match r {
        case Ok(v): v,
        case Err(e): -1,
    };
}

fn main() -> int {
    print(from_result(Ok(42)));
    print(from_result(Err("bad")));
    return from_result(Ok(7));
}
```

Built-in variants: `Ok` (tag 0, 1 field), `Err` (tag 1, 1 field),
`Some` (tag 0, 1 field), `None` (tag 0, 0 fields).

:::caution Some/None

`Some` and `None` share a single tag `0`, and a `Some` value is a pointer. Because
of that, `Some`/`None` patterns are semantically unreliable in engine #2. Use
`Ok`/`Err`.

:::

## How match is compiled

A chain of nested `if/else`:

1. the scrutinee is evaluated once and stored in a local;
2. for a literal — a comparison (`i32.eq`/`f64.eq`/`str_eq`);
3. for a constructor — load the tag and compare (or compare the value for a
   0-ary variant);
4. the fields are bound in the THEN branch;
5. wildcard/`default` — unconditional execution.

If no branch matches and there is no `default`, the result is `0`.

## Engine #2 limitations

- `enum` is not supported by the JS interpreter (engine #1): `Unexpected token
  '{'`. It is an engine #2 feature.
- Bool patterns are not supported by the parser.
- Void branches produce invalid WASM.
- Nested constructors in patterns are not checked: only the top-level fields are
  bound.
- Duplicate variants/enums are not diagnosed.
- Enum float fields are invalid (fields are stored as 4 bytes).
- A constructor pattern shadows the variant name as a function while the branch is
  being checked; do not use the variant as a value in later branches of the same
  `match` — that may produce a spurious type error.
- 0-ary variants must appear in a `match` **before** variants with fields: for the
  former a value-tag is checked, whereas for the latter the tag is read behind a
  pointer. Otherwise the value-tag may be misread as a pointer.
- Codegen does not check exhaustiveness: without `default` the result is `0`.

Next: [Lambdas and closures](./lambdas-and-closures.md).
