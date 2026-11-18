---
title: Control Flow
sidebar_label: Control Flow
sidebar_position: 5
description: if/else, while, for-in, C-style for, spawn/select/yield, and their actual semantics.
---

# Control Flow

## `if` / `else if` / `else`

```latent
fn sign(n: int) -> string {
    if (n > 0) {
        return "positive";
    } else if (n < 0) {
        return "negative";
    } else {
        return "zero";
    }
}

fn main() -> int {
    print(sign(7));
    print(sign(-3));
    print(sign(0));
    return 0;
}
```

- parentheses around the condition are mandatory, the body is a `{ ... }` block;
- **the condition must be `bool`** (engine #2): `if (42)` is the error
  `Несовпадение типов … ожидалось 'float', найдено 'bool'`;
- `else if` is desugared into a nested `if`;
- `if` is a **statement**, not an expression: no value is returned from the branches.

```latent
fn main() -> int {
    let x = 1;
    if (x == 0) {
        print("zero");
    } else if (x == 1) {
        print("one");
    } else {
        print("many");
    }
    return 0;
}
```

## `while`

```latent
fn collatz_steps(start: int) -> int {
    let n = start;
    let steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    return steps;
}

fn main() -> int {
    print("collatz(27):", collatz_steps(27));
    return 0;
}
```

- the condition is `bool` (engine #2);
- there is **no** `break`/`continue`: the only exits are the condition or `return`.

## C-style `for`

```text
for (init; cond; step) { ... }
```

```latent
fn main() -> int {
    let sum = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        sum = sum + i;
    }
    print("sum:", sum);
    return sum;
}
```

- `init` is a `let`, an assignment expression, or empty;
- `cond` and `step` may be omitted (`for (;;)`) — then the loop is infinite until
  `return`;
- the type checker does **not** verify that `cond` is `bool`: `for (;; 1; )`
  compiles and may loop forever.

## `for-in` over an array

```latent
fn main() -> int {
    let values = [3, 1, 4, 1, 5];
    let max = values[0];
    for (let v in values) {
        if (v > max) {
            max = v;
        }
    }
    print("max:", max);
    return max;
}
```

- `let` in the header is mandatory: `for (x in arr)` is an error;
- an element type annotation is parsed and ignored;
- the iterable must be an **array**: a string/object is a type error
  (`for (let c in "abc")` does not work in engine #2, although it does work in
  engine #1);
- the index is not available inside the loop — use the C style.

## `spawn`

```latent
fn worker(x: int) {
    print("worker:", x);
}

fn main() -> int {
    spawn worker(7);      // engine #2: an ordinary call, executed immediately
    spawn {
        print("inline");
    }
    return 0;
}
```

In engine #1 this is a goroutine (the scheduler); in engine #2 it is
**sequential execution** inside the current function (see
[concurrency](./concurrency.md)).

## `select`

```latent
// Does not compile with engine #2: a channel requires a host runtime.
fn main() -> int {
    let ch = channel();
    select {
        case v <- ch: {
            print("received:", v);
        }
        default: {
            print("nothing ready");
        }
    }
    return 0;
}
```

Engine #1: a blocking choice among the ready channels. Engine #2: channel
expressions are not evaluated and the body of the **first** branch runs (or
`default` if there are no branches). A branch body must be a block.

## `yield`

```latent
fn main() -> int {
    yield; // engine #2: no-op; engine #1: yield to the scheduler
    return 0;
}
```

## Engine #2 limitations

- `if`/`while` conditions must be `bool`; the C-style `for` is not checked.
- `for-in` supports arrays only.
- `break`/`continue` do not exist in the language.
- `if` is not an expression.
- `spawn` is sequential code, `yield` is a no-op, `select` takes the first branch;
  `channel` and `<-` produce a host runtime error.

Next: [Functions](./functions.md).
