---
title: Syntax and Lexis
sidebar_label: Syntax
sidebar_position: 2
description: Literals, identifiers, comments, keywords, semicolons, and program structure.
---

# Syntax and Lexis

## File and program structure

A Latent program may consist of several `.lat` files: file modules v1 provide
`import`/`export`, and linking happens at compile time —
[modules](./modules.md). There are no namespaces and no packages.
The top level holds declarations:

- `fn` / `async fn` — functions;
- `class` — classes;
- `enum` — sum types;
- `let` — global variables (they are type-checked but **not executed** by engine
  #2: no code is emitted for top-level statements);
- `test "name" { ... }` — tests;
- `@decorator` on a declaration;
- `import` / `export` — connecting and exporting names between files.

The entry point is `fn main() -> int`; declaring it exports `main` from the
WASM module. A program without `main` compiles, but there is nothing to run it with.

## Documentation example

```latent
// Comment before declarations.
fn main() -> int {
    let x = 1; // a statement must end with ';'
    /* block comment
       /* supports nesting */ */
    print("x =", x /* comment inside an expression */);
    return x;
}
```

## Literals

| Literal | Example | Details |
|---|---|---|
| number | `42`, `3.14`, `1e10`, `1.5e-3` | the token is always `f64`; a fractional part exists only if a digit follows the `.`; the exponent `e/E` must have digits |
| string | `"text"` | double quotes only; escapes: `\n`, `\t`, `\\`, `\"` |
| boolean | `true`, `false` | keywords |
| null | `null` | keyword; represented as `0` |

There are many restrictions, and they matter for portability:

- there are **no** hexadecimal/binary literals, no `_` separators, no suffixes
  (`1i64`), no `Infinity`/`NaN`;
- `1.` is not a number: the dot is not consumed unless a digit follows it;
- `0x10` is parsed as `0` followed by the identifier `x10` → a parse error;
- any other escape sequence (`\r`, `\0`, `\u{...}`) is the error
  `Неверная escape-последовательность`;
- integers > 2^53 lose precision (the token is `f64`), and in codegen they become
  `i32` and may overflow.

## Identifiers

```text
identifier := [A-Za-z_][A-Za-z0-9_]*
```

ASCII only, case-sensitive. `let имя = 1;` is the error
`Неожиданный символ 'и'`.

## Keywords

**Hard** (cannot be used as names):

```text
let fn if else while for in return class new this async await spawn channel
select case default yield match enum true false null
ai model agent embedding tensor semantic
test assert assert_eq forall snapshot ai_contract enforce_contract
```

**Soft** — the lexer tags them with a dedicated token, but syntactically they are
allowed as names (`let test = 5;`, `fn model() {}`, `obj.agent`):

```text
test assert assert_eq forall snapshot ai_contract enforce_contract
model agent embedding tensor semantic case
```

`print` is **not** a keyword: it is an ordinary identifier that the
code generator treats as a builtin.

```latent
fn model() -> int {
    let test = 5;
    return test;
}

fn main() -> int {
    return model();
}
```

## Comments

```latent
// until the end of the line
/* block; /* nested */ still a comment */
```

An unterminated `/*` is the error `Незавершённый блочный комментарий на строке L:C`.
Block comments are not supported by JS engine #1.

## Semicolons

There is no automatic `;` insertion, and there is no empty `;` statement.

| Construct | `;` |
|---|---|
| `let x = e;` | required |
| `return e;` / `return;` | required |
| `yield;` | required |
| `match ... { ... };` as a statement | required |
| expression statement `e;` | required |
| `spawn { ... }` / `spawn f();` | optional |
| `select { ... }` | optional |
| `if`/`while`/`for`, `fn`/`class`/`enum` | not needed |
| class field `x: int;` | required |

A `;` after a block (`if (...) { } ;`) is an error.

## Parentheses and calls

- `if`/`while`/`for` require parentheses; `match`/`select` do not;
- blocks are always `{ ... }`; a single statement instead of a block is not allowed;
- `new` requires parentheses: `new Point(3, 4)`; `new Point` without a call is
  the identifier `"new Point"` and an error;
- an array literal accepts a trailing comma: `[1, 2, 3,]`;
- a call accepts a trailing comma: `f(a, b,)`.

## Engine #2 limitations

- Top-level `let` statements/expressions are not emitted (but they are type-checked).
- Nested `fn` are parsed but not registered → `Unknown function`.
- The `;` rules are the same for both engines; the JS engine is not more lenient.

Next: [Variables and types](./variables-and-types.md).
