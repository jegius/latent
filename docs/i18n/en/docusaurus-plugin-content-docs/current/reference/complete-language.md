---
title: "Latent in One Page (for AI)"
description: "A consolidated one-pager for the Latent language: everything needed to write and read programs — syntax, types, operators, builtins, engine limitations, diagnostics. With links to the details."
sidebar_position: 10
---

# Latent in one page

A practical summary of the language. Every code block is checked by the engine #2
compiler (`web-ide/compiler.wasm`) unless marked otherwise. For details, follow the
links.

## Program skeleton

```latent
fn main() -> int {
    print("hello");
    return 0;
}
```

- The entry point is `fn main` (without it the module compiles, but there is no `main`
  export).
- `;` is mandatory after `let`, `return`, and expression statements; after `if`/
  `while`/`for`/`class`/`fn` it is not needed.
- Top level: `fn`, `class`, `enum`, `let`, `test`, `@decorator`. Only
  `fn`/`class`/`enum` are actually compiled into code; a top-level `let` and statements
  are typed but not executed.
- Comments: `//` and `/* ... */` (nested).

## Literals and types

```latent
fn main() -> int {
    let i = 42;             // int
    let f = 2.5;            // float
    let b = true;           // bool
    let s = "latent";       // string (UTF-8, [len][bytes])
    let n = null;           // null (a null pointer)
    let a = [1, 2, 3];      // [int]
    let m = [[1, 2], [3, 4]];
    let fnv = fn(x) => x * 2;
    return i;
}
```

- Strings: only `"..."`; escapes **only** `\n`, `\t`, `\\`, `\"`.
- Numbers: decimal, with an `e` exponent; codegen treats `2.0` as int.
- **Be careful with `float`**: it is valid only if both the variable and all operands
  are syntactically "fractional" (a nonzero fractional part). `let x: float = 2;`,
  `fn f() -> float { return 5.0; }`, `1 + 2.5`, `[1.5, 2.5]`,
  `print(sqrt(16))` compile, but the WASM is invalid (see
  [limitations](../reference/errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm)).
- Annotations: `let x: int = 1;`, `fn f(a: int) -> int`, `[float]`,
  `fn(int) -> int`, `channel`, `Name<A, B>`.
- `unit`/`void` are synonyms for "no value".
- There are **no** union or tuple types in the syntax.
- Type checking is HM-like, but arithmetic/comparison operands and object fields are
  barely checked (see [types](./types.md)).

## Operators (in descending order of precedence)

```text
() [] .                  call, index, field/method
- ! <- await             unary (prefix)
* / %                   90
+ -                     80
<< >>                   70
&                       60
| ^                     50
< > <= >=               40
== !=                   30
&&                      20
||                      10
=  <-                   2 (right associativity)
-> =>                   annotation / lambda (not evaluated)
```

Specifics: `&&`/`||` short-circuit; `==` for strings is by content, for arrays by
pointer (engine #2) or deep (engine #1); `+` with a string is concatenation; `/` for int
is integer division; bitwise operations exist only in engine #2; `await` in engine #2 is
transparent; `<-` is host-only (channels). In detail —
[operators](./operators.md).

## Control flow

```latent
fn classify(n: int) -> string {
    if (n < 0) {
        return "negative";
    } else if (n == 0) {
        return "zero";
    } else {
        return "positive";
    }
}

fn main() -> int {
    let sum = 0;
    for (let i = 0; i < 5; i = i + 1) {
        sum = sum + i;
    }
    while (sum > 10) {
        sum = sum - 1;
    }
    for (let x in [1, 2, 3]) {
        sum = sum + x;
    }
    return sum;
}
```

- Conditions are **always** in `(` `)`.
- Two forms of `for`: C style and `for (let x in array)`; `for-in` over a string is
  **not typed** (an array is required) and does not work in #2.
- `break`/`continue` do not exist.
- `for (; cond; )` is allowed (empty parts).

## Functions and lambdas

```latent
fn add(a: int, b: int) -> int { return a + b; }

fn main() -> int {
    let double = fn(x) => x * 2;
    let block = fn(x) { return x + 1; };
    let id = fn(x) => x;
    print(add(double(2), block(3)));
    return id(0);
}
```

- Parameters are comma-separated with optional annotations; the return is `-> T`.
- Functions are hoisted: a call before the declaration works.
- Lambdas: `fn(x) => expr` (an expression) or `fn(x) { ... }` (a block); they close over
  values; in #2 they are implemented via `call_indirect`.
- Recursion is supported; a function without an annotation may be called recursively.
- Composition/higher-order functions are ordinary values of type `fn(...) -> R`.

## Arrays and strings

```latent
fn main() -> int {
    let a = [1, 2, 3];
    a.push(4);
    let last = a.pop();
    print(len(a));        // 3
    print(a.length);      // 3
    print("hello".length); // 5 (bytes)
    print("hello"[0]);    // 104 (the byte 'h')
    return last;
}
```

- `len(x)`, `arr.push(v)`, `arr.pop()`, `.length`/`.length()`.
- Indexing has no bounds checks; `s[i]` is a byte.
- `push`/`pop`/indexing mutate the array.
- There is no functional `pop`; the functional `push(arr, v)` does exist.
- Strings are immutable; `+` creates a new string.

## Classes

```latent
class Counter {
    n: int;

    fn init() { this.n = 0; }

    fn inc() -> int {
        this.n = this.n + 1;
        return this.n;
    }
}

fn main() -> int {
    let c = new Counter();
    c.inc();
    return c.inc();
}
```

- Fields: `name: type;`, methods: `fn name(...)`, an implicit `this`.
- The constructor is the `init` method; fields are initialized to zeros (not `null`).
- A method is called on a variable with a known class (`this`, a class parameter, a
  local from `new Class`) — otherwise codegen #2 will not find the method.
- There is no inheritance.

## Enums and match

```latent
enum Shape {
    Circle,
    Rect,
}

fn describe(s) -> int {
    return match s {
        case Circle: 1,
        case Rect: 2,
        default: 0,
    };
}

fn main() -> int {
    return describe(Circle);
}
```

- Variants: `Name` or `Name(T, ...)`; the built-in `Ok/Err/Some/None`.
- `match` is an expression; `case` is optional; `default`/`_` is a wildcard.
- Patterns: literals, `_`, a binding identifier, a variant constructor.
- If no arm matches, engine #2 leaves `0` on the stack while engine #1 throws an error.

## Tests and contracts

```latent
test "arithmetic" {
    assert(1 + 1 == 2);
    assert_eq(2 * 3, 6);
}

fn main() -> int {
    return 0;
}
```

- `test "name" { ... }` is executed by engine #1 after `main`; the result is not shown
  in the IDE UI (it is available through the interpreter API).
- `assert(cond)` / `assert_eq(a, b)` compile into a trap on failure in engine #2; the
  second message argument is ignored; `assert_eq` compares numbers as i32, strings
  by content, and arrays by pointers.
- `@forall("...")`, `snapshot(...)`, `ai_contract(...)`, `enforce_contract(...)` are
  host-only for engine #1; in #2 they are a compile error.
- The `@...` decorators over `fn`/`class`: the target is **not registered** in the
  function/class table — you cannot call the decorated function or create the class
  (`Unknown function`). Over statements a decorator is transparent.

## Concurrency (host-only in #2)

```text
channel<T>() / channel()   a CSP channel (engine #1 only)
spawn { ... } / spawn f()  a goroutine (in #2 — sequential)
ch <- v / <-ch             send/recv (in #2 — a compile error)
select { case v <- ch: {...} default: {...} }   (in #2 — the body of the first arm)
yield;                     yield to the scheduler (in #2 — a no-op)
async fn / await           Promise; in #2 await is transparent
```

- Engine #1: a cooperative scheduler, channels built on arrays, `recv` actively yields
  to the scheduler; deadlocks are possible (and are diagnosed).
- Engine #2: there are no channels at all — compilation fails with a clear error.

## AI primitives (host-only in #2)

```text
ai_infer(model, prompt) -> string       # #1: mock/gateway; enabled only by "Run with AI"
ai_embed(text) -> [float]               # an 8-dimensional mock by default
ai_stream(model, prompt) -> handle      # a stream of tokens
stream_next(handle) -> string|null      # the next token or null
ai_generate!("prompt")                  # parsed by #2, but codegen -> a host error
tensor/data, semantic, matmul, cosine_similarity, dot, magnitude, zeros, ones
snapshot/ai_contract/enforce_contract
```

- In engine #2 — the error "requires host runtime" (except `ai_generate!`, which is
  parsed/typed but still a codegen error).
- `ai.load/ai.infer/ai.embed/ai.agent` are not implemented in either engine (the parser
  never creates such nodes; see [AI runtime](../specs/ai-runtime.md)).

## Errors and diagnostics

- There are no error codes; the format is `... на строке L:C` ("... at line L:C").
- Lexer: `Неожиданный символ` (unexpected character), `Незавершённая строка`
  (unterminated string), `Неверная escape-последовательность` (invalid escape
  sequence), `Неверный формат числа` (invalid number format),
  `Незавершённый блочный комментарий` (unterminated block comment).
- Parser: `Ошибка парсинга на строке L:C: ожидалось '<...>', найдено <Токен>`
  (parse error: expected X, found Y), `Неожиданный конец файла...`
  (unexpected end of file...).
- Type checker: `Неопределённая переменная` (undefined variable), `Несовпадение типов`
  (type mismatch), `Несовпадение арности` (arity mismatch), `Бесконечный тип` (infinite
  type), `Не функция` (not a function).
- Codegen: `Unknown function`, `Builtin '...' не поддерживается движком №2
  (требует host-рантайма)` (builtin not supported by engine #2, requires a host
  runtime), `Метод '...' ...`, `Unknown field/class`,
  `Undefined variable`.
- The full catalog is in [diagnostics](./errors.md).

## Compiling and running

```bash
latentc compile app.lat app.wasm     # CLI
latentc check app.lat                # a full pass without writing

node run.mjs app.wasm                # host: env.print + memory + main
```

A minimal host is in the [CLI](./cli.md); the module ABI is in the
[WASM ABI](./wasm-abi.md); the compiler itself as WASM is described there too
(the C-ABI `latent_alloc/compile/free/version`).

## Engines: a quick table

| Feature | #2 (Rust→WASM) | #1 (JS) |
|---|---|---|
| `let`/`if`/`while`/`for`/`fn`/recursion | ✅ | ✅ |
| arrays, `push/pop/length`, `len` | ✅ | ✅ |
| strings, `+`, `==`, `s[i]`, `len` | ✅ | ✅ |
| classes/`new`/`this`/methods | ✅ (with limitations) | ✅ |
| enum/`match` | ✅ (except float fields) | ❌ enum is not supported |
| lambdas/closures | ✅ | ✅ |
| `async`/`await` | ✅ (await is a passthrough) | ✅ |
| `channel`/`spawn` channels/`select` waiting/`yield` | ❌ host | ✅ |
| AI/tensors/contracts/snapshot | ❌ host | ✅ (mock/gateway) |
| bitwise operators | ✅ | ❌ (a lexical error) |
| `str/int/float/sqrt` | ✅ | ❌ (no such builtins) |
| `enum` | ✅ | ❌ |

## Where to go next

- [Lexical structure](./lexical.md) · [Grammar](./grammar.md) · [Types](./types.md) ·
  [Operators](./operators.md) · [Builtins](./builtins.md) · [Errors](./errors.md)
- [Web IDE engines](../specs/engines.md) · [AI runtime](../specs/ai-runtime.md) ·
  [Codegen](../specs/internals-codegen.md) · [Bytecode](../specs/bytecode.md)
- [Examples](../examples/index.md) · [Web IDE](../tooling/web-ide.md) ·
  [MCP](../tooling/mcp.md)
