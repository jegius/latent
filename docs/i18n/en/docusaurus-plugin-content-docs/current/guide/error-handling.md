---
title: Error Handling
sidebar_label: Error Handling
sidebar_position: 11
description: Latent has no exceptions — return codes, Result-like values, assert, and compiler diagnostics.
---

# Error Handling

## There are no exceptions

The language has **no** `try`/`catch`/`throw`, `panic`, or `exit`. Errors are handled
in three ways:

1. **return codes** — `main` returns an `int`, functions return a sentinel
   (`-1`, `0`, `null`);
2. **sum types** — `Ok`/`Err` (the equivalent of `Result`) and `match`;
3. **assert/trap** — for checks that must stop the program immediately.

## Return codes

```latent
fn divide(a: int, b: int) -> int {
    if (b == 0) {
        return -1; // convention: a negative value means an error
    }
    return a / b;
}

fn main() -> int {
    let r = divide(10, 0);
    if (r < 0) {
        print("cannot divide");
        return 1;
    }
    print("result:", r);
    return 0;
}
```

`main` returns a code that the host can use as the `exit code`
(in Node.js — `process.exitCode`). The `latentc` CLI compiles rather than executes,
so a program's return codes do not apply to it.

## `Ok`/`Err` and `match`

```latent
fn check_divisor(b: int) {
    if (b == 0) {
        return Err("division by zero");
    }
    return Ok(b);
}

fn safe_divide(a: int, b: int) -> int {
    return match check_divisor(b) {
        case Ok(v): a / v,
        case Err(msg): -1,
    };
}

fn main() -> int {
    print("10 / 2 =", safe_divide(10, 2));
    print("1 / 0 =", safe_divide(1, 0));
    return safe_divide(10, 2);
}
```

- `Ok`/`Err` are available without a declaration (built-in variants; tags `0` and
  `1`);
- handling is done with `match`;
- there is no `?` operator and no `map`/`unwrap` methods;
- custom errors can be described with `enum`:

```latent
enum MyError { NotFound, Invalid(int) }

fn describe(e: MyError) -> string {
    return match e {
        case NotFound(): "not found",
        case Invalid(code): "invalid code",
    };
}

fn main() -> int {
    print(describe(NotFound));
    print(describe(Invalid(7)));
    return 0;
}
```

## `assert` and `assert_eq`

```latent
fn main() -> int {
    let x = 10;
    assert(x > 0);
    assert_eq(x, 10);
    assert_eq(x * 2, 20, "double"); // the message is ignored by codegen
    return 0;
}
```

| Engine | `assert(false)` | `assert_eq(a, b)` |
|---|---|---|
| #1 (JS) | runtime error (`assertion failed`) | structural equality |
| #2 (Rust → WASM) | `unreachable` trap | numbers by i32, strings by content, arrays by pointers |

`assert_eq("a" + "b", "ab")` in engine #2 now passes: strings are compared
by content (`STR_EQ`), not by pointers.

## Compiler diagnostics

Compilation errors are not runtime exceptions; they are returned as a
string and printed by the CLI as `error: ...`.

| Stage | Example text | Position included? |
|---|---|---|
| Lexer | `Неожиданный символ '#' на строке 1:14` | yes |
| Parser | `Ошибка парсинга на строке 1:20: ожидалось ';', найдено RBrace` | yes |
| Types | `Неопределённая переменная 'x' на строке 3:12` | yes |
| Types | `Несовпадение типов на строке 2:8: ожидалось 'bool', найдено 'float'` | yes (approximate) |
| Codegen | `Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)` | **no** |
| Codegen | `Unknown function: foo`, `Unknown field: P.z` | **no** |

Details:

- several type errors are joined with `; `;
- the `expected`/`found` parts of a type mismatch message are inverted;
- codegen errors are free-form English/Russian strings without a line number;
- **invalid WASM is not a compilation error**: some programs "compile" into an
  invalid module (see [WASM](./wasm-and-execution.md)). That is exactly why the
  documentation validates every example with `WebAssembly.validate()`.

## Runtime errors (traps)

In engine #2 the following situations are WASM traps rather than "soft" errors:

- division by zero (`i32.div_s`), `i32::MIN / -1` overflow;
- a false `assert`;
- unreachable `unreachable`;
- an invalid `call_indirect` (signature mismatch);
- an out-of-bounds memory access (there are no checks) — memory corruption or a
  trap.

In engine #1 these are interpreter JS exceptions.

## Engine #2 limitations

- No exceptions — traps only.
- `assert` is a trap, not a report; `assert_eq` compares numbers as i32, strings
  by content, and arrays by pointers.
- `snapshot`, `ai_contract`, `enforce_contract` produce a host runtime error.
- There is no `MissingReturn` diagnostic: if a function with `-> int` returns no
  value on any branch, codegen inserts `0`.

Next: [Concurrency](./concurrency.md).
