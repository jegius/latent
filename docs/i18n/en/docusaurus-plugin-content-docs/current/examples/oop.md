---
title: "OOP: classes, fields, methods, this"
sidebar_label: OOP
sidebar_position: 5
description: "Walkthrough of classes.lat: the class declaration, the init constructor, fields, methods, this, new; the output in the web IDE and the limitations of engine #2."
---

# OOP: classes

## `classes.lat` — fields, `init`, methods, `this`

`web-ide/examples/classes.lat`:

```latent
// Classes & OOP: fields, init, methods, this binding.

class Point {
    x: int;
    y: int;

    fn init(x, y) {
        this.x = x;
        this.y = y;
    }

    fn norm2() {
        return this.x * this.x + this.y * this.y;
    }
}

class Counter {
    n: int;

    fn init() { this.n = 0; }
    fn inc() {
        this.n = this.n + 1;
        return this.n;
    }
}

fn main() -> int {
    let p = new Point(3, 4);
    print("p.norm2() =", p.norm2());

    let c = new Counter();
    c.inc();
    c.inc();
    print("counter =", c.inc());

    return p.norm2() + c.n;
}
```

Output in the web IDE (engine #1):

```text
p.norm2() = 25
counter = 3
```

`main` returns `28` (`25 + 3`).

Analysis:

- a class is declared with `class Name { ... }`; fields are `name: type;`;
- the constructor is an ordinary `init` method; `new Point(3, 4)` creates an
  instance and calls `init(3, 4)`; `this` is available inside the methods;
- methods are called with a dot: `p.norm2()`, `c.inc()`;
- fields without an `init` assignment: `null` in engine #1, zeros in engine #2
  (the memory starts out zeroed);
- there is no inheritance.

## Engine #2: what works and what does not

- The example **compiles** to valid WASM: a class is a layout in memory, and the
  methods are `Class_method` functions with an implicit `this`.
- The method is looked up on the **static** class of the object. The object has to
  be: a local variable with a known class (`let p = new Point(...)`), `this`, or a
  parameter annotated with the class. Calling a method on a temporary value
  (`new Point(3,4).norm2()`) produces
  `Метод 'norm2' не поддерживается движком №2 (требует host-рантайма)` — this is not
  a host feature but a limitation of the class-name inference.
- `float` fields and `float` method parameters produce invalid WASM (see
  [limitations](../reference/errors.md#known-limitations-of-engine-2-compiles-but-invalid-wasm)).
- `new Class(...)` without an `init` method may produce an invalid module in
  reachable code (there is nowhere to pass the arguments); declare `init`, even an
  empty one.

## Variants

```latent
class Box {
    value: int;

    fn init(v) { this.value = v; }

    fn get() -> int { return this.value; }
    fn set(v) -> int {
        this.value = v;
        return v;
    }
}

fn main() -> int {
    let b = new Box(10);
    b.set(42);
    return b.get();
}
```

This variant compiles with engine #2 (the class is a local variable, the methods
have a known type). Note that `set` returns `int` — a method without a result in
statement position produces invalid WASM (a `drop` after a void call); this is a
codegen limitation.

## Related sections

- [Basics](./basics.md) · [Functional style](./functional.md)
- [Types → classes](../reference/types.md) · [WASM ABI → classes](../reference/wasm-abi.md#class)
- [Codegen internals → classes](../specs/internals-codegen.md#classes)
