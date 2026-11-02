---
title: "Глава 5. Массивы и строки"
sidebar_label: "05. Массивы и строки"
sidebar_position: 6
description: Литералы массивов, индексация, push/pop/length, len, for-in, строки и их байтовая природа.
---

# Глава 5. Массивы и строки

## Массивы

```latent
fn main() -> int {
    let primes = [2, 3, 5, 7, 11];
    print("primes[0]:", primes[0]);
    print("length:", primes.length);

    primes[0] = 13;
    print("updated primes[0]:", primes[0]);

    let stack = [1, 2, 3];
    let top = stack.pop();
    print("popped:", top, "length:", stack.length);

    return primes[0];
}
```

- литерал: `[1, 2, 3]`, пустой массив — `[]`;
- индексация `arr[i]` (индекс — число; выход за границы не проверяется);
- `.length` — длина; `len(arr)` — то же самое;
- `.push(x)` добавляет элемент, `.pop()` снимает последний и возвращает его;
- функциональные формы: `push(arr, x)` и `len(arr)`.

Вложенные массивы работают: `[[1, 2], [3, 4]][1][0]` даёт `3`.

## Построение массива в цикле

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
    print("sum of squares 1..10:", total);
    return total;
}
```

`for (let s in squares)` обходит элементы массива по порядку. Индекс внутри
такого цикла недоступен — используйте `for` в стиле C.

:::caution Время жизни памяти в движке №2

В WASM-движке массивы живут в линейной памяти, выделенной bump-аллокатором:
`push` расширяет массив, записывая элементы за концом выделенного блока.
Это безопасно, пока между `push` и чтением массива нет других аллокаций
(создание объектов через `new`, других массивов, конкатенации строк).
Надёжный стиль: стройте массив и сразу читайте его, не создавая объектов в
промежутке. Подробнее — [arrays-and-strings](../guide/arrays-and-strings.md).

:::

## Строки

```latent
fn main() -> int {
    let greeting = "Hello, " + "Latent" + "!";
    print(greeting);
    print("length:", greeting.length);
    print("first byte:", greeting[0]);

    let stars = "";
    for (let i = 0; i < 5; i = i + 1) {
        stars = stars + "*";
    }
    print(stars);

    return greeting.length;
}
```

- строки складываются через `+`; числа при конкатенации преобразуются в текст;
- `==` и `!=` сравнивают строки **по содержимому**;
- `.length` — длина в **байтах UTF-8**, а не в символах (это семантика движка
  №2; в движке №1 строки — JS-строки, и `.length` считает UTF-16 code units);
- `s[i]` возвращает **байт** (число), а не символ (в движке №1 — символ).

Проверка байтовой природы:

```latent
fn main() -> int {
    let ascii = "latent";
    let cyrillic = "латент";
    print("ascii bytes:", ascii.length);
    print("cyrillic bytes:", cyrillic.length);
    return 0;
}
```

Для ASCII длина совпадает с числом символов, для кириллицы — нет (каждая буква
занимает 2 байта в UTF-8).

## Методы и встроенные функции

```latent
fn main() -> int {
    let number = int("42");        // строка → int
    let text = str(42);            // int → строка
    let as_text = "value: " + 7;   // конкатенация с числом
    print(number + 1);
    print(text);
    print(as_text);
    print("hello".length);
    return number;
}
```

| Функция | Смысл |
|---|---|
| `len(x)` | длина массива или строки |
| `push(arr, x)` | то же, что `arr.push(x)` |
| `str(x)` | преобразовать в строку |
| `int(x)` | преобразовать в `int` (строка парсится, float усекается) |
| `float(x)` | преобразовать в `float` |

## Упражнение

Напишите функцию `count_vowels(s)`, считающую английские гласные в строке
(используйте индексацию по байтам и сравнение байтов с кодами `a`, `e`, `i`,
`o`, `u` — 97, 101, 105, 111, 117).

```latent
fn is_vowel(code: int) -> bool {
    if (code == 97 || code == 101 || code == 105 || code == 111 || code == 117) {
        return true;
    }
    return false;
}

fn count_vowels(s: string) -> int {
    let count = 0;
    for (let i = 0; i < s.length; i = i + 1) {
        if (is_vowel(s[i])) {
            count = count + 1;
        }
    }
    return count;
}

fn main() -> int {
    print("vowels in 'latent':", count_vowels("latent"));
    return 0;
}
```

Дальше: [Классы](./06-classes.md).
