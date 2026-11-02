---
title: "Basics: variables, operators, control flow, functions, collections"
sidebar_label: Basics
sidebar_position: 2
description: "Walkthroughs of the basic Latent examples from web-ide/examples: type annotations, operators and precedence, control flow, functions and recursion, builtins/methods, arrays and strings — with the output shown in the web IDE."
---

# Basics

All snippets come from `web-ide/examples/`; the output is what **engine #1**
prints on Run (verified). The differences of engine #2 are noted separately.

## `variables_types.lat` — variables and annotations

`web-ide/examples/variables_types.lat`:

```latent
// Variables and type annotations: let name: type = value;

fn main() -> int {
    // Basic literals with type annotations
    let i: int = 42;
    let f: float = 3.14;
    let b: bool = true;
    let s: string = "latent";
    let n = null;
    let arr: [int] = [1, 2, 3];

    print("int:   ", i);
    print("float: ", f);
    print("bool:  ", b);
    print("string:", s);
    print("null:  ", n);
    print("array: ", arr);

    // Assignment changes the value of the variable
    let counter = 0;
    counter = counter + 1;
    counter = counter + 1;
    print("counter:", counter);

    return counter;
}
```

Output in the web IDE (engine #1):

```text
int:    42
float:  3.14
bool:   true
string: latent
null:   null
array:  [1, 2, 3]
counter: 2
```

Analysis:

- the annotations are optional; `let n = null;` is typed as `null`;
- `let arr: [int]` — the array type; homogeneity is not checked in engine #1, nor
  in #2 (the elements are stored as 4 bytes each);
- `counter = counter + 1` — an assignment-expression (in #2), in #1 it is a
  statement.

Engine #2: it compiles to valid WASM; there `print` prints **each argument on its
own line**, `true` → `1`, `null` → `0`, and an array becomes a number-pointer (see
[engines](../specs/engines.md)).

## `operators.lat` — operators and precedence

`web-ide/examples/operators.lat`:

```latent
// Every operator of the language: arithmetic, comparison, logic, precedence

fn main() -> int {
    let a = 17;
    let b = 5;

    // Arithmetic
    print("a + b =", a + b);
    print("a - b =", a - b);
    print("a * b =", a * b);
    print("a / b =", a / b);
    print("a % b =", a % b);

    // Comparisons
    print("a == b:", a == b, " a != b:", a != b);
    print("a > b:", a > b, " a < b:", a < b);
    print("a >= b:", a >= b, " a <= b:", a <= b);

    // Precedence: multiplication binds tighter than addition, parentheses change the order
    print("2 + 3 * 4 =", 2 + 3 * 4);
    print("(2 + 3) * 4 =", (2 + 3) * 4);

    // Logical operators and unary minus
    let t = true;
    let g = false;
    print("t && g:", t && g, " t || g:", t || g, " !t:", !t);
    print("unary -a =", -a);

    return 0;
}
```

Output (engine #1):

```text
a + b = 22
a - b = 12
a * b = 85
a / b = 3.4
a % b = 2
a == b: false  a != b: true
a > b: true  a < b: false
a >= b: true  a <= b: false
2 + 3 * 4 = 14
(2 + 3) * 4 = 20
t && g: false  t || g: true  !t: false
unary -a = -17
```

The key divergence: `a / b` → `3.4` in engine #1 (JS division) and `3` in engine
#2 (`i32.div_s`). Precedence follows the
[operator reference](../reference/operators.md): `*` above `+`, `&&` below `==`,
`-a` (unary) binds tighter than multiplication.

## `control_flow.lat` — branches and loops

`web-ide/examples/control_flow.lat`:

```latent
// Control flow: if/else if/else, while, for, logical operators

fn classify(n: int) -> string {
    if (n < 0) {
        return "negative";
    } else if (n == 0) {
        return "zero";
    } else if (n < 10) {
        return "small positive";
    } else {
        return "large positive";
    }
}

fn fizzbuzz(n: int) {
    for (let i = 1; i <= n; i = i + 1) {
        if (i % 15 == 0) {
            print("FizzBuzz");
        } else if (i % 3 == 0) {
            print("Fizz");
        } else if (i % 5 == 0) {
            print("Buzz");
        } else {
            print(i);
        }
    }
}

fn main() -> int {
    print(classify(-5));
    print(classify(0));
    print(classify(7));
    print(classify(42));

    let x = 7;
    if (x > 0 && x < 10) {
        print(x, "is a single-digit positive number");
    }
    if (x < 0 || x > 5) {
        print(x, "is either negative or greater than 5");
    }
    if (!(x == 0)) {
        print(x, "is not zero");
    }

    let n = 27;
    let steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    print("collatz(27) reaches 1 in", steps, "steps");

    fizzbuzz(15);

    return steps;
}
```

Output (fragment): `negative`, `zero`, `small positive`, `large positive`,
`7 is a single-digit positive number`, `7 is either negative or greater than 5`,
`7 is not zero`, `collatz(27) reaches 1 in 111 steps`, then the FizzBuzz sequence
up to 15.

Analysis:

- conditions must be in parentheses (`if (x)`), `else if` works;
- `for (let i = 1; i <= n; i = i + 1)` is C style; there is no `break`/`continue`;
- `&&`/`||` short-circuit, `!(...)` is logical NOT.

## `functions.lat` — functions and recursion

`web-ide/examples/functions.lat`:

```latent
// Functions: parameters, return types, calls, composition, and recursion

fn add(a: int, b: int) -> int {
    return a + b;
}

fn square(x: int) -> int {
    return x * x;
}

// Composition of calls
fn sum_squares(a: int, b: int) -> int {
    return add(square(a), square(b));
}

// Recursion: Euclid's algorithm
fn gcd(a: int, b: int) -> int {
    if (b == 0) {
        return a;
    }
    return gcd(b, a % b);
}

fn main() -> int {
    print("add(2, 3) =", add(2, 3));
    print("square(7) =", square(7));
    print("sum_squares(3, 4) =", sum_squares(3, 4));
    print("gcd(48, 36) =", gcd(48, 36));
    return sum_squares(3, 4);
}
```

Output: `add(2, 3) = 5`, `square(7) = 49`, `sum_squares(3, 4) = 25`,
`gcd(48, 36) = 12`; `main` returns `25`.

Analysis: functions are hoisted (a call before the declaration is possible) and
recursion is supported; `gcd` uses both a call and `%` in a single expression.

## `builtins_methods.lat` — builtins and methods

`web-ide/examples/builtins_methods.lat`:

```latent
// Builtins and methods: len(), push(), arr.pop(), str.length
// The language's built-in functions in one place.

fn sum(arr: [int]) -> int {
    let total = 0;
    for (let i = 0; i < len(arr); i = i + 1) {
        total = total + arr[i];
    }
    return total;
}

fn main() -> int {
    // len() — the length of an array and of a string
    let nums = [4, 8, 15, 16, 23, 42];
    print("len(nums) =", len(nums));

    let word = "latent";
    print("len(\"latent\") =", len(word));

    // push() as a built-in function (as opposed to the arr.push method)
    let acc = [];
    push(acc, 1);
    push(acc, 2);
    push(acc, 3);
    print("after push:", acc);

    // Array methods: push / pop / length
    let stack = [10, 20, 30];
    stack.push(40);
    print("stack.push(40) ->", stack);
    let top = stack.pop();
    print("stack.pop() ->", top, "stack:", stack);
    print("stack.length =", stack.length);

    // String method: length
    print("\"hello\".length =", "hello".length);

    // Combining the built-in functions
    print("sum(nums) =", sum(nums));
    print("average =", sum(nums) / len(nums));

    return sum(nums);
}
```

Output: `len(nums) = 6`, `len("latent") = 6`, `after push: [1, 2, 3]`,
`stack.push(40) -> [10, 20, 30, 40]`, `stack.pop() -> 40 stack: [10, 20, 30]`,
`stack.length = 3`, `"hello".length = 5`, `sum(nums) = 108`, `average = 18`.

Important:

- the `len` of a string is the length in **bytes** (for Cyrillic that is more than
  the number of characters);
- `average = 18` — because JS division gives `108/6 = 18`; in engine #2
  `108 / 6` is also `18`, but `17 / 5` is already `3`;
- `push`/`pop` mutate the array; the functional `push(arr, v)` returns an array
  (the type checker considers it `unit`).

## `arrays.lat` — arrays

`web-ide/examples/arrays.lat` (abridged; the complete file is in the repository):

```latent
fn main() -> int {
    let primes = [2, 3, 5, 7, 11, 13];
    print("primes:", primes);
    print("primes[0] =", primes[0]);
    print("primes.length =", primes.length);

    primes[0] = 17;
    print("after primes[0] = 17:", primes);

    let stack = [];
    stack.push(1);
    stack.push(2);
    stack.push(3);
    let top = stack.pop();

    let a = [1, 2, 3];
    let b = [4, 5, 6];
    let c = a + b;

    let matrix = [[1, 2], [3, 4], [5, 6]];
    print("matrix[1][0] =", matrix[1][0]);

    let squares = [];
    for (let i = 1; i <= 10; i = i + 1) {
        squares.push(i * i);
    }
    print("squares 1..10:", squares);

    let sum = 0;
    let i = 0;
    while (i < squares.length) {
        sum = sum + squares[i];
        i = i + 1;
    }
    return sum;
}
```

Output (engine #1): `primes: [2, 3, 5, 7, 11, 13]`, `primes[0] = 2`,
`primes.length = 6`, `after primes[0] = 17: [17, 3, 5, 7, 11, 13]`,
`stack after pushes: [1, 2, 3]`, `popped: 3 stack: [1, 2]`,
`a + b = [1, 2, 3, 4, 5, 6]`, `matrix[1][0] = 3`,
`squares 1..10: [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]`,
`sum of squares: 385`.

:::warning
`a + b` for arrays is **engine #1 only** (concatenation). Engine #2 compiles `+`
as `i32.add` of the pointers — the semantics are wrong (it compiles, but the
result is meaningless). Do not use array concatenation in code meant for #2.
:::

## `strings.lat` — strings

`web-ide/examples/strings.lat`:

```latent
// Strings: literals, concatenation, length, comparison

fn greet(name: string) -> string {
    return "Hello, " + name + "!";
}

fn main() -> int {
    let greeting = greet("Latent");
    print(greeting);

    // String concatenation with numbers
    let version = "v" + 1 + "." + 0;
    print("version:", version);

    // String length
    let text = "functional vibes";
    print("length of", "\"" + text + "\" =", text.length);

    // String comparison
    let a = "apple";
    let b = "banana";
    if (a == b) {
        print("strings are equal");
    } else {
        print(a, "!=", b);
    }

    // Building strings in a loop
    let stars = "";
    for (let i = 0; i < 5; i = i + 1) {
        stars = stars + "*";
    }
    print("stars:", stars);

    // Escape sequences
    print("line1\nline2\t(tabbed)");

    return 0;
}
```

Output: `Hello, Latent!`, `version: v1.0`,
`length of "functional vibes" = 16`, `apple != banana`, `stars: *****`,
`line1`/`line2	(tabbed)` (two lines because of `\n`).

Analysis: `+` concatenates a string with numbers; `==` in engine #1 compares the
contents (in #2 as well for strings, through the `str_eq` helper); `.length` is
bytes. The only escape sequences are `\n \t \\ \"`.

## Summary

- The basic constructs look familiar (C-like syntax), but the **semantics of
  numbers/strings/arrays depends on the engine**.
- Engine #1 "forgives" more (dynamic typing); engine #2 is stricter in the code
  but has float/void defects (see
  [limitations](../reference/errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm)).

Next: [algorithms](./algorithms.md) · [OOP](./oop.md) ·
[functional style](./functional.md).
