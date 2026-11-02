---
title: "ООП: классы, поля, методы, this"
description: "Разбор classes.lat: объявление класса, init-конструктор, поля, методы, this, new; вывод в web IDE и ограничения движка №2."
sidebar_position: 5
---

# ООП: классы

## `classes.lat` — поля, `init`, методы, `this`

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

Вывод в web IDE (движок №1):

```text
p.norm2() = 25
counter = 3
```

`main` возвращает `28` (`25 + 3`).

Разбор:

- класс объявляется `class Name { ... }`; поля — `имя: тип;`;
- конструктор — обычный метод `init`; `new Point(3, 4)` создаёт экземпляр и
  вызывает `init(3, 4)`; внутри методов доступен `this`;
- методы вызываются через точку: `p.norm2()`, `c.inc()`;
- поля без `init`-присваивания: в движке №1 — `null`, в движке №2 — нули
  (память изначально нулевая);
- наследования нет.

## Движок №2: что работает и что нет

- Пример **компилируется** в валидный WASM: класс — это запись в памяти
  (layout), методы — функции `Class_method` с неявным `this`.
- Метод ищется по **статическому** классу объекта. Объект должен быть:
  локальной переменной с известным классом (`let p = new Point(...)`),
  `this` или параметром с аннотацией класса. Вызов метода на временном
  значении (`new Point(3,4).norm2()`) даёт
  `Метод 'norm2' не поддерживается движком №2 (требует host-рантайма)` —
  это не host-фича, а ограничение вывода имени класса.
- `float`-поля и `float`-параметры методов дают невалидный WASM (см.
  [ограничения](../reference/errors.md#известные-ограничения-движка-2-компилируется-но-невалидный-wasm)).
- `new Class(...)` без метода `init` в достижимом коде может дать невалидный
  модуль (аргументы некуда передать); объявляйте `init`, даже пустой.

## Варианты

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

Этот вариант компилируется движком №2 (класс — локальная переменная, методы с
известным типом). Обратите внимание: `set` возвращает `int` — метод без
результата в позиции инструкции даёт невалидный WASM (`drop` после
void-вызова), это ограничение кодогена.

## Связанные разделы

- [Основы](./basics.md) · [Функциональный стиль](./functional.md)
- [Типы → классы](../reference/types.md) · [WASM ABI → классы](../reference/wasm-abi.md#класс)
- [Внутреннее устройство кодогена → классы](../specs/internals-codegen.md#классы)
