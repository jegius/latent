---
title: "Builtins and Methods"
description: "All Latent builtins with exact signatures, per-engine semantics, limitations, and examples: print, len, push, pop, str/int/float, sqrt, assert, assert_eq, memory, constructors; plus the host-only functions."
sidebar_position: 6
---

# Builtins and methods

Sources: `src/codegen/emit_call/{mod,direct,method,constructors,array}.rs`
(engine #2), `src/typechecker/infer/expr/{mod,call,effects}.rs`
(builtin types), `web-ide/compiler/interpreter-builtins.js` and
`web-ide/compiler/value-utils.js` (engine #1).

The "Engine" column: **#2** — Rust→WASM, **#1** — the JS interpreter, **both** —
works in both. Host-only features (AI, tensors, channels, contracts) are deliberately
rejected by engine #2 with a "requires host runtime" message (the exact texts are in
[diagnostics](./errors.md#codegen)).

## Quick table

| Function/method | Signature | Engine | Result |
|---|---|---|---|
| `print` | `print(value, ...)` | both | output to stdout/host; in #2 each argument is a separate line |
| `len` | `len(array) -> int`, `len(string) -> int` | both | the length from the `[len u32]` header |
| `push` | `push(array, value)` | both | appends an element; in #2 it leaves the array on the stack |
| `str` | `str(x) -> string` | #2 only | conversion to a string |
| `int` | `int(x) -> int` | #2 only | string → number, float → truncation |
| `float` | `float(x) -> float` | #2 only | int/string → float |
| `sqrt` | `sqrt(x) -> float` | #2 only | `f64.sqrt`; valid in an f64 context, invalid WASM when used as int |
| `assert` | `assert(cond)` | both | aborts execution when falsy |
| `assert_eq` | `assert_eq(a, b)` | both | in #2 — an `i32` comparison; a trap on mismatch |
| `alloc` | `alloc(size) -> ptr` | #2 | the runtime bump allocator |
| `load8` | `load8(addr) -> int` | #2 | an unsigned byte |
| `store8` | `store8(addr, value)` | #2 | writes the low byte |
| `load32` | `load32(addr) -> int` | #2 | a 32-bit word |
| `store32` | `store32(addr, value)` | #2 | writes a word |
| `memcopy` | `memcopy(dst, src, len)` | #2 | byte-wise copy |
| `channel` | `channel()` / `channel<T>()` | host | creates a channel (#1 only) |
| `Ok/Err/Some/None` | variant constructors | both | built-in enum variants |
| `new Class` | `new Class(args)` | both | creates an instance |
| `.push(x)` | `arr.push(x)` | both | array method |
| `.pop()` | `arr.pop() -> T` | both | array method |
| `.length` / `.length()` | `-> int` | both | an array or a string |
| `.to_str()` / `.toString()` | `-> string` | #2 only | conversion to a string |
| `.to_int()` / `.toInt()` | `-> int` | #2 only | conversion to int |
| `ai_infer` and others | see [AI runtime](../specs/ai-runtime.md) | host | #1 only |

## `print`

```text
print(value, ...) -> unit
```

- **Engine #2**: each argument is compiled separately and passed to the
  `env.print(i32)` import — it is a **separate call per argument**, so
  `print("x =", x)` prints two lines (the string `x =` and the number), not one.
  Non-string arguments are converted to a string by their static type: `float`
  through `f64_to_str` (6 digits after the point), `int`/`bool`/`null` through
  `i32_to_str`; arrays and closures are converted as pointer numbers.
- **Engine #1**: the arguments are formatted (`formatValue`) and joined with a space
  into a single line: `print("x =", 42)` → `x = 42`; `null` → `null`,
  `true` → `true`; arrays → `[1, 2, 3]`; tensors → `Tensor(shape=...,
  data=...)`.

```latent
fn main() -> int {
    print("value:", 42);
    return 0;
}
```

## `len`

```text
len(array) -> int
len(string) -> int
```

It reads the first word of the data (`i32.load`): for an array, the number of elements;
for a string, the length in bytes. In engine #2 a `len()` call without arguments
compiles to a memory read at address 0 (usually yielding `0`); in engine #1 it crashes
(`Cannot read properties of undefined`).
The arity of builtins is not checked at all in #2: extra arguments are silently
ignored (`len`, `assert`, `str`, `int`, `float`, `sqrt`, `alloc`, …).

```latent
fn main() -> int {
    print(len([10, 20, 30]));   // 3
    print(len("latent"));       // 6 (UTF-8 bytes)
    return 0;
}
```

## `push` and `pop`

```text
push(array, value) -> array   // engine #2 leaves the array on the stack,
                              // the type checker considers the result unit
arr.push(value) -> array
arr.pop() -> T
```

`arr.push(x)` in engine #2 is `arr[len] = x; arr.len = len + 1;` — the array is
mutated and the pointer is left on the stack. `arr.pop()` decrements the length by 1
and returns the last element. **Bounds are not checked**: `pop()` on an empty array
reads `arr[-1]` (memory corruption), and `push` on a string compiles and writes into
the string.

```latent
fn main() -> int {
    let a = [1, 2];
    a.push(3);
    let last = a.pop();
    print(last);          // 3
    print(a.length);      // 2
    return last;
}
```

The functional form `push(a, v)` works like `a.push(v)`; in engine #2, with a single
argument it is the error `push expects (array, value)`. There is no `pop(a)` function —
only the method.

## Type conversion: `str`, `int`, `float`, `sqrt`

**Engine #2 only** — these names do not exist in engine #1
(«Undefined function 'str'»).

```text
str(x) -> string
int(x) -> int
float(x) -> float
sqrt(x) -> float
```

- `str(x)`: a string — as is; `float` → `__latent_f64_to_str` («1.500000»);
  everything else → `__latent_i32_to_str`. Without an argument — an empty string.
  `f64_to_str` computes the integer part via `i32.trunc_f64_s`, so
  `str(1e300)` (and in general `|x| ≥ 2^31`) traps at runtime.
- `int(x)`: a string is parsed as an ASCII number with an optional `-`
  (`__latent_str_to_i32`), a float — `i32.trunc_f64_s` (truncation toward zero), an
  int — as is.
- `float(x)`: a float — as is; a string is parsed into an int and then
  `f64.convert_i32_s` (the fractional part of the string is not parsed); an int —
  `f64.convert_i32_s`.
- `sqrt(x)`: converts the operand to f64 (if it is not already float) and applies
  `f64.sqrt`. It is valid in an f64 context: `fn f() -> float { return sqrt(16); }`
  and `let x: float = sqrt(16);` work. But the static type of the call is tracked as
  `Int`, so `print(sqrt(16))` and `int(sqrt(16))` produce **invalid WASM** (see
  below).

```latent
fn main() -> int {
    print(str(42));       // 42
    print(int("42"));     // 42
    print(int(3.9));      // 3
    return 0;
}
```

## `assert`, `assert_eq`

```text
assert(cond)                // engine #2: if cond == 0 -> unreachable (trap)
assert_eq(a, b)             // engine #2: i32.eq, on mismatch -> trap
assert(cond, msg?)          // engine #1: the message goes into the exception
assert_eq(a, b, msg?)       // engine #1: structural equality
```

- Engine #2: `assert` checks "non-zeroness" (`i32.eqz` + `if` + `unreachable`);
  `assert_eq` compares **raw i32 values**, and the second message argument is
  **ignored**. For numbers this is equality, for strings it is pointers (identical
  literals may coincide due to deduplication, but a concatenation result will not,
  which traps), and for arrays it is pointers.
- Engine #1: `assert` uses truthiness, `assert_eq` uses deep structural equality; on
  failure an exception is thrown — `assertion failed` / `assert_eq failed: a != b`
  (the message is included).

```latent
fn main() -> int {
    assert(1 + 1 == 2);
    assert_eq(2 * 3, 6);
    return 0;
}
```

## Linear memory primitives (engine #2 only)

```text
alloc(size) -> int
load8(addr) -> int
store8(addr, value)
load32(addr) -> int
store32(addr, value)
memcopy(dst, src, len)
```

These are unsafe operations without bounds checks; they were added for self-hosting
(the Latent-on-Latent compiler itself uses them to write WASM bytes — see
`selfhost/src/10_buffer.lat`). The sources are `src/codegen/emit_call/direct.rs`
(`compile_memory_builtin`). Details on the layout and the allocator are in the
[WASM ABI](./wasm-abi.md#memory-and-the-allocator).

```latent
fn main() -> int {
    let p = alloc(8);
    store8(p, 65);          // p[0] = 65 ('A')
    store32(p + 4, 12345);  // p[4..8] = 12345, little-endian
    print(load32(p + 4));   // 12345
    memcopy(p + 8, p, 4);   // a copy of 4 bytes
    print(load8(p + 8));    // 65
    return 0;
}
```

:::note
The memory builtins **are present in the shipped build** of `web-ide/compiler.wasm`
(465 435 bytes, built from the current `src/`): the example above compiles to valid
WASM and prints `12345`, then `65`. If you are using an older artifact (for example, a
copy from `editors/idea/src/main/resources/runner/`), `alloc` reports
«Неопределённая переменная 'alloc'» (undefined variable) — rebuild, see
[tooling/bootstrap](../tooling/bootstrap.md).
:::

## Constructors

- `Ok(v)`, `Err(e)`, `Some(v)`, `None` are built-in variants available without an
  enum declaration. Tags: `Ok`/`Some` = 0, `Err` = 1, `None` is 0-ary.
  The variant map is **global by name** (`enum_variants` in
  `src/codegen/module_builder/mod.rs`), so a user variant named `Some` overrides the
  built-in one.
- `new Class(args)`:
  - allocates `size` from the class layout on the heap (the bump allocator),
  - compiles the arguments,
  - if the class has an `init` method (or `new`), calls it with an implicit `this`,
  - returns a pointer to the instance.
  If there is no `init`, the arguments stay on the WASM stack and the result of `new`
  is undefined — **a class without `init` may produce an invalid module**. In engine
  #1, `new` without `init` simply creates an instance (fields are `null`).

```latent
class Point {
    x: int;
    y: int;

    fn init(x, y) {
        this.x = x;
        this.y = y;
    }

    fn norm2() -> int {
        return this.x * this.x + this.y * this.y;
    }
}

fn main() -> int {
    let p = new Point(3, 4);
    return p.norm2();
}
```

## Value methods

| Method | Engine #2 | Engine #1 |
|---|---|---|
| `arr.length`, `arr.length()` | an `i32.load` of the header | the same (a JS array) |
| `str.length`, `str.length()` | `i32.load` (UTF-8 bytes) | the length of a JS string (UTF-16) |
| `arr.push(x)` | ✅ | ✅ |
| `arr.pop()` | ✅ (no emptiness check) | ✅ |
| `str.len` | ❌ («Unknown class») | ✅ (`len` as a property) |
| `x.to_str()`, `x.toString()` | ✅, but the result is not marked as a string: `print` may print a pointer | ❌ «Unknown method 'to_str'» |
| `s.to_int()`, `s.toInt()` | ✅ | ❌ |
| `str.upper()`, `str.lower()` | ❌ | ✅ |
| `ch.send/recv/try_recv/len` | ❌ host-only | ✅ |
| `t.data/shape/rank/size/reshape` | ❌ host-only | ✅ (tensors) |

Class methods are called as `Class_method(obj, args)`; in engine #2, for the class to
be determined correctly the object must be a local variable with a known class (an
annotation, `new Class`, `this`, or a class parameter). A method call on a temporary
value (`new A(5).get()`) yields «Метод 'get' не поддерживается движком №2» (the method
is not supported by engine #2).

```latent
fn main() -> int {
    let s = "hello";
    print(s.length);        // 5
    print(s.length());      // 5
    print(s[1]);            // 101 — the byte 'e'
    return 0;
}
```

## Host-only builtins (engine #1 / AI gateway)

Engine #2 rejects them with a compile error. The full semantics are in the
[AI runtime](../specs/ai-runtime.md).

The error texts in the right-hand column are quoted **verbatim** as the compiler
produces them; the common suffix `не поддерживается движком №2 (требует host-рантайма)`
means "is not supported by engine #2 (requires a host runtime)".

| Name | Signature (following engine #1) | Engine #2 error text |
|---|---|---|
| `tensor` | `tensor(data) -> Tensor` | `Builtin 'tensor' не поддерживается движком №2 (требует host-рантайма)` |
| `semantic` | `semantic(text) -> Semantic` | the same with `'semantic'` |
| `matmul` | `matmul(a, b) -> Tensor` | `'matmul'` |
| `cosine_similarity` | `(a, b) -> float` | `'cosine_similarity'` |
| `dot` | `(a, b) -> float` | `'dot'` |
| `magnitude` | `(v) -> float` | `'magnitude'` |
| `zeros`, `ones` | `(n) -> Tensor` | `'zeros'` / `'ones'` |
| `snapshot` | `snapshot(name) -> bool` | `'snapshot'` |
| `ai_contract` | `ai_contract(name) -> Contract` | `'ai_contract'` |
| `enforce_contract` | `enforce_contract(c) -> bool` | `'enforce_contract'` |
| `ai_infer` | `ai_infer(model, prompt) -> string` | `'ai_infer'` |
| `ai_embed` | `ai_embed(text) -> [float]` | `'ai_embed'` |
| `ai_stream` | `ai_stream(model, prompt) -> int` | `'ai_stream'` |
| `stream_next` | `stream_next(handle) -> string\|null` | `'stream_next'` |
| `channel` | `channel()` / `channel<T>()` | `'channel'` |
| `ch.send/recv/...` | a method | `Метод 'send' не поддерживается движком №2 (требует host-рантайма)` |

Engine #1 additionally has helper builtins that #2 lacks:
`range(n)`, `unwrap(v)`, `unwrap_or(v, default)`, `is_ok(v)`, `is_err(v)`,
`is_some(v)`. They are not documented as part of the language — use them with care.

## What is missing from the builtins

`abs`, `min`, `max`, `floor`, `ceil`, `round`, `pow`, `random`, `time`, `sleep`,
`input`, `read_file`, `assert_ne`, `panic`, `exit`, `range`, `map`/`filter`/
`reduce`, `split`, `substring`, `contains`, `keys`/`values`, `to_string` —
do not exist (there are `str` and `.to_str()`). `range` exists only in engine #1 as a
helper builtin.

Important: **a builtin takes precedence over a user function with the same name** —
`fn len(a) -> int { return 99; }` will not override `len`:
`len([1,2,3])` yields `3`. Do not name your functions after builtins.

## Limitations and known defects

- `sqrt`: valid only in an **f64 context** (`fn f() -> float { return
  sqrt(16); }`, `let x: float = sqrt(16);`). Any use where the result is treated as
  `int` (`print(sqrt(16))`, `print(sqrt(16.0))`, `print(sqrt(2.25))`,
  `int(sqrt(16))`) produces **invalid WASM** — the static type of the `sqrt` call is
  not tracked.
- `print` in engine #2 prints `bool` as `1`/`0`, `null` as `0`, and arrays as pointer
  numbers. For readable output use the string conversions or print the elements one by
  one.
- `str`/`int`/`float`/`sqrt` do not exist in engine #1 — code using them will not run
  in the IDE by default (only through Engine #2, which does not execute the program).
- The functional `push` returns the array at the code level, but the type checker
  declares the result `unit` — do not rely on the return value in typed code.

## Related sections

- [AI runtime](../specs/ai-runtime.md) — the host functions in detail.
- [WASM ABI](./wasm-abi.md) — the representation of strings/arrays/classes.
- [Diagnostics](./errors.md) — the exact codegen error texts.
