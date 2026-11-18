---
title: "Concurrency: channels, spawn, select, yield"
sidebar_label: Concurrency
sidebar_position: 4
description: "Walkthroughs of channels.lat, parallel_sum.lat, select_yield.lat: CSP channels, goroutines, the scheduler, select/yield; what this gives you in engine #1 and why engine #2 does not compile it."
---

# Concurrency

Latent's concurrency is implemented **only by the host runtime of engine #1**: a
cooperative goroutine scheduler, CSP channels, `select`, `yield`. Engine #2
(Rust→WASM) accepts the syntax but rejects channels with an error, and compiles
`spawn`/`select`/`yield` into a surrogate (see [engines](../specs/engines.md)).

:::warning
All blocks in this section **do not compile with engine #2** — they are host-only
examples for the web IDE (Run). The first line of each block is marked
accordingly.
:::

## `channels.lat` — producer/consumer and fan-in

`web-ide/examples/channels.lat`:

```latent
// Does not compile with engine #2: channels require the host runtime (engine #1)
// CSP-style concurrency: producer/consumer via channels

fn producer(ch: channel, count: int) {
    for (let i = 1; i <= count; i = i + 1) {
        print("producing", i);
        ch.send(i * i);
    }
}

fn consumer(ch: channel, count: int) {
    let received = 0;
    let sum = 0;
    while (received < count) {
        let v = ch.recv();
        print("consumed", v);
        sum = sum + v;
        received = received + 1;
    }
    print("consumer finished:", received, "items, sum =", sum);
}

fn main() -> int {
    let ch = channel();

    spawn producer(ch, 5);
    spawn consumer(ch, 5);

    // Fan-in: multiple producers, one channel
    let results = channel();
    spawn worker(results, 10);
    spawn worker(results, 20);
    spawn worker(results, 30);

    let total = 0;
    for (let i = 0; i < 3; i = i + 1) {
        total = total + results.recv();
    }
    print("fan-in total:", total);

    return total;
}

fn worker(ch: channel, n: int) {
    let sum = 0;
    for (let i = 1; i <= n; i = i + 1) {
        sum = sum + i;
    }
    ch.send(sum);
}
```

Output in the web IDE (engine #1):

```text
producing 1
producing 2
producing 3
producing 4
producing 5
consumed 1
consumed 4
consumed 9
consumed 16
consumed 25
consumer finished: 5 items, sum = 55
fan-in total: 730
```

Analysis:

- `channel()` creates a channel (in #1 — a queue; `channel<T>()` is the generic
  form, the type is ignored);
- `ch.send(v)` puts a value in; `ch.recv()` takes one blocking, yielding to the
  scheduler while the queue is empty; `try_recv()` is non-blocking;
- `spawn f(args)` puts the call into the scheduler queue; `spawn { ... }` is an
  anonymous goroutine;
- `main` finishes, but the runtime waits for all goroutines; if after `main` there
  are tasks that cannot run, you get `Deadlock: ...`;
- fan-in: several producers write into one channel, and the consumer reads 3
  values.

## `parallel_sum.lat` — a parallel sum of squares

`web-ide/examples/parallel_sum.lat`:

```latent
// Does not compile with engine #2: channels require the host runtime (engine #1)
// Parallel sum of squares across 4 goroutines (spawn + channel)

fn worker(data: [int], start: int, end: int, ch: channel) {
    let sum = 0;
    for (let i = start; i < end; i = i + 1) {
        sum = sum + data[i] * data[i];
    }
    ch.send(sum);
}

fn main() -> int {
    // Build a large array: [1, 2, ..., 1000]
    let data = [];
    for (let i = 1; i <= 1000; i = i + 1) {
        data.push(i);
    }

    let ch = channel();
    let workers = 4;
    let chunk = data.length / workers;

    // Spawn 4 goroutines, each sums squares of its chunk
    for (let w = 0; w < workers; w = w + 1) {
        let start = w * chunk;
        let end = start + chunk;
        spawn worker(data, start, end, ch);
    }

    // Collect partial sums from all workers
    let total = 0;
    for (let w = 0; w < workers; w = w + 1) {
        let partial = ch.recv();
        print("Worker", w, "partial sum of squares:", partial);
        total = total + partial;
    }

    print("Total sum of squares 1^2..1000^2:", total);
    return total;
}
```

Output (engine #1):

```text
Worker 0 partial sum of squares: 5239625
Worker 1 partial sum of squares: 36552125
Worker 2 partial sum of squares: 99114625
Worker 3 partial sum of squares: 192927125
Total sum of squares 1^2..1000^2: 333833500
```

Analysis: a classic map-reduce over channels — `data` is passed by pointer, each
worker sees its own range, and the results arrive over the channel. The order of
`Worker N` in the output corresponds to the order of receipt from the channel (in
#1 the scheduler runs the tasks in the queue, so the result is deterministic).

## `select_yield.lat` — select, yield, the spawn block

`web-ide/examples/select_yield.lat`:

```latent
// Does not compile with engine #2: channels and select require the host runtime (engine #1)
// Channels: send `<-` / recv, spawn blocks, select and yield.

fn producer(ch, n) {
    let i = 1;
    while (i <= n) {
        ch <- i * i;
        i = i + 1;
    }
}

fn main() -> int {
    let ch = channel<int>();

    // spawn a producer goroutine
    spawn producer(ch, 3);

    // blocking select on the channel
    let first = select {
        case v <- ch: v
    };
    let second = ch.recv();
    let third = ch.recv();

    print("first =", first, "second =", second, "third =", third);

    // spawn an anonymous goroutine with a send
    let done = channel<int>();
    spawn {
        done <- 100;
    }
    let d = done.recv();

    // yield cooperatively inside a loop
    let i = 0;
    while (i < 2) {
        yield;
        i = i + 1;
    }

    return first + second + third + d;
}
```

Output (engine #1):

```text
first = 1 second = 4 third = 9
```

`main` returns `114` (`1 + 4 + 9 + 100`).

Analysis:

- `ch <- v` — the infix send (equivalent to `ch.send(v)`);
- `select { case v <- ch: v }` as an **expression**: it waits for a ready channel
  and returns the value of the branch body; the branch fires when the channel has
  a value;
- `yield;` yields one task to the scheduler (needed for fair cooperative
  switching);
- `spawn { ... }` captures the environment at launch time.

## Engine #2 behavior (honestly)

| Construct | What engine #2 does |
|---|---|
| `channel()` / `channel<T>()` | error: `Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)` |
| `ch.send(...)` / `ch.recv(...)` | error: `Метод '...' не поддерживается движком №2 (требует host-рантайма)` |
| `ch <- v` / `<-ch` | error: `Оператор отправки в канал (ch <- v) требует host-рантайма движка №1` / `Приём из канала (<- ch) ...` |
| `spawn { ... }` / `spawn f()` | compiles **sequentially**, without goroutines |
| `select { ... }` | compiles: the body of the first branch (or `default`) is executed, with no waiting |
| `yield;` | a no-op |
| `async/await` | `await` transparently unwraps the value; there is no `Promise` runtime |

That is why this section is about engine #1 only.

## Related sections

- [Engines](../specs/engines.md) — the complete table of divergences.
- [Grammar → select/spawn](../reference/grammar.md#statements).
- [AI runtime](../specs/ai-runtime.md) — the host functions of engine #1.
- [Web IDE](../tooling/web-ide.md) — how to run the host examples.
