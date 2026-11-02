---
title: Классы
sidebar_label: Классы
sidebar_position: 8
description: Поля, методы, this, конструктор init, new, layout в памяти и ограничения движков.
---

# Классы

## Синтаксис

```text
class Имя {
    поле: Тип;            // поле (тип необязателен, по умолчанию i32)
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

Правила:

- методы объявляются **только** через `fn`; метод без `fn` — ошибка парсинга;
- поле требует `;`: `class P { x: int }` — ошибка;
- `this` доступен внутри методов; поля читаются/пишутся `this.поле`;
- `new Class(args)` выделяет объект и вызывает метод `init(args)`; без `init`
  поля остаются нулевыми;
- наследования, интерфейсов, `static`, `super`, модификаторов доступа нет.

## Методы и состояние

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

## Объекты в функциях: аннотируйте тип

Движок №2 определяет класс выражения по аннотации параметра или по
`new Class`. Без аннотации вызов метода даёт ошибку
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
    acc.deposit(amount);      // без `: Account` это не скомпилируется
    return acc.deposit(amount);
}

fn main() -> int {
    let acc = new Account(100);
    print(deposit_twice(acc, 25));
    return acc.balance;
}
```

То же касается объектов, возвращённых из функции: результат функции имеет
неизвестный статический класс — присвойте его переменной с аннотацией:

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

## Объекты в памяти (движок №2)

- объект — блок в линейной памяти; поля идут по смещениям с выравниванием 4;
- поле типа `float` занимает 8 байт (`f64`), остальные — 4;
- методы превращаются в функции `Class_method` с неявным первым параметром
  `this`;
- `new` — bump-аллокация `size` + вызов `Class_init`; конструктор возвращает
  указатель;
- `obj.field` читает по смещению через `i32.load`/`f64.load`.

:::caution Поле `length`

`p.length` обрабатывается как встроенная длина **до** поиска поля класса: это
чтение первого 4-байтного слова объекта. Если в классе есть поле `length`,
оно должно быть объявлено первым, иначе `p.length` вернёт значение другого
поля. Не называйте поля `length`.

:::

## Ограничения движка №2

- Поля — только целочисленные/ссылочные (`int`, `bool`, `string`, массивы,
  объекты). `float`-поля дают невалидный WASM.
- Метод, вызванный на выражении без известного класса (результат функции,
  элемент массива), не резолвится — нужна переменная с аннотацией.
- Поля не инициализируются автоматически: без `init` они нулевые, но полагаться
  на это стоит только для простых сценариев.
- Нет наследования и полиморфизма подтипов; нет `static`; нет перегрузки
  методов.
- Повторное `new` не освобождает память — bump-аллокатор.

## Отличия движка №1

- JS-интерпретатор поддерживает классы, `init`, `this`, методы (в том числе
  объявленные без `fn` — это JS-only синтаксис).
- Float-поля и float-методы работают без ограничений кодогена.
- `p.length` в JS-движке — обычное поле.

Дальше: [Enum и pattern matching](./enums-and-pattern-matching.md).
