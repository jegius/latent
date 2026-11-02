---
title: "Chapter 6. Classes"
sidebar_label: "06. Classes"
sidebar_position: 7
description: Fields, methods, this, the init constructor, new; how engine #2 lays out classes in memory.
---

# Chapter 6. Classes

## A class with fields and methods

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

The syntax:

```text
class Имя {
    поле: Тип;          // field declarations
    поле2;              // the type is optional — i32 by default

    fn метод(параметры) -> Тип { ... }
}
```

- **fields** are declared with `;`, methods are ordinary `fn`s;
- the constructor is a method named `init`; it is called by `new Class(args)`;
- inside methods `this` is available; fields are read and written via `this.поле`;
- there is no inheritance, no `static` methods, and no access modifiers.

## Counter

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

Fields without `init` are initialized to zero (WASM linear memory starts out
zeroed).

## Objects as parameters

To call methods of an object passed into a function, **annotate the parameter
type** — otherwise engine #2 will not determine the class and will report
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

Note that in `deposit_twice` the result of the first `acc.deposit(...)` is ignored
as a statement — it is an expression statement, and the value is discarded.

## Methods calling other methods

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

## Class fields in memory (engine #2)

In a WASM module a class is a block of memory; the fields sit at offsets aligned to
4 bytes. In engine #2 **all fields are stored as 32-bit** (i32), except those
declared as `float` — but `float` fields produce an invalid module in the current
code generator, so use integer fields in portable code:

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

## Exercise

Describe a `Stack` class with an array field and a counter field and the methods
`push_value`, `pop_value`, and `is_empty`. Use a fixed-size array so that you do
not depend on the quirks of `push` in engine #2:

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

Next: [Enums and match](./07-enums-and-match.md).
