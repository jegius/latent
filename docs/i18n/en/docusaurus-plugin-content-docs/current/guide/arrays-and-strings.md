---
title: Arrays and Strings
sidebar_label: Arrays and Strings
sidebar_position: 7
description: Representation of arrays and strings in memory, indexing, methods, builtins, limitations, and engine differences.
---

# Arrays and Strings

## Arrays

Literal: `[1, 2, 3]`, empty — `[]`. In linear memory an array is a block
`[length u32][element0][element1]...` with 4-byte elements.

```latent
fn main() -> int {
    let primes = [2, 3, 5, 7, 11];
    print("p[0]:", primes[0]);
    print("length:", primes.length);
    print("len():", len(primes));

    primes[0] = 13;             // assignment to an element
    print("p[0]:", primes[0]);

    let stack = [1, 2, 3];
    let top = stack.pop();      // 3
    print("popped:", top);
    print("length now:", stack.length);

    let matrix = [[1, 2], [3, 4], [5, 6]];
    print("m[1][0]:", matrix[1][0]);
    return primes[0];
}
```

- indexing is `arr[i]`, the index expression is coerced to a number;
- there is **no** bounds checking: an out-of-range access reads/writes foreign
  memory;
- `.length` and `arr.length()` are the same thing (`i32.load` of the header);
- `.push(x)` appends an element and returns the array; `push(arr, x)` does the same;
- `.pop()` decrements the length and returns the last element; on an empty array the
  behavior is undefined (it reads `arr[-1]`);
- nested arrays are supported.

## Building an array

```latent
fn main() -> int {
    let squares = [];
    for (let i = 1; i <= 10; i = i + 1) {
        squares.push(i * i);
    }
    let total = 0;
    for (let s in squares) {
        total = total + s;
    }
    print("sum of squares:", total);
    return total;
}
```

:::caution Bump allocator and `push` (engine #2)

Allocation is a bump allocator with no `free` and no separate "capacity": `push`
writes the element right after the current length, even if the block was allocated
with a smaller size. This is safe as long as there are no other allocations
between the `push` and the read of the array (creating `new` objects, other arrays,
string concatenation). Recommendation: build an array and read it right away; for
arrays of objects/enums, create them with a literal:

```latent
enum Tx { Deposit(int), Noop }

fn main() -> int {
    // the literal pre-allocates slots for all the elements
    let txs: [Tx] = [Deposit(10), Noop];
    let total = 0;
    for (let tx in txs) {
        total = total + match tx {
            case Noop(): 0,
            case Deposit(n): n,
        };
    }
    return total;
}
```

:::

## Strings

In memory a string is `[length u32][UTF-8 bytes]`; the value of a string is a
pointer to the length. Strings are immutable: `s + x` creates a new string.

```latent
fn main() -> int {
    let greeting = "Hello, " + "Latent" + "!";
    print(greeting);
    print("bytes:", greeting.length);
    print("first byte:", greeting[0]);

    let version = "v" + 1 + "." + 2;
    print(version);

    let text = "abc";
    if (text == "abc") {
        print("equal by content");
    }
    return greeting.length;
}
```

- `+` with a string on either side is concatenation; numbers and bools are
  converted to text (`"v" + 1` → `"v1"`);
- `==`/`!=` and `<`/`>`/`<=`/`>=` compare the **content** of strings
  (`STR_EQ`/`STR_CMP`), not pointers;
- `.length` is the length in **UTF-8 bytes** (engine #2), `s[i]` is a **byte**;
- escapes: `\n`, `\t`, `\\`, `\"`; there are no others;
- there are no multiline/raw strings and no interpolation.

```latent
fn main() -> int {
    let ascii = "latent";     // 6 bytes
    let cyrillic = "латент";  // 12 bytes in UTF-8
    print(ascii.length);
    print(cyrillic.length);
    return ascii.length;
}
```

## Built-in functions and methods

| Form | Meaning | Notes (engine #2) |
|---|---|---|
| `len(x)` | length of an array/string | the type is not checked |
| `push(arr, v)` | append an element | returns the array |
| `arr.push(v)` | the same | returns the array |
| `arr.pop()` | remove the last element | undefined on an empty array |
| `arr.length` / `arr.length()` | length | `i32.load` of the header |
| `str(x)` | to a string | a float prints with 6 digits |
| `int(x)` | to int | a string is parsed, a float is truncated |
| `float(x)` | to float | a string → its integer part |
| `sqrt(x)` | square root | float context only |
| `x.to_str()` / `x.toString()` | to a string | |
| `x.to_int()` / `x.toInt()` | to int | |

```latent
fn main() -> int {
    let number = int("42");
    let truncated = int(3.9);
    let as_text = str(123);
    let from_text = float("3");
    print(number + truncated);
    print(as_text);
    print(from_text);
    return number;
}
```

What does **not** exist: `abs`, `min`, `max`, `floor`, `ceil`, `round`, `pow`,
`random`, `range`, `map`/`filter`/`reduce`, `split`, `substring`, `contains`,
`pop(arr)` as a function, `arr.len()`. All of these have to be written by hand.

## Engine #2 limitations

- `float` arrays (`[1.5, 2.5]`) are invalid WASM: elements are written with
  `i32.store`.
- `a + b` on arrays is **not** concatenation: it compiles as `i32.add` of the
  pointers. There is no array concatenation in engine #2 (there is in engine #1).
- `print(array)` prints the pointer (a number), not the content.
- `==` on arrays compares pointers; `assert_eq` compares strings by content and
  arrays by pointers.
- There is no bounds checking; `pop` on an empty array corrupts memory.
- `put/push` on a string compiles and corrupts the string.

## Engine #1 differences

- a string's `.length` is in UTF-16 code units (`"привет"` → 6), `s[i]` is a
  character;
- arrays are compared structurally; `print([1,2])` → `[1, 2]`;
- `a + b` on arrays is concatenation;
- `arr.push` and loops over strings work.

Next: [Classes](./classes.md).
