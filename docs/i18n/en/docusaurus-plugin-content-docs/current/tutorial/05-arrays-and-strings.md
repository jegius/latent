---
title: "Chapter 5. Arrays and strings"
sidebar_label: "05. Arrays and strings"
sidebar_position: 6
description: Array literals, indexing, push/pop/length, len, for-in, strings and their byte-based nature.
---

# Chapter 5. Arrays and strings

## Arrays

```latent
fn main() -> int {
    let primes = [2, 3, 5, 7, 11];
    print("primes[0]:", primes[0]);
    print("length:", primes.length);

    primes[0] = 13;
    print("updated primes[0]:", primes[0]);

    let stack = [1, 2, 3];
    let top = stack.pop();
    print("popped:", top, "length:", stack.length);

    return primes[0];
}
```

- literal: `[1, 2, 3]`, an empty array is `[]`;
- indexing `arr[i]` (the index is a number; out-of-bounds access is not checked);
- `.length` — the length; `len(arr)` — the same thing;
- `.push(x)` appends an element, `.pop()` removes the last one and returns it;
- functional forms: `push(arr, x)` and `len(arr)`.

Nested arrays work: `[[1, 2], [3, 4]][1][0]` yields `3`.

## Building an array in a loop

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
    print("sum of squares 1..10:", total);
    return total;
}
```

`for (let s in squares)` walks the array elements in order. The index is not
available inside such a loop — use a C-style `for`.

:::caution Memory lifetime in engine #2

In the WASM engine, arrays live in linear memory allocated by a bump allocator:
`push` extends the array by writing elements past the end of the allocated block.
This is safe as long as there are no other allocations between the `push` and the
read of the array (creating objects with `new`, creating other arrays, or
concatenating strings). The reliable style: build the array and read it right
away, without creating objects in between. For details, see
[arrays-and-strings](../guide/arrays-and-strings.md).

:::

## Strings

```latent
fn main() -> int {
    let greeting = "Hello, " + "Latent" + "!";
    print(greeting);
    print("length:", greeting.length);
    print("first byte:", greeting[0]);

    let stars = "";
    for (let i = 0; i < 5; i = i + 1) {
        stars = stars + "*";
    }
    print(stars);

    return greeting.length;
}
```

- strings are added with `+`; numbers are converted to text during concatenation;
- `==` and `!=` compare strings **by content**;
- `.length` is the length in **UTF-8 bytes**, not in characters (this is engine #2
  semantics; in engine #1 strings are JS strings and `.length` counts UTF-16 code
  units);
- `s[i]` returns a **byte** (a number), not a character (in engine #1 it is a
  character).

A check of the byte-based nature:

```latent
fn main() -> int {
    let ascii = "latent";
    let cyrillic = "латент";
    print("ascii bytes:", ascii.length);
    print("cyrillic bytes:", cyrillic.length);
    return 0;
}
```

For ASCII the length matches the number of characters; for Cyrillic it does not
(each letter takes 2 bytes in UTF-8).

## Methods and built-in functions

```latent
fn main() -> int {
    let number = int("42");        // string → int
    let text = str(42);            // int → string
    let as_text = "value: " + 7;   // concatenation with a number
    print(number + 1);
    print(text);
    print(as_text);
    print("hello".length);
    return number;
}
```

| Function | Meaning |
|---|---|
| `len(x)` | the length of an array or string |
| `push(arr, x)` | the same as `arr.push(x)` |
| `str(x)` | convert to a string |
| `int(x)` | convert to `int` (a string is parsed, a float is truncated) |
| `float(x)` | convert to `float` |

## Exercise

Write a function `count_vowels(s)` that counts the English vowels in a string (use
byte indexing and compare bytes against the codes of `a`, `e`, `i`, `o`, `u` —
97, 101, 105, 111, 117).

```latent
fn is_vowel(code: int) -> bool {
    if (code == 97 || code == 101 || code == 105 || code == 111 || code == 117) {
        return true;
    }
    return false;
}

fn count_vowels(s: string) -> int {
    let count = 0;
    for (let i = 0; i < s.length; i = i + 1) {
        if (is_vowel(s[i])) {
            count = count + 1;
        }
    }
    return count;
}

fn main() -> int {
    print("vowels in 'latent':", count_vowels("latent"));
    return 0;
}
```

Next: [Classes](./06-classes.md).
