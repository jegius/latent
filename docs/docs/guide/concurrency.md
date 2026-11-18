---
title: Конкурентность
sidebar_label: Конкурентность
sidebar_position: 12
description: Каналы, горутины, select и yield в движке №1 и их суррогаты в движке №2.
---

# Конкурентность

:::caution Только движок №1

Полноценная конкурентность — это **движок №1** (JS-интерпретатор, playground).
Движок №2 (Rust → WASM) не имеет host-рантайма: `channel` и `<-` дают ошибку,
`spawn`/`select`/`yield` компилируются в суррогаты. Все примеры ниже
**не компилируются движком №2** (они помечены маркером).

:::

## Каналы

```latent
// Не компилируется движком №2: каналы требуют host-рантайма.
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

- `channel()` создаёт небуферизованный канал; `channel<T>()` — с generic-типом
  (в движке №1 тип не обязателен);
- `ch.send(v)` и `ch.recv()` — методы; `recv()` блокирует горутину, пока нет
  значения;
- альтернативный синтаксис операторов: `ch <- v` (отправка) и `<-ch` (приём):

```latent
// Не компилируется движком №2: операторы канала требуют host-рантайма.
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

## Горутины: `spawn`

```latent
// Не компилируется движком №2: каналы требуют host-рантайма.
fn worker(ch, n) {
    ch.send(n);
}

fn main() -> int {
    let ch = channel();

    spawn worker(ch, 1);      // вызов функции как горутина
    spawn {                   // анонимная горутина
        ch.send(2);
    }

    let a = ch.recv();
    let b = ch.recv();
    return a + b;
}
```

- `spawn f(args);` — запустить вызов в отдельной горутине;
- `spawn { ... }` — анонимный блок;
- точка с запятой после `spawn` необязательна;
- `return` внутри `spawn`-блока в движке №2 возвращает из объемлющей функции
  (spawn компилируется inline).

## `select`

```latent
// Не компилируется движком №2: каналы требуют host-рантайма.
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

- `select` ждёт первый готовый канал; `default` выполняется, если ничего не
  готово сразу;
- тело ветки — обязательно блок `{ ... }`;
- `case` можно опустить;
- `select` бывает и выражением: `let v = select { case x <- ch: x };`.

## `yield`

```latent
// Не компилируется движком №2: каналы требуют host-рантайма.
fn producer(ch, n) {
    let i = 0;
    while (i < n) {
        ch.send(i);
        yield; // уступить планировщику
        i = i + 1;
    }
}

fn main() -> int {
    let ch = channel();
    spawn producer(ch, 3);
    return ch.recv();
}
```

`yield` — кооперативная уступка планировщику; отдельный `sleep`/`delay` в
языке отсутствует.

## Семантика движка №1

- планировщик кооперативный, очередь задач (`stepScheduler`);
- `recv()` блокирует текущую горутину, планировщик переключается на другие;
- после возврата из `main` интерпретатор дожидается оставшихся горутин;
- если после дренажа очереди остались задачи — ошибка
  `Deadlock: N goroutine(s) still pending...`;
- `select` без готовых каналов и без `default` ждёт, уступая планировщику; при
  отсутствии других задач — `Deadlock: select with no ready channel...`.

## Суррогаты движка №2

```latent
fn worker(x: int) -> int {
    print("worker", x);
    return x * 2;
}

fn main() -> int {
    spawn worker(1);     // просто вызов, выполняется сразу
    spawn {
        print("inline");
    }
    yield;               // no-op
    return 0;
}
```

| Конструкция | Движок №2 |
|---|---|
| `spawn { ... }`, `spawn f()` | тела выполняются последовательно в текущей функции |
| `yield` | no-op |
| `select` (инструкция) | выражения каналов не вычисляются; исполняется тело первой ветки (или `default`, если веток нет) |
| `select` (выражение) | первая ветка, переменная = 0 |
| `channel()`, `channel<T>()` | ошибка `Builtin 'channel' не поддерживается...` |
| `ch.send`, `ch.recv` | ошибка `Метод 'send'/'recv' не поддерживается...` |
| `ch <- v`, `<-ch` | ошибка «требует host-рантайма движка №1» |

## Ограничения движка №2

- Каналы и `select`-блокировки отсутствуют как рантайм.
- `spawn` не создаёт горутин: код исполняется в текущем кадре (общие локальные
  переменные).
- `yield` ничего не делает.
- Для настоящей конкурентности используйте движок №1 (playground / интерпретатор)
  или внешний host.

Дальше: [AI-примитивы](./ai-features.md).
