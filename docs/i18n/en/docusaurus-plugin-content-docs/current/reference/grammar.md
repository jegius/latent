---
title: "Grammar (EBNF from the Parser)"
description: "The complete Latent EBNF grammar reconstructed from src/parser: declarations, statements, expressions (Pratt), types, and patterns. The precedence table and notes on what parses but is rejected or ignored."
sidebar_position: 3
---

# Grammar

The grammar below is reconstructed **from the parser code**
(`src/parser/`: `declarations.rs`, `statements.rs`, `expressions/`,
`type_parser.rs`). This is not an academic description but a contract: everything
listed here is really accepted by the parser. At the end there is the precedence table
and a list of things that "parse but do not work further".

EBNF notation: `{ x }` — zero or more repetitions, `[ x ]` — optional,
`x | y` — alternative, `"..."` — terminal.

## Program and declarations

```ebnf
Program        ::= { Declaration } EOF

Declaration    ::= Decorator
                 | TestDeclaration
                 | LetDecl
                 | AsyncFnDecl
                 | FnDecl
                 | ClassDecl
                 | EnumDecl
                 | Statement

Decorator      ::= "@" Name [ "(" [ Expr { "," Expr } ] ")" ] Declaration
TestDeclaration::= "test" ( String | [ "(" ] String [ ")" ] ) Block
LetDecl        ::= "let" Ident [ ":" Type ] "=" Expr ";"

FnDecl         ::= "fn" ( Ident | SoftKeyword ) "(" [ Params ] ")" [ "->" Type ] Block
AsyncFnDecl    ::= "async" "fn" ...            (* same as FnDecl, with is_async *)

Params         ::= Param { "," Param }
Param          ::= Ident [ ":" Type ]

ClassDecl      ::= "class" Ident "{" { ClassMember } "}"
ClassMember    ::= FnDecl
                 | ( Ident | SoftKeyword ) [ ":" Type ] ";"

EnumDecl       ::= "enum" Ident "{" [ Variant { "," Variant } [ "," ] ] "}"
Variant        ::= Ident [ "(" [ Type { "," Type } ] ")" ]
```

Notes on declarations:

- The parser does not distinguish "top level" and "block": **inside** `{ ... }` the
  same `parse_declaration` is used, so `fn`, `class`, `enum`, `test`, `@decorator` are
  syntactically allowed inside a function. The code generator, however, **silently
  ignores** nested `fn`/`class`/`enum` (`src/codegen/emit_stmt.rs`, the `_ => Ok(())`
  branch).
- `TestDeclaration` is recognized by the `test` prefix plus a string literal, including
  the optional parentheses: `test("name") { ... }` and `test "name" { ... }`.
- A function name may be a soft keyword (`fn model()`) but not a hard one.
- `Params`: a parameter name is an ordinary identifier; `this` does not need to be
  declared as a class parameter (codegen adds it implicitly, see
  [codegen internals](../specs/internals-codegen.md)).
- The separator in parameter/variant/field lists is a comma; a trailing comma is
  allowed in an enum (as well as in call arguments and array elements — the parse
  loops terminate on the token kind).
- `Decorator` can be attached to any declaration: `@forall("array") fn f(...)`,
  `@ai_contract("sorting") fn g(...)`, `@test("x") fn h(...)`.

## Statements

```ebnf
Block          ::= "{" { Declaration } "}"

Statement      ::= IfStmt | WhileStmt | ForStmt | ReturnStmt | SpawnStmt
                 | MatchStmt | SelectStmt | YieldStmt | ExprStmt

IfStmt         ::= "if" "(" Expr ")" Block [ "else" ( Block | IfStmt ) ]
WhileStmt      ::= "while" "(" Expr ")" Block

ForStmt        ::= "for" "(" ForCForm ")" Block
                 | "for" "(" "let" Ident [ ":" Type ] "in" Expr ")" Block
ForCForm       ::= [ LetDecl | Expr ";" ] ";" [ Expr ] ";" [ Expr ]

ReturnStmt     ::= "return" [ Expr ] ";"
SpawnStmt      ::= "spawn" ( Block | Expr ) [ ";" ]
MatchStmt      ::= MatchExpr ";"
SelectStmt     ::= "select" "{" { SelectArm } [ DefaultArm ] "}" [ ";" ]
SelectArm      ::= [ "case" ] [ Ident ] "<-" Expr ":" Block
DefaultArm     ::= [ "case" ] "default" ":" Block

YieldStmt      ::= "yield" ";"
ExprStmt       ::= Expr ";"
```

Notes on statements:

- **Conditions are always parenthesized**: `if (x)`, `while (x)`, `for (...)`; the
  variant without parentheses is not accepted.
- `else if` is implemented by recursion: `else` + `if` → a nested `if` statement.
- `for` has two forms. C style: `for (let i = 0; i < n; i = i + 1)`, where `init` may
  be a `let`, an assignment/expression, or empty (`for (; i < n; )`); `cond` and
  `step` are optional too. Iteration form: `for (let x in arr)`; the variable type may
  be specified, but it is parsed and then **discarded** (the variable gets the element
  type of the iterable).
- `spawn` accepts either a block `spawn { ... }` or an expression
  (`spawn worker(args)`); the expression is wrapped into a single expression statement
  and runs as a "goroutine".
- `match` in statement position is a match expression plus a mandatory `;`.
- `select` is a separate statement. `case` is optional (both `case v <- ch:` and
  `v <- ch:` are accepted); the `default` arm is optional. The arm body for a statement
  is mandatory and must be a `{ ... }` block; for a select expression the body is an
  expression.
- `yield;` — the semicolon is mandatory.
- An expression statement requires `;`. Assignment is an expression, so
  `x = 1;` is an expression statement too.

## Expressions

Expressions are parsed by the Pratt parser (`src/parser/expressions/core.rs`).

```ebnf
Expr           ::= Prefix { InfixOp Expr | Postfix }

Prefix         ::= Number | String | "true" | "false" | "null"
                 | Ident | SoftKeyword
                 | "ai"                                  (* the identifier "ai" *)
                 | "channel" [ "<" Type ">" ] "(" [ Args ] ")"
                 | "async" | "this" | "assert"
                 | "new" Ident
                 | "-" Expr | "!" Expr | "<-" Expr | "await" Expr
                 | "(" Expr ")"
                 | "[" [ Expr { "," Expr } ] "]"
                 | Lambda | MatchExpr | SelectExpr
                 | "ai_generate" "!" "(" String ")"

Lambda         ::= "fn" "(" [ Params ] ")" ( "->" Type )? ( "=>" Expr | Block )
MatchExpr      ::= "match" Expr "{" { MatchArm } "}"
MatchArm       ::= [ "case" ] Pattern ":" Expr [ "," ]
SelectExpr     ::= "select" "{" { SelectExprArm } [ DefaultExprArm ] "}"
SelectExprArm  ::= [ "case" ] [ Ident ] "<-" Expr ":" Expr [ "," ]
DefaultExprArm ::= [ "case" ] "default" ":" Expr [ "," ]

Pattern        ::= "_"
                 | Number | String | "true" | "false" | "null"
                 | Ident [ "(" [ Pattern { "," Pattern } ] ")" ]
                 | "default"

InfixOp        ::= "=" | "<-" | "||" | "&&" | "==" | "!="
                 | "<" | ">" | "<=" | ">=" | "|" | "^" | "&"
                 | "<<" | ">>" | "+" | "-" | "*" | "/" | "%"
Postfix        ::= "(" [ Args ] ")" | "[" Expr "]" | "." Ident
Args           ::= Expr { "," Expr }
```

Notes on expressions:

- **`new Class(...)` is not a special parser node**: `new` is parsed as an identifier
  with a space — `Identifier("new Class")` — and the call `(...)` is an ordinary
  postfix. Hence the rules: the class must immediately follow `new`, and the
  arguments are an ordinary list.
- **`channel<int>()`**: `channel` is a keyword, so it is parsed by a dedicated branch;
  the type arguments (`<int>`) are parsed and discarded; the result is a call of a
  function named `channel`.
- **`ai`** in operand position becomes the identifier `"ai"`; `ai.load(...)`,
  `ai.infer(...)`, `ai.agent(...)` syntactically look like method calls on a value
  named `ai`, but there is no such variable — the type checker reports
  «Неопределённая переменная 'ai'» (undefined variable). (The AST has the nodes
  `AiLoad/AiInfer/AiAgent`, but the parser never creates them — see below.)
- **`ai_generate!("prompt")`** is the only AI primitive with a dedicated parser branch
  (`ExprKind::AiGenerate`); the argument must be a string literal.
- `assert` is a special token in prefix position and becomes the identifier
  `assert`. `assert_eq` is a soft keyword and also becomes an identifier. Both "calls"
  are parsed as ordinary calls.
- Lambda: `fn(x) => expr` or `fn(x) { ... }`; after `)` a return type may be given
  (`fn(x) -> int { ... }`). Lambda parameters allow annotations. The free variables of
  a lambda are computed lexically by the parser and stored in `locals` (used by codegen
  for closures).
- `match` is an expression; arms are separated by commas, `case` and the trailing
  comma are optional. `default:` is a synonym for `_` (wildcard). An arm body may be a
  `{ ... }` block.
- `select` can be a statement or an expression; in an expression the value is the
  result of the winning arm body.
- Parentheses around an expression are ordinary grouping; there is no separate
  "tuple" (although the type system has `Tuple`, the parser never creates one).
- `1 < 2 < 3` is parsed as `(1 < 2) < 3` (left associativity of comparisons).

## Types in annotations

```ebnf
Type           ::= "fn" "(" [ Type { "," Type } ] ")" "->" Type
                 | "[" Type "]"
                 | "channel"                                  (* built-in channel type *)
                 | Name [ "<" [ Type { "," Type } ] ">" ]
Name           ::= Ident | SoftKeyword
```

Specifics (`src/parser/type_parser.rs`):

- inside `<>`, type identifiers **and numeric literals** are allowed:
  `Tensor<2, 3>` parses, and the number becomes `Type::Named("2")`. But
  `Tensor<[2, 3]>` — **no**: `[` expects a type, and `Number` cannot start a type.
- `channel` as an annotation is a special branch, and the result is
  `Type::Named("channel")`.
- **there are no union types in the grammar**: the construct `int | null` does not
  exist in an annotation, although `ast::Type::Union` and `LatentType::Union` are
  defined (the parser never creates them in the AST).
- `void`/`unit` are parsed as ordinary names (they are not lexer keywords), and the
  type checker maps both to `Type::Unit`.

## Precedence table (Pratt)

The numbers are binding powers from `src/parser/expressions/core.rs`
(`(left_bp, right_bp)`; the larger, the "tighter"). Left associativity:
`right_bp = left_bp + 1`.

| Precedence | Operator | Assoc. | Note |
|---:|---|---|---|
| 2 | `=` (assignment) | right | target: a name, `a[i]`, `o.f` |
| 2 | `<-` (send to a channel) | right | host-only |
| 10 | `\|\|` | left | short-circuit |
| 20 | `&&` | left | short-circuit |
| 30 | `==`, `!=` | left | in engine #2, for strings — a byte-wise comparison |
| 40 | `<`, `>`, `<=`, `>=` | left | |
| 50 | `\|`, `^` | left | bitwise |
| 60 | `&` | left | bitwise |
| 70 | `<<`, `>>` | left | shifts |
| 80 | `+`, `-` | left | `+` on `string` — concatenation |
| 90 | `*`, `/`, `%` | left | |
| 95 | prefix `-`, `!`, `<-`, `await` | right | `parse_expression(95)` |
| 100 | postfix `()`, `[]`, `.` | left | call/index/field |

Consequence: `1 | 2 + 3` = `1 | (2 + 3)`; `a && b == c` = `a && (b == c)`;
`-x * y` = `(-x) * y`; `a = b = c` = `a = (b = c)` (and that is allowed: the result of
an assignment is a value, see [operators](./operators.md)).

## What parses but does not work further

This is an important section: the grammar is wider than the working semantics. Below
are constructs that the parser accepts but the compiler/type checker rejects or
ignores.

| Construct | What happens |
|---|---|
| union type `int \| null` | **does not parse** (no production) → error «ожидалось '=', найдено BitOr» (expected '=', found BitOr) |
| tuple `(int, int)` in a type | does not parse (parentheses are treated as grouping/`fn` parameters) |
| `ai` declarations (`ai model ...`, `AiLoad`) | the AST/type checker/codegen support the nodes, but the parser **never creates** them |
| `ai` as a value | the identifier `"ai"` → «Неопределённая переменная 'ai'» (undefined variable) |
| `ai.infer/ai.load/ai.agent` | method calls on the nonexistent variable `ai` → the same error |
| nested `fn`/`class`/`enum` in a body | parsed, the type checker types them, codegen **ignores** them |
| `break`/`continue` | identifiers → «Неопределённая переменная 'break'» (undefined variable) |
| `if` as an expression | does not parse (`if` is not allowed in expression position) |
| `let x = if (...) ...` | error «ожидалось 'expression', найдено If» (expected 'expression', found If) |
| `try/catch`, `switch`, loops with parentheses but without `()` | do not exist |
| a statement without `;` for `let`/`return`/a call | error «ожидалось ';'» (expected ';'; often allowed in engine #1) |
| `x += 1`, `++x` | do not exist (the lexer does not know such operators) |
| `spawn` of a block/a call | parses; in engine #2 it runs sequentially, in #1 there is a scheduler |
| `select` over channels | parses; in engine #2 the **body of the first arm** runs (or the default) without waiting |
| `await` | parses; in engine #2 it is a transparent unwrapping of the value |
| `channel()` | parses; in engine #2 it is the error «Builtin 'channel' не поддерживается…» (builtin not supported…) |
| `@decorator fn f(...)` / `@decorator class C` | parses, but the decorator target is **not registered** by the function/class scanner: calling `f(...)`/`new C(...)` yields `Unknown function` |
| `test "name" { ... }` at top level | parses, is typed, but the body is not emitted (there is no runner) |

## Engine #1 grammar (differences)

Engine #1 (`web-ide/compiler/parser*.js`) parses almost the same subset, but with
differences that matter for the IDE:

- the semicolon is **optional** in most statements;
- only the operators `+ - * / %`, `== != < <= > >=`, `&& || !`,
  `-> => <-`, ` = ` are supported; there are no bitwise `& | ^ << >>` (the lexer fails
  on `&`);
- `for (;;)` without `let` at the beginning is not supported; the form
  `for (let x in ...)` does exist;
- `a = b = c` is not supported (assignment is a statement, not an expression);
- `let x = if (...) ...` is not supported;
- there are no block comments `/* */`;
- type annotations are parsed but not checked and are discarded;
- `enum` is not supported at all (the lexer/parser do not know such a declaration).

## Related sections

- [Lexical structure](./lexical.md) — the tokens the grammar is built from.
- [Types](./types.md) — how annotations turn into the type system.
- [Operators](./operators.md) — the semantics of each operator.
- [Diagnostics](./errors.md) — the exact parsing error texts.
