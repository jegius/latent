---
title: "Chapter 8. Lambdas and higher-order functions"
sidebar_label: "08. Lambdas and higher-order functions"
sidebar_position: 9
description: The two lambda forms, closures, passing functions, indirect calls.
---

# Chapter 8. Lambdas and higher-order functions

## The two lambda forms

```latent
fn main() -> int {
    // expression body
    let double = fn(x) => x * 2;

    // block body
    let add_one = fn(x) {
        let y = x + 1;
        return y;
    };

    print("double:", double(21));
    print("add_one:", add_one(41));
    return double(21);
}
```

- `fn(x) => выражение` — the short form;
- `fn(x) { ... }` — the block form with `return`;
- parameters and the return type can be annotated (`fn(x: int) -> int => ...`), but
  the return annotation of a lambda is ignored by the code generator;
- a lambda is an ordinary value: it can be assigned, passed, and returned.

## Higher-order functions

```latent
fn apply(f, x) {
    return f(x);
}

fn apply_twice(f, x) {
    return f(f(x));
}

fn main() -> int {
    let inc = fn(x) => x + 1;
    print("apply:", apply(inc, 10));
    print("apply_twice:", apply_twice(inc, 10));
    return apply_twice(inc, 10);
}
```

A named function **cannot** be passed as a value directly (in engine #2 this is
the error `Undefined variable: square`) — wrap it in a lambda:

```latent
fn square(x: int) -> int {
    return x * x;
}

fn map_values(values: [int], f) -> [int] {
    let out = [];
    for (let v in values) {
        out.push(f(v));
    }
    return out;
}

fn main() -> int {
    let squared = map_values([1, 2, 3, 4], fn(x) => square(x));
    print("length:", squared.length);
    print("last:", squared[3]);
    return squared.length;
}
```

## Closures

A lambda captures free variables from the enclosing function:

```latent
fn main() -> int {
    let base = 100;
    let add_base = fn(x) => x + base;
    print("add_base(5):", add_base(5));

    let scale = 3;
    let apply_scale = fn(x) => x * scale;
    print("apply_scale(7):", apply_scale(7));
    return add_base(5);
}
```

In engine #2 a closure is a pair `[индекс функции][указатель на окружение]`; the
captured values are packed into the environment and read in the function prologue.
Only `i32` values are captured: capturing a `float` produces invalid WASM.

## A recursive lambda? No

A lambda does not know its own name, so direct recursion through a lambda cannot
be written. Use a named function:

```latent
fn fact(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * fact(n - 1);
}

fn main() -> int {
    print("fact(6):", fact(6));
    return fact(6);
}
```

## Engine #2 limitations

- Lambdas are supported, but only `i32` values/pointers can be captured; `float`
  captures produce invalid WASM.
- A named function cannot be used as a value — only through a lambda wrapper
  (`fn(x) => square(x)`).
- The return type annotation of a lambda is parsed, but the code generator does not
  use it.
- An indirect call (`call_indirect`) requires matching signatures; when a lambda is
  passed into an untyped parameter, it gets an `i32` signature.
- Lambda arity is checked by the type checker: `f()` on `fn(x) => ...` is the error
  `Несовпадение арности`.

Next: [Tests and contracts](./09-tests-and-contracts.md).
