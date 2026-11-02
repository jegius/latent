---
title: Classes
sidebar_label: Classes
sidebar_position: 8
description: Fields, methods, this, the init constructor, new, memory layout, and engine limitations.
---

# Classes

## Syntax

```text
class Имя {
    поле: Тип;            // a field (the type is optional, i32 by default)
    fn метод(параметры) -> Тип { ... }
}
```

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

The rules:

- methods are declared **only** with `fn`; a method without `fn` is a parse error;
- a field requires `;`: `class P { x: int }` is an error;
- `this` is available inside methods; fields are read/written as `this.field`;
- `new Class(args)` allocates an object and calls the `init(args)` method; without
  `init` the fields stay zero;
- there is no inheritance, no interfaces, no `static`, no `super`, and no access
  modifiers.

## Methods and state

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

    fn reset() -> int {
        this.n = 0;
        return this.n;
    }
}

fn main() -> int {
    let c = new Counter();
    c.inc();
    c.inc();
    c.reset();
    print("after reset:", c.inc());
    return c.n;
}
```

## Objects in functions: annotate the type

Engine #2 determines the class of an expression from the parameter annotation or from
`new Class`. Without an annotation, a method call produces the error
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
    acc.deposit(amount);      // without `: Account` this will not compile
    return acc.deposit(amount);
}

fn main() -> int {
    let acc = new Account(100);
    print(deposit_twice(acc, 25));
    return acc.balance;
}
```

The same applies to objects returned from a function: the result of a function has an
unknown static class — assign it to a variable with an annotation:

```latent
class Box {
    v: int;

    fn init(v) {
        this.v = v;
    }

    fn get() -> int {
        return this.v;
    }
}

fn make_box(v: int) -> Box {
    return new Box(v);
}

fn main() -> int {
    let b: Box = make_box(9);
    return b.get();
}
```

## Objects in memory (engine #2)

- an object is a block in linear memory; fields are placed at offsets with 4-byte
  alignment;
- a field of type `float` occupies 8 bytes (`f64`), the others occupy 4;
- methods become functions `Class_method` with an implicit first parameter
  `this`;
- `new` is a bump allocation of `size` plus a call to `Class_init`; the constructor
  returns the pointer;
- `obj.field` reads at an offset through `i32.load`/`f64.load`.

:::caution The `length` field

`p.length` is treated as the built-in length **before** the class field lookup: it
reads the first 4-byte word of the object. If a class has a `length` field, that
field must be declared first, otherwise `p.length` returns the value of another
field. Do not name fields `length`.

:::

## Engine #2 limitations

- Fields are integer/reference only (`int`, `bool`, `string`, arrays, objects).
  `float` fields produce invalid WASM.
- A method called on an expression with no known class (a function result, an array
  element) is not resolved — you need a variable with an annotation.
- Fields are not initialized automatically: without `init` they are zero, but you
  should rely on that only in simple scenarios.
- There is no inheritance and no subtype polymorphism; no `static`; no method
  overloading.
- A repeated `new` does not free memory — bump allocator.

## Engine #1 differences

- The JS interpreter supports classes, `init`, `this`, and methods (including ones
  declared without `fn` — that is JS-only syntax).
- Float fields and float methods work without codegen restrictions.
- `p.length` in the JS engine is an ordinary field.

Next: [Enums and pattern matching](./enums-and-pattern-matching.md).
