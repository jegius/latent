---
title: "Diagnostics Catalog"
description: "The exact Latent error texts: lexer, parser, modules and linking, type checker, codegen, self-hosted compiler; causes, how to fix, and format limitations (no error codes, the L:C position inside the text)."
sidebar_position: 7
---

# Diagnostics

Latent **has no error codes** (no `E0123`): a diagnostic is a string in Russian (engine
#2) or in English (engine #1) with an embedded `L:C` position (numbered from 1). The
engine #2 format:

- lexer/parser: `... на строке L:C` ("... at line L:C");
- type checker: `... на строке L:C: details`;
- codegen: **without a position** (text only).

`compile_source` (`src/lib.rs`) returns the first lexing/parsing error; if the lexer
and the parser succeed, **all** type checker errors are collected and joined with
`"; "`. Codegen returns the first error.

The source catalog in machine-readable form:
`tooling/language-data/language.json` → `diagnostics`.

The messages below are quoted **verbatim in Russian**, because that is the literal
compiler output; an English rendering is given in parentheses at the first mention and
in the "Cause" column.

## Lexer

Source: `src/lexer/error.rs`.

| Text (verbatim) | Cause | How to fix |
|---|---|---|
| `Неожиданный символ '<ch>' на строке L:C` | the character cannot start a token (`#`, `$`, `?`, `~`, ...); reads as "unexpected character, at line L:C" | remove/replace the character; check that only language operators are used |
| `Незавершённая строка на строке L:C` | the string is not closed before `\n`/EOF; reads as "unterminated string, at line L:C" | close the `"`; newlines inside a literal are forbidden |
| `Неверная escape-последовательность '<\X>' на строке L:C` | the escape is not one of `\n \t \\ \"`; reads as "invalid escape sequence, at line L:C" | use only those four |
| `Неверный формат числа '<текст>' на строке L:C` | an exponent without digits (`1e`, `1e+`); reads as "invalid number format, at line L:C" | add the digits or drop the `e` |
| `Незавершённый блочный комментарий на строке L:C` | there is no closing `*/`; reads as "unterminated block comment, at line L:C" | close the comment (nesting is taken into account) |

Engine #1 answers the same situations in English:

- `Unexpected character '#' at line N` — an unknown character. Additionally:
  `&`, `|`, `^`, `<`, `>` in the wrong place are not lexed as operators by it.
- `Unexpected token '...' at line N`, `Expected ) but got '...' at line N` —
  parser errors (see below).

## Parser

Source: `src/parser/error.rs`. The message substitutes the **Debug name of the token**,
not the lexeme: `Semicolon`, `RBrace`, `Dot`, `Assign`, `BitOr`,
`If`, `Identifier("x")`, `Number(2.0)`, `String("...")`.

| Text (verbatim) | Cause | How to fix |
|---|---|---|
| `Ошибка парсинга на строке L:C: ожидалось '<ожидаемое>', найдено <Токен>` | an unexpected construct; reads as "parse error at line L:C: expected X, found Y" | look at `found` (the token name) and at the place |
| `Неожиданный конец файла: ожидалось '<ожидаемое>'` | the file is truncated (usually an unclosed `{`/`(`); reads as "unexpected end of file: expected X" | add the closing brackets |
| `Неверная цель присваивания на строке L:C` | the left-hand side of `=` is not a name/index/field (for example `1 = 2`); "invalid assignment target at line L:C" | assign to a variable, an element, or a field |

Typical examples:

| Code | Diagnostic |
|---|---|
| `fn main() { let x = ; }` | `... ожидалось 'expression', найдено Semicolon` (expected 'expression', found Semicolon) |
| `fn main() -> int { return 1 }` | `... ожидалось ';', найдено RBrace` (expected ';', found RBrace) |
| `let x: int | null = 1;` | `... ожидалось '=', найдено BitOr` (expected '=', found BitOr; there are no union types) |
| `x /= 2;` | `... ожидалось 'expression', найдено Assign` (expected 'expression', found Assign; there is no `/=`) |
| `let t: Tensor<[2,3]> = ...` | `... ожидалось 'identifier', найдено Number(2.0)` (expected 'identifier', found Number(2.0); `[2,3]` is not a type in generic arguments) |
| `let a = 1..2;` | `... ожидалось 'identifier', найдено Dot` (expected 'identifier', found Dot) |

Engine #1: `Expected <T> but got '<value>' at line N`,
`Unexpected token '<value>' at line N`, `Expected decorator name at line N`,
`Invalid type annotation at line N`.

## Modules and linking

Sources: `src/modules/loader.rs` (loading, paths), `src/modules/linker.rs`
(tables, mangling), `src/modules/manifest.rs` (the `LPF1` manifest), `src/lib.rs`
(the single-file API). Every loader/linker error carries a **file path**, and
import errors also carry the declaration position: `path:line:col: ...`. The
message texts themselves are Russian (engine #2), so they are quoted verbatim.

| Text (verbatim) | Cause | Fix |
|---|---|---|
| `абсолютный путь импорта недопустим: '<path>'` | the path starts with `/`, `C:\` or `\\` | use a relative path (`./`, `../`) |
| `путь импорта должен оканчиваться на '.lat': '<path>'` | the extension is missing | add `.lat` |
| `путь импорта должен быть относительным ('./' или '../'): '<path>'` | `import { x } from "math.lat"` | put `./` before the name |
| `<path>:<L>:<C>: файл не найден: <resolved>` | no file at the resolved path | create the file or fix the path |
| `<path>:<L>:<C>: символ '<name>' не экспортирован из '<path>'` | importing a private/non-existent name, a typo | add `export` or fix the name |
| `<path>:<L>:<C>: имя '<name>' уже объявлено в модуле` | the import conflicts with a local `fn`/`class`/`enum` | rename the local name or use an alias |
| `<path>:<L>:<C>: дубликат импортированного имени '<name>'` | the same name is imported twice | keep one import |
| `<path>:<L>:<C>: export '<name>': объявление не найдено` | `export` is attached to a name that does not exist (internal linker check) | move the `export` to the declaration |
| `<path>:<L>:<C>: модуль не найден: <resolved>` | the file was present at load time but got lost during linking | check the file set/paths |
| `<path>: файл передан дважды с разным содержимым` | two files with one canonical path and different text | keep one file with one content |
| `<path>: entry-файл не найден среди переданных файлов` | the entry is not in the `SourceFile` set | pass the entry in `files` |
| `<path>: <lexer/parser error>` | a syntax error in a specific file | see "Lexer"/"Parser" |
| `Импорты не поддерживаются в однофайловой компиляции: используйте latent::compile_files / latentc compile <entry.lat> (проект из нескольких файлов)` | the source contains `import` but `compile_source`/`latent_compile` was called | compile the project with `compile_files`/`latentc compile` |
| `bundle: программа должна быть связана (import/export уже сняты)` | internal: `bundle_files` received a non-linked AST | do not call `bundle::print_program` directly |
| `LPF1: манифест слишком короткий` · `LPF1: неверная магия (ожидалось 'LPF1')` · `LPF1: неожиданный конец манифеста` · `LPF1: неожиданный конец манифеста (строка)` · `LPF1: путь/исходник не является UTF-8` · `LPF1: манифест без файлов` · `LPF1: entry_index <N> вне диапазона файлов` | a broken/incompatible manifest in the `latent_compile_files`/`latent_bundle_files` C-ABI | rebuild the manifest (see [CLI](./cli.md#multi-file-abi-latent_compile_files)) |

A real output (engine #2, `latentc check`, verbatim):

```text
$ latentc check main.lat
error: main.lat:1:10: символ 'sq' не экспортирован из 'math.lat'
```

Parser/type-checker diagnostics are not appended to a module error: the project
structure is checked first, the types after it. If the error is in an imported
file, it is printed with that file's path, not the entry's.

### The same errors in engine #1 (English)

Engine #1 (`web-ide/compiler/modules*.js`) throws `ModuleError` with a `code`
field; the text carries the path and, when known, the line (`path:line: ...`):

| Text | `code` |
|---|---|
| `module path must be relative, got '<path>'` / `module path must end with '.lat': '<path>'` / `module path '<path>' escapes the project root` | `MODULE_PATH_ABSOLUTE` / `MODULE_PATH_EXTENSION` / `MODULE_PATH_OUTSIDE` |
| `import path must be relative ('./' or '../'), got '<path>'` | `MODULE_PATH_NOT_RELATIVE` |
| `module '<path>' not found (resolved to '<path>'). Create the file in the workspace (＋) or fix the import path.` | `MODULE_NOT_FOUND` |
| `module '<path>' does not export '<name>'` | `NOT_EXPORTED` |
| `duplicate imported name '<name>'` | `DUPLICATE_IMPORT` |
| `duplicate module file '<path>' in workspace` · `duplicate top-level declaration '<name>'` · `duplicate enum variant '<name>'` | `DUPLICATE_MODULE` / `DUPLICATE_DECLARATION` |
| `ambiguous enum variant '<variant>' imported from '<path>'` | `AMBIGUOUS_VARIANT` |
| `entry file '<path>' not found in workspace` · `project has no .lat files` | `ENTRY_NOT_FOUND` / `PROJECT_EMPTY` |
| `invalid module manifest: <detail>` | `MANIFEST_INVALID` |

## Type checker

Source: `src/typechecker/types/mod.rs` (Display), plus the checks in
`src/typechecker/infer/*`.

| Text (verbatim) | Cause | How to fix |
|---|---|---|
| `Неопределённая переменная '<имя>' на строке L:C` | the name is not declared (or it is `ai`, `break`, `this` outside a method, an unknown function in an expression); "undefined variable at line L:C" | declare the variable/function; check for a typo |
| `Несовпадение типов на строке L:C: ожидалось '<T1>', найдено '<T2>'` | unification failed; reads as "type mismatch at line L:C: expected T1, found T2" | align the types; remember that `int`↔`float` are compatible, but `null` is not |
| `Бесконечный тип на строке L:C: '<$Tn>' = '<T>'` | occurs check (for example `let f = fn(x) => f(x);`); reads as "infinite type at line L:C" | remove the self-application / restructure the recursion |
| `Несовпадение арности на строке L:C: ожидалось N аргументов, найдено M` | a call to a function with a different number of arguments; reads as "arity mismatch at line L:C: expected N arguments, found M" | fix the call/signature |
| `Не функция на строке L:C: тип '<T>'` | a call on a non-function value, `await` on a non-`Promise`, and so on; reads as "not a function at line L:C" with the type name | fix the type/expression |
| `Отсутствует return на строке L:C` | **reserved**, not produced in v0.1.0; reads as "missing return at line L:C" | — |
| `Неверный AI-тип на строке L:C: <сообщение>` | **reserved**, not produced in v0.1.0; reads as "invalid AI type at line L:C" | — |

Specifics:

- For `if (1)` you get `Несовпадение типов ...: ожидалось 'float', найдено
  'bool'` — the "reverse" order: `expected` is the left-hand side of the unification
  (the condition type) and `found` is the right-hand side (`bool`). This is not a text
  bug but a consequence of how `unify(t_cond, Bool)` is implemented.
- Arity errors and "not a function" come from `Fn` unification, so the position may
  point at the name of the called function rather than at the argument.
- `for (let x in "строка")` is a type error: the iterable must be an array; the
  message looks like `Несовпадение типов ...: ожидалось 'string', найдено '[$T5]'`
  (expected 'string', found '[$T5]').
- `await` on a non-`Promise`: `... ожидалось 'Promise<$T6>', найдено 'float'`
  (expected `Promise` of `$T6`, found `float`).
- The type checker reports all errors at once (joined with `"; "`), but after the first
  error in a particular expression it may lose the context.

### What the type checker does NOT catch

Many errors only surface in codegen or at runtime: arithmetic/comparison operands,
object field types, method signatures (except for channels), array homogeneity, and
`null` safety. The full list is in
[types → what the type checker ignores](./types.md#what-the-type-checker-ignores).

## Codegen

Source: `src/codegen/`. These messages are **without a position**.

| Text (verbatim) | Cause |
|---|---|
| `Unknown function: <name>` | a call to a name that is not among functions/builtins/variants |
| `Builtin '<имя>' не поддерживается движком №2 (требует host-рантайма)` | a host primitive (`tensor`, `ai_infer`, `channel`, ...); reads as "builtin NAME is not supported by engine #2 (requires a host runtime)" |
| `Метод '<имя>' не поддерживается движком №2 (требует host-рантайма)` | a host method (`send`, `recv`, ...) or an unknown method; reads as "method NAME is not supported by engine #2 (requires a host runtime)" |
| `Undefined variable: <name>` | the name was not found among the locals (often a reference to a top-level `let` or a nested `fn`: they are not compiled) |
| `Unknown field: <Class>.<field>` | the field is not in the class layout |
| `Unknown class: <name>` | the class is not declared (including `arr.len`, which is treated as a field of an unknown class) |
| `Unknown enum variant: <name>` | the constructor is neither declared nor built-in |
| `Enum variant '<name>' expects N field(s), got M` | the wrong arity of the constructor |
| `Enum pattern '<name>' expects N field(s), got M` | the wrong number of sub-patterns |
| `Unsupported literal pattern in match codegen` | a pattern literal of an unsupported kind (for example `null`) |
| `Complex assignment not yet supported` | assignment into a nested target |
| `Оператор отправки в канал (ch <- v) требует host-рантайма движка №1` | `<-` send; "the channel send operator requires the engine #1 host runtime" |
| `Приём из канала (<- ch) требует host-рантайма движка №1` | `<-` recv; "receiving from a channel requires the engine #1 host runtime" |
| `AI-примитивы требуют host-рантайма движка №1` | `ai_generate!`, AI nodes of the AST; "AI primitives require the engine #1 host runtime" |
| `push expects (array, value)` | the functional `push` without 2 arguments |
| `internal: lambda not hoisted` | an internal lambda registration error |

Engine #1 (English, runtime): `Undefined function 'x'`, `Undefined variable
'x'`, `Unknown method 'x'`, `Unknown class 'x'`, `Unknown field`, `Function
'main' not found`, `assertion failed`, `assert_eq failed: a != b`,
`Deadlock: ...`, `Loop iteration limit exceeded`, `AI is not enabled. Use
"Compile & Run with AI" button.`, `Unable to send on closed channel`,
`Value is not iterable: ...`, `match: no arm matched value ...`.

## Self-hosted compiler errors

On error `selfhost/shc.lat` returns a negative number and puts
`[len u32][utf8 text]` at `OUTPUT_ADDR+4` (65536+4). The texts are produced by the
compiler itself (`selfhost/src/45a_tc_core.lat` and the other `45*` parts, the `ERRB`
buffer); they are shorter than the Rust diagnostics. For parity, use
`selfhost/test/*.test.mjs` and [specs/selfhost](../specs/selfhost.md) as the reference.

## Codegen diagnostics and engine #2 limitations

Codegen (`src/codegen/`) **does not check types**: it picks instructions by a syntactic
estimate (`StaticTy`), and local slots by the annotation, without conversions. That is
why some programs compile "successfully" (status=1) while `WebAssembly.validate()`
returns `false` for the result. This is an **honest description of the current
behavior**: such constructs must not be used as working code.

### Known limitations of engine #2 (compiles, but invalid WASM)

| Case class | Example | Why |
|---|---|---|
| float literals with a zero fractional part | `fn main() -> float { return 5.0; }`, `1e3` | the literal `5.0` → `i32.const`, the signature is `f64` |
| float division of integer literals | `7.0 / 2.0` | both literals have `fract==0` → `i32.div_s` |
| `let` with an annotation of a "different" type | `let x: int = 1.5;`, `let x: float = 2;` | the slot follows the annotation, the value has another valtype |
| arrays with float | `let a = [1.5, 2.5];`, `a[0] = 1.5` | the elements are written with `i32.store` |
| mixed float/int arithmetic | `1 + 2.5` | the left operand → `i32.const` |
| float comparisons | `if (1 < 1.5)` | `f64.lt` with an i32 operand |
| `%` on float | `5.5 % 2.0` | always `i32.rem_s` |
| `sqrt` outside an f64 context | `print(sqrt(16))`, `int(sqrt(16))` | `StaticTy::Int` → `i32_to_str`/an int context on an f64 value; with `-> float { return sqrt(16); }` it is valid |
| `unit` return with `return;` | `fn f() -> unit { return; }` | the signature is i32, `return` without a value |
| void call used as a value | `let x = print("a");` | `local.set` without a value |
| float fields/float class parameters | `class P { v: float; fn init(a: float) {…} }` | f64 in an i32 method signature |
| a float captured by a lambda | `let x = 1.5; let f = fn() => x;` | the capture is written with `i32.store` |
| `match` with void arms | `match 1 { case 1: print(1), default: print(0) };` | `if` expects an i32 result |
| assigning a float into an int slot | `let x = 1; x = 2.5;` | the slot is i32, the value is f64 |
| a float argument in an int parameter | `fn f(x: int) -> int {…} f(1.5)` | there is no conversion |
| float enum payload | `enum E { A(float) } A(1.5)` | the payload is written with `i32.store` |
| `new Class(...)` without `init` in reachable code | `class A {x:int;} let a = new A(5);` | extra values are left on the stack |
| a void method in statement position | `class B { fn set(v) { this.value = v; } } b.set(42);` | `expr_produces_value` does not recognize methods → a `drop` after the void call |

Rule of thumb: **float works only where both the slot and all operands are
syntactically "fractional"**: `let x = 1.5; let y = 2.5; x + y` → `4.0`,
`print(1.5)` → `1.500000`, `fn f() -> float { return 2.5; }` are valid.
Float literals with an integer value (`2.0`, `5.0`) break the f64 context.

### Other defects important for documentation

| What | Observation |
|---|---|
| `pop()` on an empty array | reads `arr[-1]` — memory corruption, no diagnostic |
| `push` on a string | compiles and writes into the string |
| `assert`/`assert_eq` with a message | the second argument is ignored |
| `len()` without an argument | reads memory at address 0 (usually `0`) |
| duplicate `fn` | not diagnosed, the last signature/body wins |
| `obj.length` is intercepted before class fields | `p.length` reads the memory header, not the class field `length` |
| `this` outside a method | `UndefinedVariable`; at the same time `infer_class_name` for `this` without a class picks the first class it finds (a heuristic) |
| a C-style `for` with a non-bool condition | not diagnosed |
| `return` inside `spawn` | returns from the enclosing function |
| `return` inside a `match` arm | does not parse (an arm is an expression) |
| `f64_to_str` for large numbers | the integer part goes through `i32.trunc_f64_s`; `\|x\| ≥ 2^31` traps; `str(1e300)` does not work |
| `i32_to_str` for `i32::MIN` | `0 - n` overflows |
| strings in `< > <= >=` | compared **by contents** (`STR_CMP`), not by pointers |
| `assert_eq` of arrays | i32 values (pointers) are compared: strings are now compared by contents, arrays are still compared by pointers |
| escape sequences | only `\n \t \\ \"`; `\r`, `\0`, `\u{...}` are errors |
| division/remainder by 0 | a WASM trap; `i32::MIN / -1` is a trap |
| builtin arity | checked by the type checker (`ArityRange`); variadic `print` is the exception |
| a BOM at the start of the file | the lexer does not skip `U+FEFF`: an error with the column `4294967295` (an overflow), and a debug build of `latentc` panics |
| extra values on the stack | detected only by `WebAssembly.validate()` on the host |

### How such examples are marked in the documentation

`docs/scripts/validate-examples.mjs` considers a block "expected-invalid" if its first
non-empty line is a comment such as `// Does not compile with engine #2: ...`
(the validator also accepts `// expected-error ...` and `// host-only ...`), or if the
info string contains `expected-error`. This is how the host-only examples and the
examples from the table above are marked. Do not mark working examples: the validator
reports «устаревший маркер» ("stale marker").

Multi-file examples (a block with `import` that does not compile on its own) are
marked with the `module-part` marker — either as the first line
`// module-part <file>` or in the info string (`latent module-part`). The
validator **skips and counts** such blocks separately; to check a project use
`latentc check <entry.lat>`. See [modules](../guide/modules.md).

## How to read a diagnostic

1. The `L:C` position is 1-based, the column is counted in characters (not bytes).
2. If the message has no position, it comes from codegen; look for the function/field
   name in the text.
3. Several errors joined by `; ` all come from the type checker.
4. The error text is returned as is in the `latent_compile` buffer (status=0) — in the
   IDE that is what you see in the console.

## Related sections

- [CLI](./cli.md) — how `latentc` prints errors.
- [Grammar](./grammar.md#what-parses-but-does-not-work-further) — what parses but is
  not supported.
- [Types](./types.md) — why some errors are not diagnosed.
