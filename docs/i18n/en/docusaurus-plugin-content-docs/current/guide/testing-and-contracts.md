---
title: Tests and Contracts
sidebar_label: Tests and Contracts
sidebar_position: 14
description: test blocks, assert/assert_eq, snapshot, the @forall/@ai_contract decorators, and the actual behavior in the engines.
---

# Tests and Contracts

## `test` blocks

```text
test "имя" { ... }
test("имя") { ... }
```

```latent
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

test "factorial" {
    assert(factorial(5) == 120);
    assert_eq(factorial(0), 1);
}

test("arithmetic") {
    assert(2 + 2 == 4);
    assert_eq(2 * 3, 6);
}

fn main() -> int {
    assert(factorial(5) == 120);
    print("factorial(5):", factorial(5));
    return 0;
}
```

The rules:

- the name is a string literal (`test 42 { }` is an error);
- the blocks are declared at the top level;
- `assert(cond)` and `assert_eq(a, b[, msg])` are available inside;
- the third argument (the message) is ignored by the engine #2 code generator;
- `test` is not a function: it cannot be called.

## When tests are executed

| Engine | Behavior |
|---|---|
| #1 (JS) | After `main` returns, the interpreter runs all `test` blocks; the results are collected in `interpreter.testResults` (`{name, passed, error}`). The current web IDE UI **does not display** them. |
| #2 (Rust → WASM) | The test body is type-checked but **not emitted** into the module: there is no test runner in WASM. |

Practical advice: for checks that have to fail visibly, use `assert` in `main` or in a
function called from it — then the runtime error (a trap in engine #2, an exception in
engine #1) shows up immediately.

## `assert` and `assert_eq`

```latent
fn main() -> int {
    let values = [1, 2, 3];
    assert(values.length == 3);
    assert_eq(values[0], 1);
    assert_eq(2 * 3, 6, "multiplication");
    return 0;
}
```

- `assert(false)` in engine #2 is an `unreachable` trap;
- `assert_eq` in engine #2 compares **i32 values** (strings and arrays — by pointers,
  floats — by bits);
- in engine #1 `assert_eq` compares structurally;
- `assert_ne`, `panic`, `exit` do not exist.

## `snapshot` and contracts (host-only)

```latent
// Does not compile with engine #2: snapshot/contracts require a host runtime.
fn main() -> int {
    snapshot("demo");
    let c = ai_contract("ordering");
    enforce_contract(c);
    return 0;
}
```

| Construct | Type | Engine #1 | Engine #2 |
|---|---|---|---|
| `snapshot(name)` | `bool` | records a value | host runtime error |
| `ai_contract(name)` | `Contract<String>` | a contract object | host runtime error |
| `enforce_contract(c)` | `bool` | a check | host runtime error |

## Decorators

```text
@имя(аргументы)? объявление
```

```latent
@forall("array")
fn non_empty_length(arr) {
    assert(arr.length >= 0);
}

fn main() -> int {
    return 0;
}
```

Known names: `@test`, `@forall`, `@snapshot`, `@ai_contract`, `@enforce_contract` —
they are keywords/soft words, but **there is no dedicated semantics in the Rust
compiler**: a decorator is transparent to the type checker.

An important consequence for engine #2: at the top level the compiler scanner sees a
`Decorator` rather than an `Fn`, therefore **a decorated function is not registered**:

```latent
// Does not compile with engine #2: a decorated function is not registered.
@forall("x")
fn decorated() -> int {
    return 1;
}

fn main() -> int {
    return decorated();
}
```

The call produces `Unknown function: decorated`. Declare functions without a decorator
if you need to call them.

## Engine #2 limitations

- There is no test runner: `test` blocks are not executed.
- `assert` is a trap; `assert_eq` is a bitwise comparison of i32.
- `snapshot`/`ai_contract`/`enforce_contract` produce a host runtime error.
- Decorators on top-level `fn`/`class` make the target unavailable.
- Nested `fn` (including inside `test`) are not registered.

## Engine #1 differences

- `test` blocks really are executed after `main`, but the results are visible only
  through the interpreter API, not in the UI.
- `assert_eq` compares structurally (arrays, objects).
- `@forall`/`@ai_contract` do not break calls — decorators are ignored in the JS
  engine.

Next: [Memory and low level](./memory-and-low-level.md).
