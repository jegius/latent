---
title: "Основы: переменные, операторы, управление, функции, коллекции"
description: "Разборы базовых примеров Latent из web-ide/examples: аннотации типов, операторы и приоритет, управление, функции и рекурсия, builtins/методы, массивы и строки — с выводом в web IDE."
sidebar_position: 2
---

# Основы

Все фрагменты — из `web-ide/examples/`; вывод — то, что печатает **движок №1**
при Run (проверено). Отличия движка №2 указаны отдельно.

## `variables_types.lat` — переменные и аннотации

`web-ide/examples/variables_types.lat`:

```latent
// Variables and type annotations: let name: type = value;

fn main() -> int {
    // Базовые литералы с аннотациями типов
    let i: int = 42;
    let f: float = 3.14;
    let b: bool = true;
    let s: string = "latent";
    let n = null;
    let arr: [int] = [1, 2, 3];

    print("int:   ", i);
    print("float: ", f);
    print("bool:  ", b);
    print("string:", s);
    print("null:  ", n);
    print("array: ", arr);

    // Присваивание меняет значение переменной
    let counter = 0;
    counter = counter + 1;
    counter = counter + 1;
    print("counter:", counter);

    return counter;
}
```

Вывод в web IDE (движок №1):

```text
int:    42
float:  3.14
bool:   true
string: latent
null:   null
array:  [1, 2, 3]
counter: 2
```

Разбор:

- аннотации необязательны; `let n = null;` типизируется как `null`;
- `let arr: [int]` — тип массива; гомогенность в движке №1 не проверяется, в №2
  тоже (элементы хранятся по 4 байта);
- `counter = counter + 1` — присваивание-выражение (в №2), в №1 — инструкция.

Движок №2: компилируется в валидный WASM; `print` там печатает **каждый
аргумент отдельной строкой**, `true` → `1`, `null` → `0`, массив — число-
указатель (см. [движки](../specs/engines.md)).

## `operators.lat` — операторы и приоритет

`web-ide/examples/operators.lat`:

```latent
// Все операторы языка: арифметика, сравнение, логика, приоритет

fn main() -> int {
    let a = 17;
    let b = 5;

    // Арифметика
    print("a + b =", a + b);
    print("a - b =", a - b);
    print("a * b =", a * b);
    print("a / b =", a / b);
    print("a % b =", a % b);

    // Сравнения
    print("a == b:", a == b, " a != b:", a != b);
    print("a > b:", a > b, " a < b:", a < b);
    print("a >= b:", a >= b, " a <= b:", a <= b);

    // Приоритет: умножение выше сложения, скобки меняют порядок
    print("2 + 3 * 4 =", 2 + 3 * 4);
    print("(2 + 3) * 4 =", (2 + 3) * 4);

    // Логические операторы и унарный минус
    let t = true;
    let g = false;
    print("t && g:", t && g, " t || g:", t || g, " !t:", !t);
    print("unary -a =", -a);

    return 0;
}
```

Вывод (движок №1):

```text
a + b = 22
a - b = 12
a * b = 85
a / b = 3.4
a % b = 2
a == b: false  a != b: true
a > b: true  a < b: false
a >= b: true  a <= b: false
2 + 3 * 4 = 14
(2 + 3) * 4 = 20
t && g: false  t || g: true  !t: false
unary -a = -17
```

Ключевое расхождение: `a / b` → `3.4` в движке №1 (JS-деление) и `3` в движке
№2 (`i32.div_s`). Приоритеты — как в [справочнике операторов](../reference/operators.md):
`*` выше `+`, `&&` ниже `==`, `-a` (унарный) связывает крепче умножения.

## `control_flow.lat` — ветвления и циклы

`web-ide/examples/control_flow.lat`:

```latent
// Control flow: if/else if/else, while, for, logical operators

fn classify(n: int) -> string {
    if (n < 0) {
        return "negative";
    } else if (n == 0) {
        return "zero";
    } else if (n < 10) {
        return "small positive";
    } else {
        return "large positive";
    }
}

fn fizzbuzz(n: int) {
    for (let i = 1; i <= n; i = i + 1) {
        if (i % 15 == 0) {
            print("FizzBuzz");
        } else if (i % 3 == 0) {
            print("Fizz");
        } else if (i % 5 == 0) {
            print("Buzz");
        } else {
            print(i);
        }
    }
}

fn main() -> int {
    print(classify(-5));
    print(classify(0));
    print(classify(7));
    print(classify(42));

    let x = 7;
    if (x > 0 && x < 10) {
        print(x, "is a single-digit positive number");
    }
    if (x < 0 || x > 5) {
        print(x, "is either negative or greater than 5");
    }
    if (!(x == 0)) {
        print(x, "is not zero");
    }

    let n = 27;
    let steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    print("collatz(27) reaches 1 in", steps, "steps");

    fizzbuzz(15);

    return steps;
}
```

Вывод (фрагмент): `negative`, `zero`, `small positive`,
`large positive`, `7 is a single-digit positive number`,
`7 is either negative or greater than 5`, `7 is not zero`,
`collatz(27) reaches 1 in 111 steps`, затем FizzBuzz-последовательность до 15.

Разбор:

- условия обязательно в скобках (`if (x)`), `else if` работает;
- `for (let i = 1; i <= n; i = i + 1)` — C-стиль; `break`/`continue` нет;
- `&&`/`||` — с коротким замыканием, `!(...)` — логическое НЕ.

## `functions.lat` — функции и рекурсия

`web-ide/examples/functions.lat`:

```latent
// Функции: параметры, типы возврата, вызовы, композиция и рекурсия

fn add(a: int, b: int) -> int {
    return a + b;
}

fn square(x: int) -> int {
    return x * x;
}

// Композиция вызовов
fn sum_squares(a: int, b: int) -> int {
    return add(square(a), square(b));
}

// Рекурсия: алгоритм Евклида
fn gcd(a: int, b: int) -> int {
    if (b == 0) {
        return a;
    }
    return gcd(b, a % b);
}

fn main() -> int {
    print("add(2, 3) =", add(2, 3));
    print("square(7) =", square(7));
    print("sum_squares(3, 4) =", sum_squares(3, 4));
    print("gcd(48, 36) =", gcd(48, 36));
    return sum_squares(3, 4);
}
```

Вывод: `add(2, 3) = 5`, `square(7) = 49`, `sum_squares(3, 4) = 25`,
`gcd(48, 36) = 12`; `main` возвращает `25`.

Разбор: функции хойстятся (вызов до объявления возможен), рекурсия
поддерживается; `gcd` в одном выражении использует и вызов, и `%`.

## `builtins_methods.lat` — builtins и методы

`web-ide/examples/builtins_methods.lat`:

```latent
// Builtins and methods: len(), push(), arr.pop(), str.length
// Встроенные функции языка в одном месте.

fn sum(arr: [int]) -> int {
    let total = 0;
    for (let i = 0; i < len(arr); i = i + 1) {
        total = total + arr[i];
    }
    return total;
}

fn main() -> int {
    // len() — длина массива и строки
    let nums = [4, 8, 15, 16, 23, 42];
    print("len(nums) =", len(nums));

    let word = "latent";
    print("len(\"latent\") =", len(word));

    // push() как встроенная функция (в отличие от метода arr.push)
    let acc = [];
    push(acc, 1);
    push(acc, 2);
    push(acc, 3);
    print("after push:", acc);

    // Методы массива: push / pop / length
    let stack = [10, 20, 30];
    stack.push(40);
    print("stack.push(40) ->", stack);
    let top = stack.pop();
    print("stack.pop() ->", top, "stack:", stack);
    print("stack.length =", stack.length);

    // Метод строки: length
    print("\"hello\".length =", "hello".length);

    // Комбинируем встроенные функции
    print("sum(nums) =", sum(nums));
    print("average =", sum(nums) / len(nums));

    return sum(nums);
}
```

Вывод: `len(nums) = 6`, `len("latent") = 6`, `after push: [1, 2, 3]`,
`stack.push(40) -> [10, 20, 30, 40]`, `stack.pop() -> 40 stack: [10, 20, 30]`,
`stack.length = 3`, `"hello".length = 5`, `sum(nums) = 108`, `average = 18`.

Важно:

- `len` строки — длина в **байтах** (для кириллицы больше числа символов);
- `average = 18` — потому что JS-деление даёт `108/6 = 18`; в движке №2
  `108 / 6` тоже `18`, но `17 / 5` уже `3`;
- `push`/`pop` мутируют массив; функциональный `push(arr, v)` возвращает массив
  (тайпчекер считает `unit`).

## `arrays.lat` — массивы

`web-ide/examples/arrays.lat` (сокращено; полный файл — в репозитории):

```latent
fn main() -> int {
    let primes = [2, 3, 5, 7, 11, 13];
    print("primes:", primes);
    print("primes[0] =", primes[0]);
    print("primes.length =", primes.length);

    primes[0] = 17;
    print("after primes[0] = 17:", primes);

    let stack = [];
    stack.push(1);
    stack.push(2);
    stack.push(3);
    let top = stack.pop();

    let a = [1, 2, 3];
    let b = [4, 5, 6];
    let c = a + b;

    let matrix = [[1, 2], [3, 4], [5, 6]];
    print("matrix[1][0] =", matrix[1][0]);

    let squares = [];
    for (let i = 1; i <= 10; i = i + 1) {
        squares.push(i * i);
    }
    print("squares 1..10:", squares);

    let sum = 0;
    let i = 0;
    while (i < squares.length) {
        sum = sum + squares[i];
        i = i + 1;
    }
    return sum;
}
```

Вывод (движок №1): `primes: [2, 3, 5, 7, 11, 13]`, `primes[0] = 2`,
`primes.length = 6`, `after primes[0] = 17: [17, 3, 5, 7, 11, 13]`,
`stack after pushes: [1, 2, 3]`, `popped: 3 stack: [1, 2]`,
`a + b = [1, 2, 3, 4, 5, 6]`, `matrix[1][0] = 3`,
`squares 1..10: [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]`,
`sum of squares: 385`.

:::warning
`a + b` для массивов — **только движок №1** (конкатенация). Движок №2
компилирует `+` как `i32.add` указателей — семантика не та (компилируется, но
результат бессмысленный). Не используйте конкатенацию массивов в коде для №2.
:::

## `strings.lat` — строки

`web-ide/examples/strings.lat`:

```latent
// Strings: literals, concatenation, length, comparison

fn greet(name: string) -> string {
    return "Hello, " + name + "!";
}

fn main() -> int {
    let greeting = greet("Latent");
    print(greeting);

    // String concatenation with numbers
    let version = "v" + 1 + "." + 0;
    print("version:", version);

    // String length
    let text = "functional vibes";
    print("length of", "\"" + text + "\" =", text.length);

    // String comparison
    let a = "apple";
    let b = "banana";
    if (a == b) {
        print("strings are equal");
    } else {
        print(a, "!=", b);
    }

    // Building strings in a loop
    let stars = "";
    for (let i = 0; i < 5; i = i + 1) {
        stars = stars + "*";
    }
    print("stars:", stars);

    // Escape sequences
    print("line1\nline2\t(tabbed)");

    return 0;
}
```

Вывод: `Hello, Latent!`, `version: v1.0`,
`length of "functional vibes" = 16`, `apple != banana`, `stars: *****`,
`line1`/`line2	(tabbed)` (две строки из-за `\n`).

Разбор: `+` конкатенирует строку с числами; `==` в движке №1 — сравнение
содержимого (в №2 — тоже для строк, через хелпер `str_eq`); `.length` — байты.
Escape-последовательности — только `\n \t \\ \"`.

## Итоги

- Базовые конструкции выглядят привычно (C-подобный синтаксис), но **семантика
  чисел/строк/массивов зависит от движка**.
- Движок №1 «прощает» больше (динамическая типизация), движок №2 строже в
  коде, но имеет дефекты float/void (см.
  [ограничения](../reference/errors.md#известные-ограничения-движка-2-компилируется-но-невалидный-wasm)).

Дальше: [алгоритмы](./algorithms.md) · [ООП](./oop.md) ·
[функциональный стиль](./functional.md).
