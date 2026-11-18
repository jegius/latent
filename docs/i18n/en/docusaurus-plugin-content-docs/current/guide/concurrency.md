---
title: Concurrency
sidebar_label: Concurrency
sidebar_position: 12
description: Channels, goroutines, select, and yield in engine #1 and their surrogates in engine #2.
---

# Concurrency

:::caution Engine #1 only

Full-fledged concurrency is **engine #1** (the JS interpreter, playground).
Engine #2 (Rust → WASM) has no host runtime: `channel` and `<-` produce an error,
while `spawn`/`select`/`yield` compile into surrogates. All the examples below
**do not compile with engine #2** (they are tagged with the marker).

:::

## Channels

```latent
// Does not compile with engine #2: channels require a host runtime.
fn worker(ch, n) {
    let i = 1;
    while (i <= n) {
        ch.send(i * i);
        i = i + 1;
    }
}

fn main() -> int {
    let ch = channel();
    spawn worker(ch, 3);

    let total = 0;
    for (let i = 0; i < 3; i = i + 1) {
        total = total + ch.recv();
    }
    print("total:", total);
    return total;
}
```

- `channel()` creates an unbuffered channel; `channel<T>()` creates one with a generic
  type (in engine #1 the type is not required);
- `ch.send(v)` and `ch.recv()` are methods; `recv()` blocks the goroutine until a
  value is available;
- alternative operator syntax: `ch <- v` (send) and `<-ch` (receive):

```latent
// Does not compile with engine #2: channel operators require a host runtime.
fn producer(ch, n) {
    let i = 0;
    while (i < n) {
        ch <- i * 10;
        i = i + 1;
    }
}

fn main() -> int {
    let ch = channel();
    spawn producer(ch, 3);
    let first = <-ch;
    print("first:", first);
    return first;
}
```

## Goroutines: `spawn`

```latent
// Does not compile with engine #2: channels require a host runtime.
fn worker(ch, n) {
    ch.send(n);
}

fn main() -> int {
    let ch = channel();

    spawn worker(ch, 1);      // a function call as a goroutine
    spawn {                   // an anonymous goroutine
        ch.send(2);
    }

    let a = ch.recv();
    let b = ch.recv();
    return a + b;
}
```

- `spawn f(args);` — start a call in a separate goroutine;
- `spawn { ... }` — an anonymous block;
- the semicolon after `spawn` is optional;
- in engine #2 a `return` inside a `spawn` block returns from the enclosing function
  (spawn is compiled inline).

## `select`

```latent
// Does not compile with engine #2: channels require a host runtime.
fn main() -> int {
    let ch = channel();
    spawn {
        ch.send(42);
    }

    select {
        case v <- ch: {
            print("got:", v);
        }
        default: {
            print("nothing ready");
        }
    }
    return 0;
}
```

- `select` waits for the first ready channel; `default` runs if nothing is ready
  immediately;
- a branch body must be a `{ ... }` block;
- `case` may be omitted;
- `select` can also be an expression: `let v = select { case x <- ch: x };`.

## `yield`

```latent
// Does not compile with engine #2: channels require a host runtime.
fn producer(ch, n) {
    let i = 0;
    while (i < n) {
        ch.send(i);
        yield; // yield to the scheduler
        i = i + 1;
    }
}

fn main() -> int {
    let ch = channel();
    spawn producer(ch, 3);
    return ch.recv();
}
```

`yield` is a cooperative concession to the scheduler; there is no separate
`sleep`/`delay` in the language.

## Engine #1 semantics

- the scheduler is cooperative, with a task queue (`stepScheduler`);
- `recv()` blocks the current goroutine and the scheduler switches to others;
- after `main` returns, the interpreter waits for the remaining goroutines;
- if tasks are left after the queue is drained — the error
  `Deadlock: N goroutine(s) still pending...`;
- `select` with no ready channels and no `default` waits while yielding to the
  scheduler; when there are no other tasks — `Deadlock: select with no ready channel...`.

## Engine #2 surrogates

```latent
fn worker(x: int) -> int {
    print("worker", x);
    return x * 2;
}

fn main() -> int {
    spawn worker(1);     // just a call, executed immediately
    spawn {
        print("inline");
    }
    yield;               // no-op
    return 0;
}
```

| Construct | Engine #2 |
|---|---|
| `spawn { ... }`, `spawn f()` | the bodies run sequentially in the current function |
| `yield` | no-op |
| `select` (statement) | channel expressions are not evaluated; the body of the first branch runs (or `default` if there are no branches) |
| `select` (expression) | the first branch, the variable = 0 |
| `channel()`, `channel<T>()` | error `Builtin 'channel' не поддерживается...` |
| `ch.send`, `ch.recv` | error `Метод 'send'/'recv' не поддерживается...` |
| `ch <- v`, `<-ch` | error "requires the host runtime of engine #1" |

## Engine #2 limitations

- Channels and `select` blocking do not exist as a runtime.
- `spawn` does not create goroutines: the code runs in the current frame (with
  shared local variables).
- `yield` does nothing.
- For real concurrency use engine #1 (playground / interpreter) or an external host.

Next: [AI primitives](./ai-features.md).
