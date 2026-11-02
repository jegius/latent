---
title: "Конкурентность: каналы, spawn, select, yield"
description: "Разбор channels.lat, parallel_sum.lat, select_yield.lat: CSP-каналы, горутины, планировщик, select/yield; что это даёт в движке №1 и почему не компилируется движком №2."
sidebar_position: 4
---

# Конкурентность

Конкурентность Latent реализована **только host-рантаймом движка №1**:
кооперативный планировщик «горутин», каналы CSP, `select`, `yield`. Движок №2
(Rust→WASM) синтаксис принимает, но каналы отвергает ошибкой, а `spawn`/`select`/
`yield` компилирует в суррогат (см. [движки](../specs/engines.md)).

:::warning
Все блоки этого раздела **не компилируются движком №2** — это host-only
примеры для web IDE (Run). Первая строка блоков помечена соответственно.
:::

## `channels.lat` — producer/consumer и fan-in

`web-ide/examples/channels.lat`:

```latent
// Не компилируется движком №2: каналы требуют host-рантайма (движок №1)
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

Вывод в web IDE (движок №1):

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

Разбор:

- `channel()` создаёт канал (в №1 — очередь; `channel<T>()` — generic-форма,
  тип игнорируется);
- `ch.send(v)` кладёт значение; `ch.recv()` блокирующе забирает, уступая
  планировщику, пока очередь пуста; `try_recv()` — неблокирующе;
- `spawn f(args)` ставит вызов в очередь планировщика; `spawn { ... }` —
  анонимная горутина;
- `main` завершается, но рантайм дожидается всех горутин; если после `main`
  остались задачи, которые не могут выполниться, — `Deadlock: ...`;
- fan-in: несколько producer'ов пишут в один канал, consumer читает 3 значения.

## `parallel_sum.lat` — параллельная сумма квадратов

`web-ide/examples/parallel_sum.lat`:

```latent
// Не компилируется движком №2: каналы требуют host-рантайма (движок №1)
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

Вывод (движок №1):

```text
Worker 0 partial sum of squares: 5239625
Worker 1 partial sum of squares: 36552125
Worker 2 partial sum of squares: 99114625
Worker 3 partial sum of squares: 192927125
Total sum of squares 1^2..1000^2: 333833500
```

Разбор: классический map-reduce на каналах — `data` передаётся по указателю,
каждый worker видит свой диапазон, результаты приходят по каналу. Порядок
`Worker N` в выводе соответствует порядку приёма из канала (в №1 планировщик
выполняет задачи в очереди, поэтому результат детерминирован).

## `select_yield.lat` — select, yield, spawn-блок

`web-ide/examples/select_yield.lat`:

```latent
// Не компилируется движком №2: каналы и select требуют host-рантайма (движок №1)
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

Вывод (движок №1):

```text
first = 1 second = 4 third = 9
```

`main` возвращает `114` (`1 + 4 + 9 + 100`).

Разбор:

- `ch <- v` — инфиксная отправка (эквивалент `ch.send(v)`);
- `select { case v <- ch: v }` как **выражение**: ждёт готовый канал и
  возвращает значение тела ветки; ветка срабатывает, когда в канале есть
  значение;
- `yield;` уступает планировщику одну задачу (нужно для честного
  кооперативного переключения);
- `spawn { ... }` захватывает окружение на момент запуска.

## Поведение движка №2 (честно)

| Конструкция | Что делает движок №2 |
|---|---|
| `channel()` / `channel<T>()` | ошибка: `Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)` |
| `ch.send(...)` / `ch.recv(...)` | ошибка: `Метод '...' не поддерживается движком №2 (требует host-рантайма)` |
| `ch <- v` / `<-ch` | ошибка: `Оператор отправки в канал (ch <- v) требует host-рантайма движка №1` / `Приём из канала (<- ch) ...` |
| `spawn { ... }` / `spawn f()` | компилируется **последовательно**, без горутин |
| `select { ... }` | компилируется: исполняется тело первой ветки (или `default`), без ожидания |
| `yield;` | no-op |
| `async/await` | `await` — прозрачное разворачивание значения; `Promise`-рантайма нет |

Поэтому этот раздел — только про движок №1.

## Связанные разделы

- [Движки](../specs/engines.md) — полная таблица расхождений.
- [Грамматика → select/spawn](../reference/grammar.md#инструкции).
- [AI-рантайм](../specs/ai-runtime.md) — host-функции движка №1.
- [Web IDE](../tooling/web-ide.md) — как запускать host-примеры.
