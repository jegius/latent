---
title: "Chapter 9. Tests and contracts"
sidebar_label: "09. Tests and contracts"
sidebar_position: 10
description: test blocks, assert/assert_eq, snapshot, the @forall/@ai_contract decorators, and how they actually behave.
---

# Chapter 9. Tests and contracts

## `test` blocks

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

test "arithmetic" {
    assert(2 + 2 == 4);
    assert_eq(2 * 3, 6);
}

fn main() -> int {
    assert(factorial(5) == 120);
    print("factorial(5):", factorial(5));
    return 0;
}
```

The syntax:

```text
test "имя" { ... }
test("имя") { ... }
```

- the name is mandatory and must be a string (`test 42 { }` is a parse error);
- the blocks are declared at the top level;
- `assert(cond)` and `assert_eq(a, b)` are built-in functions; the optional third
  message is ignored by the code generator;
- in engine #1 `assert` throws an execution error, and `assert_eq` performs a
  structural comparison;
- in engine #2 `assert` compiles to `unreachable` (a trap), and `assert_eq`
  compares **i32 values** (strings and arrays are compared by pointer).

## When tests run

| Engine | Top-level `test` blocks |
|---|---|
| #1 (JS) | Run after `main`. The results are stored in `interpreter.testResults`, but the current web IDE UI **does not show** them; a failed test is invisible in the console. |
| #2 (Rust → WASM) | The body is type-checked but **not emitted**: there is no test runner in the WASM module. |

The practical takeaway: right now the reliable check is an `assert` inside `main`
or inside a function called from `main`: both engine #1 and engine #2 will raise an
execution error/trap on a false condition.

## `snapshot` and contracts (host-only)

```latent
// Does not compile with engine #2: snapshots and contracts require the host runtime.
fn main() -> int {
    snapshot("demo");
    let c = ai_contract("ordering");
    enforce_contract(c);
    return 0;
}
```

These constructs are declared in the grammar (`snapshot`, `ai_contract`,
`enforce_contract` are keywords), but their semantics live in engine #1 and the AI
gateway. In engine #2 they report
`Builtin 'snapshot' не поддерживается движком №2 (требует host-рантайма)`.

## Decorators

```latent
@forall("array")
fn non_empty_length(arr) {
    assert(arr.length >= 0);
}

fn main() -> int {
    return 0;
}
```

A decorator `@имя(аргументы)` is applied to a declaration. It is important to
understand the actual behavior:

- the type checker is transparent: only the target of the decorator is checked;
- **at the top level** the code generator sees a `Decorator`, not an `Fn`, so the
  decorated function **is not registered**: a call to `non_empty_length(...)` from
  `main` results in `Unknown function: non_empty_length`;
- inside a function a decorator is compiled as a wrapper around the target;
- the known names `@test`, `@forall`, `@snapshot`, `@ai_contract`,
  `@enforce_contract` have no separate semantics in the Rust compiler — they are
  syntactic markers.

That is why the example above compiles (the decorator does not interfere), but the
decorated function cannot be used as an ordinary one — declare it without the
decorator.

## Engine #2 limitations

- `test` blocks are not executed and do not affect the WASM module (apart from type
  checking).
- `assert` is a trap on a false condition; `assert_eq` is a bitwise comparison.
- `snapshot`, `ai_contract`, `enforce_contract` report a host runtime error.
- Decorators on top-level `fn`/`class` make the target unavailable for calls.
- The third arguments of `assert`/`assert_eq` are ignored.

Next: [Capstone](./10-capstone.md).
