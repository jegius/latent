---
title: "Lexical structure: literals, identifiers, comments"
description: "Latent lexical rules according to src/lexer: numbers, strings and escaping, identifiers, all kinds of comments, soft keywords, semicolon, whitespace."
sidebar_position: 2
---

# Lexical structure

Source of truth: `src/lexer/` (engine #2) and `web-ide/compiler/lexer.js` (engine #1).
The lexer turns a UTF-8 source into a stream of tokens with an `L:C` position
(`src/lexer/position.rs`, numbered from 1, `column` counted in characters, `offset` in
bytes).

## Whitespace and newlines

The characters `' '`, `'\t'`, `'\n'`, `'\r'` are skipped (`skip_whitespace` in
`src/lexer/scanner.rs`). Whitespace is not significant except for separating tokens;
indentation only affects formatting.

## Comments

| Kind | Syntax | Engine #2 | Engine #1 |
|---|---|---|---|
| line | `// to the end of the line` | ✅ | ✅ |
| block | `/* ... */`, **with nesting** | ✅ | ❌ not supported |
| block unterminated | `/* ...` up to EOF | error «Незавершённый блочный комментарий» (unterminated block comment) | — |

In engine #2 comment tokens are produced by the lexer (`TokenType::Comment`) but are
**removed before parsing** (`src/parser/mod.rs`): comments may appear anywhere between
tokens, including the start of the file.

```latent
// Line comment
fn main() -> int {
    /* Block comment.
       /* A nested comment is allowed. */
       Continuation. */
    return 1;
}
```

In engine #1 the lexer understands only `//`; it parses the characters `/*` as the
division operator and `*`, which results in a parse error.

## Numeric literals

There is a single kind — decimal numbers; everything is stored as `f64`
(`TokenType::Number(f64)`), and the code generator picks `i32.const` or `f64.const`
depending on whether there is a fractional part (`src/codegen/emit_expr/`).

```
Number   ::= Digit+ ('.' Digit+)? ([eE] ('+'|'-')? Digit+)?
Digit    ::= [0-9]
```

- `42`, `3.14`, `1e10`, `1.5e-3` are valid.
- `1.` (a dot with no digits after it) is the number `1` followed by a separate `.`
  token (a dot).
- `1e`, `1e+` — error «Неверный формат числа '...'» (invalid number format).
- There are **no** hexadecimal (`0x`), binary (`0b`), or octal literals, and no `_`
  separators.
- `2.0` is lexically a floating-point number, but the code generator still emits it as
  `i32.const 2` when the fractional part is zero. This is the source of known float
  issues (see [types](./types.md#codegen-pitfalls-related-to-types)).

Engine #1 does not support the exponent: `1e3` is parsed as the number `1` and the
identifier `e3`.

## String literals

Double quotes only, one line (a newline inside a literal is forbidden). There are
**exactly four** allowed escape sequences:

| escape | result |
|---|---|
| `\n` | newline |
| `\t` | tab |
| `\\` | backslash |
| `\"` | double quote |

Any other `\X` is the error «Неверная escape-последовательность '\X'» (invalid escape
sequence). A string without a closing quote up to a newline or EOF is
«Незавершённая строка» (unterminated string).

```latent
fn main() -> int {
    print("tab:\tquote:\"slash:\\");
    return 0;
}
```

A string is stored in memory as `[len u32 LE][utf8 bytes]`, and the pointer points at
the length (see [WASM ABI](./wasm-abi.md#string)). Indexing `s[i]` yields a UTF-8
**byte**, not a character; `len(s)` is the length in bytes.

## Identifiers

```
Identifier ::= (Letter | '_') (Letter | Digit | '_')*
Letter     ::= [A-Za-z]      // ASCII only
```

Validity is also checked by the `latent::is_valid_identifier` function (`src/lib.rs`):
the first letter is an ASCII letter or `_`, the rest are ASCII letters/digits/`_`.
Cyrillic names are **not** identifiers.

## Keywords and "soft" keywords

The full list of keywords (`src/lexer/keywords.rs`): `let fn if else while
for in return class new this async await spawn channel select case default yield
match enum true false null ai model agent embedding tensor semantic test assert
assert_eq forall snapshot ai_contract enforce_contract`.

Some words are **soft**: the lexer marks them with a separate token type, but in name
position they are accepted as identifiers (`soft_keyword_lexeme()` in
`src/lexer/token.rs`, `expect_identifier` in `src/parser/cursor.rs`):

`test`, `assert`, `assert_eq`, `forall`, `snapshot`, `ai_contract`,
`enforce_contract`, `model`, `agent`, `embedding`, `tensor`, `semantic`,
`case`.

This means that, for example, `let test = 5;`, `fn model() {}`, `obj.agent` are
legal:

```latent
fn model() -> int { return 1; }

fn main() -> int {
    let test = 5;
    let case = 2;
    return model() + test + case;
}
```

Hard keywords (`let`, `fn`, `if`, `class`, `match`, `true`, `ai`, …) are **not**
accepted in name position. For example, `let if = 1;` is the parse error
«ожидалось 'identifier', найдено If» (expected 'identifier', found If).

In engine #1 the sets are different: `web-ide/compiler/token.js` contains `KEYWORDS`
(including `print`) and `SOFT_KEYWORDS`; the words `model`, `agent`, `embedding` are
not there at all — they are lexed as ordinary identifiers. The word `default` in
engine #1 is a hard keyword, and in engine #2 it is a hard (not soft) keyword.

## Operator characters

The lexer recognizes: `+ - * / %` ; `= == != < <= > >=` ; `&& || !` ;
`& | ^ << >>` ; `-> => <-` ; the punctuation `( ) { } [ ] ; , . : :: @`.

- `::` is recognized as a separate token but is **never used** by the parser (reserved).
- There are **no** compound assignments (`+=`, `-=`, `*=`, `/=`, `%=`): `x /= 2` is
  parsed as `x`, `/`, `=`, `2` and produces a parse error.
- Characters outside the set (for example `#`, `$`, `?`, `~`) produce the error
  «Неожиданный символ '# ' на строке L:C» (unexpected character at line L:C).

## Semicolon

Engine #2 requires `;` after:

- a `let` declaration;
- `return` (including `return;`);
- an expression statement (`foo();`);
- `yield;`;
- a class field (`x: int;`);
- `match` in statement position (`match x { ... };`).

The following do not require `;`: `if`, `while`, `for`, `spawn`, `class`, `enum`,
`fn`, `test`, `@decorator`, `select` (a semicolon after `select` is allowed and is
consumed).

```latent
fn main() -> int {
    let x = 1;                  // ; is required
    if (x == 1) { print("ok"); } // ; is not needed
    return x;
}
```

Engine #1 is much more lenient: `;` is optional almost everywhere there
(`match(TokenType.Punct, ';')` instead of `expect`), so code without `;` may work in
the IDE but will not compile with engine #2.

## Encoding and BOM

The source is UTF-8 **without a BOM**. The lexer does not skip the BOM character
(`U+FEFF`):
- engine #2 (wasm) reports `Неожиданный символ '﻿' на строке 1:4294967295` (unexpected
  character at line 1:4294967295; the column is computed with an overflow — a defect);
- the native debug build of `latentc` aborts with a panic
  `attempt to subtract with overflow` in `src/lexer/next_token.rs`.

Save files without a BOM (in VS Code: `files.encoding: utf8`, not "UTF-8 with BOM";
in PowerShell 7 use `Set-Content -Encoding utf8NoBOM`).

## Positions in diagnostics

A token position is `Position { line, column, offset }`; in error texts it is printed
as `на строке L:C` (at line L:C). The origin is 1:1. For lexer errors the position
points at the start of the offending token (for `\X` — at the character after the
backslash).

## Related sections

- [Grammar](./grammar.md) — which tokens the constructs are built from.
- [Diagnostics](./errors.md#lexer) — the exact lexer error texts.
- [Types](./types.md) — which types literals get.
