---
title: Operators and Precedence
sidebar_label: Operators
sidebar_position: 4
description: The complete Latent operator table with precedences, semantics, engine differences, and invalid combinations.
---

# Operators and Precedence

## Complete table

The precedences are the binding numbers of the Pratt parser: the larger the number,
the tighter the operator binds. Unary operators have precedence `95`.

| bp | Operators | Associativity | Codegen (engine #2) |
|---|---|---|---|
| 2 | `=` | right | `local.set`/`i32.store`/`f64.store` |
| 2 | `<-` (infix) | right | **host runtime error** |
| 10 | `\|\|` | left | short-circuit via `if` |
| 20 | `&&` | left | short-circuit |
| 30 | `==`, `!=` | left | `i32.eq`/`f64.eq`; strings — `str_eq` |
| 40 | `<`, `>`, `<=`, `>=` | left | `i32.lt_s`/`f64.lt`; strings — **pointer** comparison |
| 50 | `\|`, `^` | left | `i32.or`/`i32.xor` |
| 60 | `&` | left | `i32.and` |
| 70 | `<<`, `>>` | left | `i32.shl`/`i32.shr_s` |
| 80 | `+`, `-` | left | `i32.add`/`f64.add`; `+` with a string — concatenation |
| 90 | `*`, `/`, `%` | left | `i32.*`, `f64.*`; `%` is always `i32.rem_s` |
| 95 | `-x`, `!x`, `<-ch`, `await x` | prefix | `0-x`/`f64.neg`, `i32.eqz`, error, passthrough |

Postfix operators (a call `f(x)`, indexing `a[i]`, a field `obj.f`) bind the
tightest.

## Arithmetic

```latent
fn main() -> int {
    let a = 17;
    let b = 5;
    print(a + b, a - b, a * b);
    print("div:", a / b);   // engine #2: 3 (truncation)
    print("rem:", a % b);   // 2
    print(2 + 3 * 4);       // 14
    print((2 + 3) * 4);     // 20
    return 0;
}
```

- `/` on integers is `i32.div_s` (truncation toward zero), division by zero is a trap;
- `%` is `i32.rem_s`, for `float` it **does not work** (invalid WASM);
- `i32` overflow is not diagnosed (it wraps around);
- in engine #1 all numbers are float, so `17 / 5 == 3.4`.

## Comparisons

```latent
fn main() -> int {
    let x = 7;
    print(x == 7, x != 7, x < 10, x > 0, x <= 7, x >= 7);
    return 0;
}
```

- `==`/`!=` on strings compare **by content** (`str_eq`);
- `<`/`>`/`<=`/`>=` on strings compare **pointers**, not content — there is no
  builtin for lexicographic comparison;
- `==` on arrays in engine #2 compares pointers (in engine #1 it compares
  structurally);
- comparing `float` and `int` operands produces invalid WASM.

## Logical operators

```latent
fn main() -> int {
    let a = true;
    let b = false;
    if (a && !b) {
        print("and-not");
    }
    if (a || b) {
        print("or");
    }
    print(!0, !1); // !x = (x == 0): 1, 0
    return 0;
}
```

`&&`/`||` short-circuit (the right-hand side is not evaluated when the result is
already known). `!` is logical NOT via `i32.eqz`, which is why `!5 == 0` and `!0 == 1`.

## Bitwise operators and shifts

```latent
fn main() -> int {
    print(1 << 4);   // 16
    print(16 >> 2);  // 4 (arithmetic shift)
    print(7 & 3);    // 3
    print(1 | 2);    // 3
    print(5 ^ 1);    // 4
    return 0;
}
```

Bitwise operators exist **only in engine #2**; the JS interpreter fails on `<<`,
`&` and the like with a lexer error.

## Assignment

```latent
fn main() -> int {
    let x = 10;
    x = x + 5;          // assignment to a name
    let arr = [1, 2, 3];
    arr[0] = 100;       // assignment to an array element
    return x + arr[0];
}
```

- the target of an assignment is a name, `arr[i]`, or `obj.field`;
- an assignment expression returns the assigned value;
- there are **no** compound assignments (`+=`, `-=`, `*=`, `/=`, `%=`) — the lexer
  deliberately splits `/=` into `/` and `=`;
- there is no increment/decrement (`++`/`--`).

## Channels

`ch <- v` (send) and `<-ch` (receive) are operators, but in engine #2 both produce a
host runtime error; see [concurrency](./concurrency.md).

## Engine #2 limitations

Invalid WASM (compilation succeeds, `WebAssembly.validate()` does not):

- `%` with `float` operands;
- comparing `float` with `int` (`1 < 1.5`, `a > 3.0` when `a: float`);
- mixed `int`/`float` arithmetic;
- `x = 2.5` when `x` is declared as `int` (and vice versa).

Also: `true + true == 2` (a bool is an i32) — it type-checks and compiles, but
semantically it is arithmetic over `0/1`.

Next: [Control flow](./control-flow.md).
