---
title: Массивы и строки
sidebar_label: Массивы и строки
sidebar_position: 7
description: Представление массивов и строк в памяти, индексация, методы, builtins, ограничения и различия движков.
---

# Массивы и строки

## Массивы

Литерал: `[1, 2, 3]`, пустой — `[]`. В линейной памяти массив — это блок
`[длина u32][элемент0][элемент1]...`, элементы по 4 байта.

```latent
fn main() -> int {
    let primes = [2, 3, 5, 7, 11];
    print("p[0]:", primes[0]);
    print("length:", primes.length);
    print("len():", len(primes));

    primes[0] = 13;             // присваивание элементу
    print("p[0]:", primes[0]);

    let stack = [1, 2, 3];
    let top = stack.pop();      // 3
    print("popped:", top);
    print("length now:", stack.length);

    let matrix = [[1, 2], [3, 4], [5, 6]];
    print("m[1][0]:", matrix[1][0]);
    return primes[0];
}
```

- индексация — `arr[i]`, индекс-выражение приводится к числу;
- проверки границ **нет**: выход за границы читает/пишет чужую память;
- `.length` и `arr.length()` — одно и то же (`i32.load` заголовка);
- `.push(x)` добавляет элемент и возвращает массив; `push(arr, x)` — то же;
- `.pop()` уменьшает длину и возвращает последний элемент; на пустом массиве
  поведение неопределено (читает `arr[-1]`);
- вложенные массивы поддерживаются.

## Построение массива

```latent
fn main() -> int {
    let squares = [];
    for (let i = 1; i <= 10; i = i + 1) {
        squares.push(i * i);
    }
    let total = 0;
    for (let s in squares) {
        total = total + s;
    }
    print("sum of squares:", total);
    return total;
}
```

:::caution Bump-аллокатор и `push` (движок №2)

Выделение памяти — bump-аллокатор без `free` и без отдельной «ёмкости»: `push`
пишет элемент сразу за текущей длиной, даже если блок был выделен меньшего
размера. Это безопасно, пока между `push` и чтением массива нет других
аллокаций (создание `new`-объектов, других массивов, конкатенация строк).
Рекомендация: стройте массив и сразу читайте его; для массивов объектов/enum
создавайте их литералом:

```latent
enum Tx { Deposit(int), Noop }

fn main() -> int {
    // литерал заранее выделяет слоты под все элементы
    let txs: [Tx] = [Deposit(10), Noop];
    let total = 0;
    for (let tx in txs) {
        total = total + match tx {
            case Noop(): 0,
            case Deposit(n): n,
        };
    }
    return total;
}
```

:::

## Строки

Строка в памяти — `[длина u32][байты UTF-8]`; значение строки — указатель на
длину. Строки неизменяемы: `s + x` создаёт новую строку.

```latent
fn main() -> int {
    let greeting = "Hello, " + "Latent" + "!";
    print(greeting);
    print("bytes:", greeting.length);
    print("first byte:", greeting[0]);

    let version = "v" + 1 + "." + 2;
    print(version);

    let text = "abc";
    if (text == "abc") {
        print("equal by content");
    }
    return greeting.length;
}
```

- `+` со строкой с одной из сторон — конкатенация; числа и bool
  преобразуются в текст (`"v" + 1` → `"v1"`);
- `==`/`!=` и `<`/`>`/`<=`/`>=` сравнивают **содержимое** строк
  (`STR_EQ`/`STR_CMP`), а не указатели;
- `.length` — длина в **байтах UTF-8** (движок №2), `s[i]` — **байт**;
- escapes: `\n`, `\t`, `\\`, `\"`; других нет;
- многострочных/raw-строк и интерполяции нет.

```latent
fn main() -> int {
    let ascii = "latent";     // 6 байт
    let cyrillic = "латент";  // 12 байт в UTF-8
    print(ascii.length);
    print(cyrillic.length);
    return ascii.length;
}
```

## Встроенные функции и методы

| Форма | Смысл | Замечания (движок №2) |
|---|---|---|
| `len(x)` | длина массива/строки | тип не проверяется |
| `push(arr, v)` | добавить элемент | возвращает массив |
| `arr.push(v)` | то же | возвращает массив |
| `arr.pop()` | снять последний | на пустом — неопределено |
| `arr.length` / `arr.length()` | длина | `i32.load` заголовка |
| `str(x)` | в строку | float печатается с 6 знаками |
| `int(x)` | в int | строка парсится, float усекается |
| `float(x)` | в float | строка → целая часть |
| `sqrt(x)` | квадратный корень | только в float-контексте |
| `x.to_str()` / `x.toString()` | в строку | |
| `x.to_int()` / `x.toInt()` | в int | |

```latent
fn main() -> int {
    let number = int("42");
    let truncated = int(3.9);
    let as_text = str(123);
    let from_text = float("3");
    print(number + truncated);
    print(as_text);
    print(from_text);
    return number;
}
```

Чего **нет**: `abs`, `min`, `max`, `floor`, `ceil`, `round`, `pow`, `random`,
`range`, `map`/`filter`/`reduce`, `split`, `substring`, `contains`,
`pop(arr)` как функция, `arr.len()`. Всё это пишется вручную.

## Ограничения движка №2

- Массивы `float` (`[1.5, 2.5]`) — невалидный WASM: элементы пишутся
  `i32.store`.
- `a + b` для массивов **не** конкатенация: компилируется как `i32.add`
  указателей. Конкатенации массивов в движке №2 нет (в движке №1 — есть).
- `print(array)` печатает указатель (число), а не содержимое.
- `==` массивов сравнивает указатели; `assert_eq` для строк теперь сравнивает
  содержимое, для массивов — по-прежнему указатели.
- Нет проверки границ; `pop` на пустом массиве портит память.
- `put/push` на строку компилируется и портит строку.

## Отличия движка №1

- `.length` строки — UTF-16 code units (`"привет"` → 6), `s[i]` — символ;
- массивы сравниваются структурно; `print([1,2])` → `[1, 2]`;
- `a + b` массивов — конкатенация;
- `arr.push` и циклы по строкам работают.

Дальше: [Классы](./classes.md).
