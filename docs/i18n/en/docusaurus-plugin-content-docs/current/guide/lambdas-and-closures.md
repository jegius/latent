---
title: Lambdas and Closures
sidebar_label: Lambdas and Closures
sidebar_position: 10
description: The two lambda forms, variable capture, higher-order functions, and indirect calls.
---

# Lambdas and Closures

## Two forms

```text
fn (параметры) => выражение        // short
fn (параметры) { инструкции }      // block
```

```latent
fn main() -> int {
    let double = fn(x) => x * 2;
    let scale = fn(x) {
        let y = x + 1;
        return y * 10;
    };
    print(double(21));
    print(scale(4));
    return double(21);
}
```

- parameters may have annotations; without an annotation they are `i32`;
- a lambda's return type annotation is parsed but **ignored** by the code
  generator;
- a lambda is a value: it can be assigned, passed to a call, and returned.

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
    print(apply(inc, 10));
    print(apply_twice(inc, 10));
    return apply_twice(inc, 10);
}
```

A named function cannot be passed as a value — wrap it in a lambda:

```latent
fn square(x: int) -> int {
    return x * x;
}

fn apply(f, x) {
    return f(x);
}

fn main() -> int {
    return apply(fn(v) => square(v), 7);
}
```

`let f = square;` in engine #2 is the error `Undefined variable: square`.

## Closures

A lambda captures the free variables of the enclosing function:

```latent
fn main() -> int {
    let base = 100;
    let add_base = fn(x) => x + base;

    let factor = 3;
    let triple = fn(x) {
        return x * factor;
    };

    print(add_base(5));
    print(triple(7));
    return add_base(5);
}
```

How this is implemented in engine #2:

- a lambda compiles to a separate function with an implicit first parameter — a
  pointer to the environment;
- a lambda value is 8 bytes: `[function index in the table][env pointer]`;
- a call is `call_indirect` by the index from the element table;
- only `i32`/pointers are captured; capturing a `float` produces invalid WASM.

## Recursion through a lambda is impossible

A lambda does not know its own name. For recursion, use a named function
(see [functions](./functions.md)).

## Engine #2 limitations

- Captures are `i32` only; a float capture is invalid.
- A lambda's return annotation is ignored.
- Named functions are not first-class values.
- Lambda arity is checked: a call with a different number of arguments is
  `Несовпадение арности`.
- If a lambda is passed into an untyped parameter, its signature in
  `call_indirect` is `i32`-based; for functions with a `float`/`f64` signature the
  indirect call may not match by type.

## Engine #1 differences

The JS interpreter supports lambdas and closures without float restrictions and
without `call_indirect` details — there they are ordinary JS functions.

Next: [Error handling](./error-handling.md).
