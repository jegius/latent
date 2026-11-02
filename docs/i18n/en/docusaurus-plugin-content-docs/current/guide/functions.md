---
title: Functions
sidebar_label: Functions
sidebar_position: 6
description: Declaration, parameters, return, hoisting, recursion, async/await, and the main entry point.
---

# Functions

## Declaration

```text
'fn' (IDENT | keyword) '(' Params? ')' ('->' Type)? '{' Block '}'
Params := IDENT (':' Type)? (',' IDENT (':' Type)?)*
```

```latent
fn add(a: int, b: int) -> int {
    return a + b;
}

fn main() -> int {
    print(add(2, 3));
    return add(2, 3);
}
```

- function names may also be "soft" keywords (`fn model() {}`) and even
  `new`/`ai`;
- parameter annotations are optional; without an annotation a parameter is `i32`;
- `-> Type` is optional.

## Result type inference

- if `-> T` is present, the signature takes `T`;
- without an annotation but with a `return expression;` in the body, the result is
  `i32` (which is why the annotation is mandatory for `float`);
- without an annotation and without `return`, the function is void.

If a result is declared but the body does not end with `return`, codegen inserts a
default value (`i32.const 0`/`f64.const 0`), therefore:

```latent
fn first_positive(n: int) -> int {
    if (n > 0) {
        return n;
    }
    // no need to write return 0 here — codegen inserts 0
}

fn main() -> int {
    print(first_positive(5));
    print(first_positive(-5));
    return 0;
}
```

## Hoisting and recursion

The signatures of all functions are registered before the bodies, so the
declaration order does not matter and recursion and mutual recursion work:

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
    if (is_even(10)) {
        print("even");
    }
    return 0;
}
```

## `main` and the exit code

```latent
fn main() -> int {
    print("done");
    return 0;
}
```

- `main` is exported from the WASM module if it is declared;
- `-> int` is the standard form; `-> float` is syntactically valid;
- `fn main() { ... }` (without an annotation) is exported as a void function;
- if there is no `main`, the module is valid, but only `memory` is exported.

## `async` / `await`

```latent
async fn fetch_value() -> int {
    return 42;
}

fn main() -> int {
    let v = await fetch_value();
    print("awaited:", v);
    return v;
}
```

- the type checker requires `await` to be applied to `Promise<T>`, and an `async fn`
  returns `Promise<T>`; `await` on an ordinary function is a type error;
- in engine #1 an `async fn` returns a promise and `await` unwraps it;
- in engine #2 an `async fn` is an ordinary function and `await` transparently
  unwraps the value (there is no Promise at runtime).

## What is missing

- function overloading: a duplicate `fn f` is not diagnosed, and the second
  signature overwrites the first;
- nested `fn` inside blocks: they are parsed but not registered —
  `Unknown function: inner`;
- functions as values directly: `let f = square;` in engine #2 is the error
  `Undefined variable: square`; wrap it in a lambda `fn(x) => square(x)`;
- default arguments, variadic functions, named arguments;
- `return` without a value in a function with `-> T` is a type error; in a function
  with `-> void`/`-> unit` it is invalid WASM.

## Built-in functions

Builtins are handled by name and take precedence over user functions with the same
name (`len`, `print`, and the like cannot be overridden).

| Function | Meaning |
|---|---|
| `print(a, ...)` | printing; in engine #2 each argument goes on its own line |
| `len(x)` | length of an array/string |
| `push(arr, v)` | append to an array; returns the array |
| `str(x)`, `int(x)`, `float(x)`, `sqrt(x)` | conversions |
| `assert(cond)`, `assert_eq(a, b)` | checks |
| `alloc`, `load8`, `store8`, `load32`, `store32`, `memcopy` | linear memory |
| `channel`, `tensor`, `ai_infer`, … | host features (engine #1) |

Full signatures and restrictions are in
[arrays and strings](./arrays-and-strings.md) and
[WASM](./wasm-and-execution.md).

## Engine #2 limitations

- `fn f() -> unit { return; }` and `fn f() -> void { return; }` are invalid WASM;
  do not annotate void functions.
- An unannotated `float` return silently becomes `i32`.
- Nested and decorated functions are not registered.
- `async`/`await` is a surrogate without real Promises.
- Call errors: `Несовпадение арности ...` comes from the type checker, and
  `Unknown function: name` comes from codegen.

Next: [Arrays and strings](./arrays-and-strings.md).
