---
title: "Type System"
description: "Latent types and their WASM representation, type inference (Hindley-Milner), annotations, classes and enums, plus the exact list of what the type checker checks and what it ignores."
sidebar_position: 4
---

# Type system

Source of truth: `src/typechecker/` (engine #2), `src/ast/expr.rs` (`Type`),
`src/codegen/context.rs` (`latent_to_wasm`, `StaticTy`). Engine #1 **has no** type
checker: it parses type annotations and discards them, and type errors only show up at
runtime as JS exceptions.

## Basic types

| Type | In WASM (engine #2) | Literal/value | Note |
|---|---|---|---|
| `int` | `i32` | `42` | signed 32-bit integer |
| `float` | `f64` | `3.14` | double precision |
| `bool` | `i32` (0/1) | `true`, `false` | the result of comparisons and logic |
| `string` | `i32` (pointer) | `"abc"` | `[len u32 LE][utf8]`, `len` in bytes |
| `null` | `i32` (0) | `null` | a null pointer |
| `unit` / `void` | `i32` in the signature, but there is no value | — | see below |
| `[T]` | `i32` (pointer) | `[1, 2, 3]` | `[len u32][elements, 4 bytes each]` |
| `fn(T, ...) -> R` | `i32` (pointer to a closure) | `fn(x) => x` | `[table_slot][env_ptr]` |
| `Name` | `i32` / the class layout | `new Point(...)` | a named class/enum type |
| `Name<A, B>` | varies | `Model<string>` | a generic annotation; in WASM usually `i32` |

`unit` and `void` are synonyms in the type system: both map to `Type::Unit`
(`src/typechecker/infer/stmt.rs`, `parse_type_annotation`). In the signature of a
function with `-> unit`/`-> void` codegen still sets the result to `i32` and appends
`i32.const 0` if the body does not end with `return`
(`src/codegen/compile_fn.rs`).

```latent
fn log(msg: string) -> unit {
    print(msg);
}

fn main() -> int {
    log("hello");
    return 0;
}
```

## Internal representation of types

```text
Type ::= Int | Float | Bool | String | Null | Unit
       | Var($Tn) | Named(name)
       | Array(Type) | Fn([Type], Type)
       | Tuple([Type])           (* not created by the parser in v0.1 *)
       | Generic(name, [Type])
       | Poly(vars, Type)        (* the result of generalization *)
```

- `Poly` is a polymorphism scheme created by `generalize` and removed by
  `instantiate` on every reference to the name.
- The separate AI and concurrency types (`AIType`, `ConcurrencyType` from
  `src/types.rs`) are **not used** by the type checker: they are groundwork from "Part
  I", and the working model is the common `Type`.
- `LatentType`/`AIType`/`ConcurrencyType` (`src/types.rs`) are likewise relic types for
  documentation/tests; the compiler works with `typechecker::Type`.

## Type inference

The type checker implements a variant of Hindley–Milner: substitutions, unification,
occurs check, generalization/instantiation.

1. **Hoisting functions.** First the signatures of all functions in the program enter
   the environment (parameters without annotations are fresh type variables; a return
   without an annotation is `unit`; for `async fn` the return is wrapped into
   `Generic("Promise", [T])`). That is why calls work before the declaration:
   ```latent
   fn main() -> int {
       return later();
   }

   fn later() -> int {
       return 7;
   }
   ```
2. **Hoisting enum variants** and the built-in `Ok`/`Err`/`Some`/`None`: a
   0-ary variant gets the type `Named(Enum)`, a variant with fields gets the type
   `Fn([fields], Named(Enum))`. The enum name is also bound as `Named(Enum)`.
3. **Walking statements.** Types are inferred for each statement, and errors
   accumulate (the whole program is checked, not just up to the first error).
4. **Generalization** (`generalize`) is done for `let` and when a function is re-bound
   after its body has been inferred; on use, a `Poly` name is instantiated with fresh
   variables. But for `fn` generalization effectively breaks: during generalization the
   function signature is already in the environment with its free variables, so
   `gen_vars` is empty and the function stays monomorphic until the first call. For
   `let` lambdas polymorphism does work:
   ```latent
   fn main() -> int {
       let id = fn(x) => x;
       let a = id(1);      // $T = float
       let b = id("str");  // a fresh variable — works
       return a;
   }
   ```
   While `fn id(x) { return x; }` with the calls `id(1)` and `id("str")` produces a
   type error («Несовпадение типов …: ожидалось 'string', найдено 'float'» — type
   mismatch: expected 'string', found 'float'), because the first call fixed the
   parameter type.

### How expressions are typed (an excerpt from `infer/expr/mod.rs`)

| Expression | Result type |
|---|---|
| `42`, `3.14` | **`Float`** — both literals (important: not `Int`) |
| `"..."`, `true`, `null` | `String`, `Bool`, `Null` |
| `a + b` | `String` if at least one side is `String`; otherwise `Float` |
| `a - b`, `a * b`, `a / b`, `a % b` | `Float` |
| `a == b`, `a != b`, comparisons, `&&`, `\|\|` | `Bool` |
| `a & b`, `a \| b`, `a ^ b`, `a << b`, `a >> b` | `Int` |
| `-a` | `Float`; `!a` → `Bool` |
| `arr[i]` | the element type of the array; for `String` — `Int` (a byte) |
| `[1, "a"]` | `Array(fresh)` — homogeneity is **not** required |
| `fn(x) => expr` | `Fn(fresh..., fresh)` |
| `f(args)` | the return type of `f`; the arguments are unified with the parameters |
| `await x` | `T` if `x : Promise<T>`, otherwise an error |
| `match x { ... }` | the type of the bodies of all arms (unified with each other) |
| `new Class(...)` | `Named(Class)` |
| `obj.field` | a "fresh variable", except the special case `Point.x/.y` → `Float` |

Assignment (`=`): the types of the target and the value are unified; the type of an
assignment is the type of the target. The exception is assignment into an array
element (`a[i] = v`): the type is not checked, and the result is considered to be the
type of the value (in Latent arrays are "like dictionaries").

### What the type checker checks

- the use of an undeclared name (a variable or a function) —
  «Неопределённая переменная 'x'» (undefined variable);
- the arity of a call to a known function — «Несовпадение арности…» (arity mismatch…);
- the type of an `if`/`while` condition — it must unify with `bool`;
- the type of the iterable in `for (let x in arr)` — it must be an array;
  (strings are not allowed: `for (x in "ab")` is a type error);
- a `let` annotation against the value;
- a function's return annotation against the type of the last `return`;
- the compatibility of arguments with parameters (through `Fn` unification);
- `await` is only applied to `Promise<T>`;
- the only name coincidence for user types: `Named(a)` unifies with `Named(b)` only
  when `a == b`;
- infinite types (occurs check), for example for `let f = fn(x) => f(x);`.

### What the type checker ignores

This is critical when reading code — compilation does not guarantee "type
correctness":

- **arithmetic operands are not checked**: `a - b`, `a * b`, `a / b`, `a % b` always
  produce `Float`, whatever `a` and `b` are; `+` only checks for the presence of
  `String` for concatenation;
- **comparison operands are not checked**: `1 < 2 < 3`, `"a" < 1` are typed without
  errors;
- **unary `-`/`!`** accept any operand;
- **the index** only requires a "numeric" index (unification with `Float`); the object
  type is not restricted to an array;
- **object fields**: there is no strict typing of records; `obj.field` is a "fresh
  variable", except the residual special case `Generic("Point")` with `x`/`y` fields of
  type `Float`. For other classes the field is not checked;
- **methods**: apart from channels, a method call returns a fresh variable and the
  arguments are checked, but the method signature is not looked up;
- **`null` does not form nullable types**: `null` unifies only with `null`;
  `let x: int = null` is an error, but `x == null` compiles (comparisons do not check
  types);
- **`MissingReturn` is not produced**: a function with a return annotation and no
  `return` may pass the check (and then get `i32.const 0` in codegen);
- **`Tuple`** and **`Union`** are never created by the parser — the code that checks
  them exists, but it is unreachable;
- AI types (`AiLoad`, `AiInfer`, …) are typed in a simplified way, and the parser does
  not create them (except `ai_generate!`).

## Codegen pitfalls related to types

The type checker and codegen use **different** type models. Codegen relies on a
best-effort `StaticTy` (`Int`, `Float`, `Bool`, `Str`, `Array`, `Fn`, `Unknown`)
derived from annotations, literals, and local variables. Hence the observable
specifics (verified on `web-ide/compiler.wasm`):

- a numeric literal is `Float` for the type checker but `Int` for codegen when the
  fractional part is zero. Therefore `let x: float = 2;` and
  `fn f() -> float { return 5.0; }` compile, but the **WASM is invalid**
  (`i32.const` into an f64 local/result);
- `fn f() -> float { return 2.5; }` and `let x: float = 2.5;` are valid;
- rule of thumb: `float` works only if **both the slot and all operands** are
  syntactically "fractional" (a nonzero fractional part). `2.0`, `5.0`, `1e3` break the
  f64 context;
- mixed arithmetic `1 + 2.5` produces invalid WASM (the left operand is `i32`), even
  though the types unify (`int`↔`float` are considered compatible);
- float parameters (`fn f(x: float)`) are valid if the argument is a float expression;
  the call `f(1)` produces invalid WASM;
- arrays with floats (`[1.5, 2.5]`), `a[i] = 1.5`, capturing a float by a lambda,
  `match` with void arms, `fn f() -> unit { return; }`, `let x = print("a");` — all of
  these compile but produce invalid WASM (the full list is in
  [errors → known limitations](./errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm));
- a class field of type `float` is 8 bytes (`f64`), the other fields are 4 (`i32`);
  float fields/float class parameters inside methods produce an invalid module;
- `bool` in codegen is `i32`, so `print(true)` prints `1`, not `true` (in engine #1 it
  prints `true`);
- the result of a string operation (`str`, `.to_str()`) is sometimes considered `Int`
  by codegen, which then prints the pointer as a number; this is a consequence of
  `StaticTy`, not of the type checker.

## Scopes

- Every `{ ... }` block (a function body, `if` arms, a loop body, a lambda) creates a
  new scope; leaving it removes the scope.
- Functions and enum variants are hoisted to the program level.
- A `let` in one scope may shadow a name from an outer one; there is no
  redeclaration error.
- Classes are registered in the environment as `Generic(Name, [])`; inside methods
  `this` of that type is bound.
- A lambda gets a new scope with its parameters; free variables are captured by value
  (in codegen — through the env).

## Related sections

- [Operators](./operators.md) — which instructions codegen picks.
- [WASM ABI](./wasm-abi.md) — the layout of values in memory.
- [Diagnostics](./errors.md) — the exact type error texts.
- [parity-matrix](../specs/parity-matrix.md) — where type checker #2 is stricter or
  weaker than engine #1.
