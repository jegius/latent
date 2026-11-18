---
title: "Operators"
description: "All Latent operators: precedence, associativity, allowed types, semantics in engine #2 (with WASM instructions), and the differences in engine #1."
sidebar_position: 5
---

# Operators

Sources: `src/parser/expressions/core.rs` (precedences),
`src/codegen/emit_expr/binary.rs` (`compile_binary`, `compile_string_operand`),
`web-ide/compiler/interpreter-expressions.js` (engine #1).

A general caveat: **the type checker barely checks operands** (see
[types](./types.md#what-the-type-checker-ignores)), so the choice of a WASM
instruction in codegen is determined by the *static* evaluation of the operand type,
not by annotations. This is the cause of many of the "oddities" below.

## Operator table

| Op. | Kind | Prec. | Assoc. | Engine #2: WASM | Semantics |
|---|---|---:|---|---|---|
| `=` | assignment | 2 | right | `local.set` / `i32.store` / `f64.store` | the result is the assigned value |
| `<-` | binary (send) | 2 | right | — (host feature error) | `ch <- v`, engine #1 only |
| `\|\|` | binary | 10 | left | `if` + branching | short-circuit, result `0/1` |
| `&&` | binary | 20 | left | `if` + branching | short-circuit, result `0/1` |
| `==` | binary | 30 | left | `i32.eq` / `f64.eq`; strings — `__latent_str_eq` | equality |
| `!=` | binary | 30 | left | `i32.ne` / `f64.ne`; strings — `str_eq` + `eqz` | inequality |
| `<` | binary | 40 | left | `i32.lt_s` / `f64.lt` | less than |
| `>` | binary | 40 | left | `i32.gt_s` / `f64.gt` | greater than |
| `<=` | binary | 40 | left | `i32.le_s` / `f64.le` | less than or equal |
| `>=` | binary | 40 | left | `i32.ge_s` / `f64.ge` | greater than or equal |
| `\|` | binary | 50 | left | `i32.or` | bitwise OR |
| `^` | binary | 50 | left | `i32.xor` | bitwise XOR |
| `&` | binary | 60 | left | `i32.and` | bitwise AND |
| `<<` | binary | 70 | left | `i32.shl` | shift left |
| `>>` | binary | 70 | left | `i32.shr_s` | arithmetic shift right |
| `+` | binary | 80 | left | `i32.add` / `f64.add` / `__latent_str_concat` | addition or concatenation |
| `-` | binary | 80 | left | `i32.sub` / `f64.sub` | subtraction |
| `*` | binary | 90 | left | `i32.mul` / `f64.mul` | multiplication |
| `/` | binary | 90 | left | `i32.div_s` / `f64.div` | division |
| `%` | binary | 90 | left | `i32.rem_s` (regardless of float) | remainder |
| `-` (unary) | prefix | 95 | right | `i32.const 0; i32.sub` / `f64.neg` | arithmetic negation |
| `!` | prefix | 95 | right | `i32.eqz` | logical NOT |
| `<-` (unary) | prefix | 95 | right | — (host feature error) | `<-ch`, receive from a channel |
| `await` | prefix | 95 | right | transparent (the value as is) | unwrapping a `Promise<T>` |
| `()` | postfix | 100 | left | `call` / `call_indirect` | a call |
| `[]` | postfix | 100 | left | `i32.load` / `i32.store` | indexing |
| `.` | postfix | 100 | left | `i32.load`/`f64.load` at an offset | field/method/`length` |
| `->` | annotation | — | — | — | a function return type (not evaluated) |
| `=>` | lambda | — | — | — | the arrow in `fn(x) => expr` (not evaluated) |

## Arithmetic

- **Numbers in Latent are "numeric"**: the type checker considers `int`/`float`
  compatible in both directions (`unify` in `src/typechecker/types/mod.rs`). During
  code generation operands are converted implicitly only if both are statically
  `Float`; otherwise the `i32` path is used.
- `+` on `int` is `i32` addition; on `float` it is `f64.add`; **if at least one
  operand is statically `string`, it is concatenation**: numbers are converted to
  strings (`__latent_i32_to_str`, `__latent_f64_to_str`), arrays/functions are not.
- `/` is integer division `i32.div_s` for int (`17 / 5 == 3`) and `f64.div` for float.
  Division by zero in WASM is a **trap** (`unreachable` at runtime).
- `%` is always `i32.rem_s`, even when the operands are float; on float expressions
  this produces **invalid WASM** (see the defects below).

```latent
fn main() -> int {
    print(17 / 5);      // 3
    print(17 % 5);      // 2
    print("v" + 1);     // v1 (int -> string)
    return 0;
}
```

Engine #1: `+ - * / %` are ordinary JS arithmetic; `17 / 5` gives `3.4`,
`+` on arrays is array concatenation, `+` with a string is concatenation
(`String(left) + String(right)`).

## Comparisons and equality

- For numbers, engine #2 uses signed `i32` comparisons or `f64` comparisons depending
  on the static type.
- For strings, `==`/`!=` compare the **contents** (`__latent_str_eq`, byte by byte);
  `<`, `>`, `<=`, `>=` on strings compare pointers (`i32.lt_s`), not
  lexicographically.
- For other values (`bool`, arrays, enums, classes) `==` compares the representation:
  `i32.eq`. For arrays that is a comparison of **pointers**.
- The result of a comparison is `i32` 0/1 (printed as `0`/`1`).
- The chain `a < b < c` parses and compiles as `(a < b) < c`, i.e. a comparison of
  `0/1` with `c`; the type checker reports no error.

```latent
fn main() -> int {
    print("ab" == "ab");     // 1 (content comparison)
    print(2 > 1);            // 1
    let a = [1];
    let b = [1];
    print(a == b);           // 0 — pointers are compared, not elements
    return 0;
}
```

Engine #1: `==`/`!=` are deep structural equality (`deepEqual`): arrays and nested
arrays are compared element by element, strings by value, tensors by shape and data.
`<`/`>` for strings is JS lexicographic comparison.

## Logical operators and short-circuiting

`&&` and `||` are evaluated with **short-circuiting** in both engines:

- engine #2: `a && b` → `if a { b != 0 } else { 0 }`; `a || b` →
  `if a { 1 } else { b != 0 }`; the result is always `i32` 0/1;
- engine #1: the result is `true`/`false`, by truthiness
  (`0`, `null`, `false` are falsy; an empty array is truthy).

```latent
fn main() -> int {
    let ok = false && (1 / 0 > 0);   // the right-hand side is not evaluated
    if (ok) { return 1; }
    return 0;
}
```

The right operand is still compiled during compilation, so codegen errors in an
unreachable branch (a host primitive, for example) will surface at compile time.

## Bitwise operations and shifts

They are supported only by engine #2 (in the AST: `BitAnd`, `BitOr`, `BitXor`, `Shl`,
`Shr`). The result is `int`. Engine #1 cannot lex `&`, `|`, `^`, `<<`, `>>` — that is
the error «Unexpected character».

```latent
fn main() -> int {
    let a = 6 & 3;      // 2
    let b = 6 | 3;      // 7
    let c = 6 ^ 3;      // 5
    let d = 1 << 4;     // 16
    let e = 16 >> 2;    // 4
    return a + b + c + d + e;
}
```

Shifts are 32-bit; `>>` is arithmetic (`i32.shr_s`). Shifts bind tighter than
addition: `1 << 2 + 3` = `1 << 5` = 32.

## Assignment

Assignment is an **expression** with right associativity and precedence 2 (below
`||`):

- target: a name (`x = e`), an array element (`a[i] = e`), a field (`o.f = e`);
- the result is the assigned value (codegen leaves it on the stack), so
  `let y = (x = 5);` gives `y == 5`;
- the chain `a = b = 3` is allowed;
- `a[i] = e` **does not check types** and compiles to `i32.store` (4 bytes);
- `o.f = e` uses the class layout; for a `float` field it is `f64.store`.

```latent
fn main() -> int {
    let a = 0;
    let b = 0;
    a = b = 3;
    print(a);        // 3
    return a;
}
```

Engine #1: assignment is a **statement**, not an expression: `let y = (x = 5);` is a
parse error; `a = b = 3` is not supported.

## Increment/decrement and compound assignments

They do not exist: `x++`, `--x`, `x += 1`, `x -= 1` are not lexed as operators
(`+=` is parsed as `+` and `=`). The only form is `x = x + 1`.

## `->`, `=>`, `<-`

- `->` — only in a return type annotation (`fn f() -> int`, `fn(int) -> int`); as an
  expression operator it does not exist.
- `=>` — only in the lambda `fn(x) => expr`.
- `<-` — two different operators:
  - binary: sending to a channel `ch <- v` (precedence 2, right assoc.);
  - unary prefix: receiving from a channel `<-ch`.
  Both work **only in engine #1**; engine #2 reports at compile time:
  `Оператор отправки в канал (ch <- v) требует host-рантайма движка №1` (the channel
  send operator requires the engine #1 host runtime) or
  `Приём из канала (<- ch) требует host-рантайма движка №1` (receiving from a channel
  requires the engine #1 host runtime).

## `await`

A prefix operator with precedence 95. In engine #2 it compiles **transparently**: the
value of the expression stays as is (`ExprKind::Await` → `compile_expr(inner)`); the
type checker does require the operand to have the type `Promise<T>` (for `async fn` the
result is wrapped into `Promise`). Engine #1 unwraps its own promise-like value
(`{__promise: true, value}`).

## Known codegen defects related to operators

Verified on the shipped `web-ide/compiler.wasm` build:

| Code | Result |
|---|---|
| `let x: float = 2;` | compiles, but the WASM is invalid |
| `fn f() -> float { return 2; }` | compiles, the WASM is invalid |
| `1 + 2.5` | invalid WASM (an int literal → `i32`, the float path) |
| `1.5 < 2.0` | invalid WASM (the right `2.0` → `i32.const 2`) |
| `7.5 % 2.0` | invalid WASM (`i32.rem_s` on f64) |
| `print(sqrt(16))`, `int(sqrt(16))` | invalid WASM (`sqrt` is valid in an f64 context, as `int` it is not) |
| `sqrt(2.25)` in `print` | may be invalid (the conversion is chosen by `StaticTy`) |

Rule of thumb: float expressions are valid only if **all** the literals involved have
a **nonzero** fractional part and the result is not compared with an integer literal.
Codegen treats `2.0`, `5.0`, `1e3` as `int` and breaks the f64 context. For details see
[diagnostics and defects](./errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm).

## Related sections

- [Grammar](./grammar.md#precedence-table-pratt) — precedences in the context of the
  grammar.
- [Types](./types.md) — which types are inferred for operators.
- [Builtins](./builtins.md) — string conversions, `assert`, memory.
