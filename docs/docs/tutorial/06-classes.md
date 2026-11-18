---
title: "Глава 6. Классы"
sidebar_label: "06. Классы"
sidebar_position: 7
description: Поля, методы, this, конструктор init, new; как движок №2 представляет классы в памяти.
---

# Глава 6. Классы

## Класс с полями и методами

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
    print("norm2:", p.norm2());
    return p.norm2();
}
```

Синтаксис:

```text
class Имя {
    поле: Тип;          // объявления полей
    поле2;              // тип необязателен — по умолчанию i32

    fn метод(параметры) -> Тип { ... }
}
```

- **поля** объявляются с `;`, методы — обычные `fn`;
- конструктор — метод с именем `init`; он вызывается из `new Class(args)`;
- внутри методов доступен `this`; поля читаются/пишутся через `this.поле`;
- наследования, `static`-методов и модификаторов доступа нет.

## Счётчик

```latent
class Counter {
    n: int;

    fn init() {
        this.n = 0;
    }

    fn inc() -> int {
        this.n = this.n + 1;
        return this.n;
    }
}

fn main() -> int {
    let c = new Counter();
    c.inc();
    c.inc();
    print("counter:", c.inc());
    return c.n;
}
```

Поля без `init` инициализируются нулём (линейная память WASM изначально
нулевая).

## Объекты как параметры

Чтобы вызывать методы объекта, переданного в функцию, **аннотируйте тип
параметра** — иначе движок №2 не определит класс и выдаст ошибку
`Метод '...' не поддерживается движком №2`:

```latent
class Account {
    balance: int;

    fn init(start) {
        this.balance = start;
    }

    fn deposit(amount) -> int {
        this.balance = this.balance + amount;
        return this.balance;
    }
}

fn deposit_twice(acc: Account, amount: int) -> int {
    acc.deposit(amount);
    return acc.deposit(amount);
}

fn main() -> int {
    let acc = new Account(100);
    print("after two deposits:", deposit_twice(acc, 25));
    return acc.balance;
}
```

Обратите внимание: в `deposit_twice` результатом первого `acc.deposit(...)`
как инструкции пренебрегаем — это expression statement, значение отбрасывается.

## Методы вызывают другие методы

```latent
class Temperature {
    celsius: int;

    fn init(c) {
        this.celsius = c;
    }

    fn fahrenheit() -> int {
        return this.celsius * 9 / 5 + 32;
    }

    fn describe() -> string {
        if (this.celsius < 0) {
            return "freezing";
        } else if (this.celsius < 20) {
            return "cold";
        } else {
            return "warm";
        }
    }
}

fn main() -> int {
    let t = new Temperature(21);
    print("F:", t.fahrenheit());
    print("state:", t.describe());
    return 0;
}
```

## Поля классов в памяти (движок №2)

В WASM-модуле класс — это блок памяти; поля расположены по смещениям с
выравниванием 4 байта. В движке №2 **все поля хранятся как 32-битные** (i32),
кроме объявленных как `float` — но `float`-поля в текущем кодогенераторе дают
невалидный модуль, поэтому в переносимом коде используйте целочисленные поля:

```latent
class Stats {
    hits: int;
    misses: int;

    fn init() {
        this.hits = 0;
        this.misses = 0;
    }

    fn record(hit: bool) -> int {
        if (hit) {
            this.hits = this.hits + 1;
        } else {
            this.misses = this.misses + 1;
        }
        return this.hits;
    }

    fn accuracy_percent() -> int {
        let total = this.hits + this.misses;
        if (total == 0) {
            return 0;
        }
        return this.hits * 100 / total;
    }
}

fn main() -> int {
    let s = new Stats();
    s.record(true);
    s.record(true);
    s.record(false);
    print("accuracy:", s.accuracy_percent());
    return 0;
}
```

## Упражнение

Опишите класс `Stack` с полями-массивом и счётчиком и методами `push_value`,
`pop_value`, `is_empty`. Используйте массив фиксированного размера, чтобы не
зависеть от особенностей `push` в движке №2:

```latent
class Stack {
    data: [int];
    size: int;

    fn init() {
        this.data = [0, 0, 0, 0, 0, 0, 0, 0];
        this.size = 0;
    }

    fn push_value(v: int) -> int {
        this.data[this.size] = v;
        this.size = this.size + 1;
        return this.size;
    }

    fn pop_value() -> int {
        if (this.size == 0) {
            return -1;
        }
        this.size = this.size - 1;
        return this.data[this.size];
    }
}

fn main() -> int {
    let s = new Stack();
    s.push_value(10);
    s.push_value(20);
    s.push_value(30);
    print("popped:", s.pop_value());
    print("popped:", s.pop_value());
    return s.size;
}
```

Дальше: [Enum и match](./07-enums-and-match.md).
