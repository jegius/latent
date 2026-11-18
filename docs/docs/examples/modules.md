---
title: "Модули: проект из трёх файлов"
sidebar_label: "Модули (многофайловый проект)"
sidebar_position: 16
description: "Пошаговый разбор многофайлового проекта Latent: math.lat, model.lat, main.lat — вывод движка №1, компиляция движком №2, результат latentc bundle и точные тексты ошибок линковки."
---

# Модули: проект из трёх файлов

Разбор проекта, который используется в [гайде по модулям](../guide/modules.md):
функции и enum в `math.lat`, класс в `model.lat`, сценарий в `main.lat`. Ниже —
код файлов, что вы увидите в консоли каждого движка и как это выглядит после
`latentc bundle`.

## 1. Файлы

```text
project/
  main.lat    — entry: main(), сценарий
  math.lat    — square, sum_squares, enum Shape
  model.lat   — class Point, fn area(Shape)
```

```latent
// module-part math.lat
export fn square(x: int) -> int { return x * x; }

export fn sum_squares(a: int, b: int) -> int { return square(a) + square(b); }

export enum Shape { Circle(int), Rect(int, int) }
```

```latent
// module-part model.lat
import { square, Shape } from "./math.lat";

export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
    fn norm2() -> int { return square(this.x) + square(this.y); }
}

export fn area(shape: Shape) -> int {
    return match shape {
        case Circle(r): 3 * square(r),
        default: 0,
    };
}
```

```latent
// module-part main.lat
import { Shape } from "./math.lat";
import { Point, area } from "./model.lat";

fn main() -> int {
    let p = new Point(3, 4);
    let c = Circle(2);
    print("norm2 =", p.norm2());
    print("area =", area(c));
    return p.norm2() + area(c);
}
```

Разбор по строкам:

- `model.lat` импортирует `Shape`, но вызывает `Circle(2)` только в `match` —
  вариант enum'а приезжает вместе с импортом enum'а, отдельный
  `import { Circle }` не нужен и не разрешён.
- `main.lat` импортирует `Point` и `area` из `model.lat`, а `Shape` — из
  `math.lat` напрямую: транзитивных реэкспортов в v1 нет, каждый модуль
  импортирует то, что ему нужно.
- `math.lat` импортируют два файла, но линкер загружает его один раз.

## 2. Run в web IDE (движок №1)

Создайте три файла в дереве проекта, откройте `main.lat` (активный файл = entry)
и нажмите **Run** (`Ctrl/⌘+Enter`). Консоль:

```text
norm2 = 25
area = 12
```

`print` в движке №1 склеивает аргументы через пробел в одну строку, поэтому
`print("norm2 =", p.norm2())` даёт `norm2 = 25`. Значение `main()` — `37`.

Что происходит внутри: `compiler/modules.js` строит граф от `main.lat`, находит
`math.lat` и `model.lat`, кэширует разобранные модули; `modules-link.js`
переименовывает объявления в `m0$…`/`m1$…`/`m2$…` и собирает один `Program`,
который исполняет интерпретатор.

## 3. Engine #2 (компилятор в WASM)

Кнопка **Engine #2** отправляет в `compiler.wasm` манифест `LPF1` со всеми тремя
файлами: проект компилируется целиком, во вкладке **WASM** — валидный модуль на
**1194 байта**. Если исполнить его в Node-хосте с `env.print`, вывод будет
другим, чем у движка №1:

```text
norm2 =
25
area =
12
```

Это не расхождение примера, а ABI: `print` в движке №2 вызывается **на каждый
аргумент**, поэтому каждая часть — отдельной строкой. `main()` возвращает `37` —
столько же, сколько в движке №1.

## 4. Что печатает `latentc bundle`

`latentc bundle main.lat bundle.lat` сливает модули в один исходник: `import` и
`export` удалены, имена манглены, `$` заменён на `__` (лексер selfhost не знает
`$`). Для проекта выше получается ровно такой файл (он компилируется и даёт те
же 1194 байта, что и проект):

```latent
fn main() -> int {
    let p = new m2__Point(3, 4);
    let c = m1__Circle(2);
    print("norm2 =", p.norm2());
    print("area =", m2__area(c));
    return (p.norm2() + m2__area(c));
}
fn m1__square(x: int) -> int {
    return (x * x);
}
fn m1__sum_squares(a: int, b: int) -> int {
    return (m1__square(a) + m1__square(b));
}
enum m1__Shape { m1__Circle(int), m1__Rect(int, int) }
class m2__Point {
    x: int;
    y: int;
    fn init(x: int, y: int) {
        (this.x = x);
        (this.y = y);
    }
    fn norm2() -> int {
        return (m1__square(this.x) + m1__square(this.y));
    }
}
fn m2__area(shape: m1__Shape) -> int {
    return (match shape { case m1__Circle(r): (3 * m1__square(r)), case _: 0 });
}
```

Как читать результат:

| В bundle | Откуда |
|---|---|
| `m0` = `main.lat` | индексы: сортировка по canonical path (`main` < `math` < `model`) |
| `m1__square`, `m2__Point` | `$` → `__`: имена после линковки, но в синтаксисе, понятном selfhost |
| `main` без префикса | `main` entry-модуля не манглятся: это экспорт WASM-модуля |
| `case _: 0` | `default:` из `area` напечатан как wildcard-паттерн |
| `(3 * m1__square(r))` | печать выражений расставляет скобки по приоритетам |
| `(this.x = x);` | присваивание полю печатается как выражение-инструкция |

Печать детерминирована: один и тот же проект всегда даёт один и тот же bundle,
поэтому его можно сравнивать побайтово в тестах и кэшировать.

## 5. Ошибки, которые вы увидите

Тексты ниже получены компилятором на этом же проекте (позиция — строка и
столбец объявления импорта):

| Что сломали | Сообщение |
|---|---|
| `import { sq } from "./math.lat";` (нет такого экспорта) | `main.lat:1:10: символ 'sq' не экспортирован из 'math.lat'` |
| `import { util } from "./lib/util.lat";` (нет файла) | `main.lat:1:1: файл не найден: lib/util.lat` |
| `import { square } from "math.lat";` (нет `./`) | `main.lat:1:1: путь импорта должен быть относительным ('./' или '../'): 'math.lat'` |
| два одинаковых импорта | `main.lat:2:10: дубликат импортированного имени 'square'` |
| импорт конфликтует с локальной `fn square` | `main.lat:1:10: имя 'square' уже объявлено в модуле` |
| `import` внутри функции | `main.lat: Ошибка парсинга на строке 2:5: ожидалось 'declaration (import/export допустимы только на верхнем уровне)', найдено Import` |

В CLI те же тексты печатаются с префиксом `error: ` и кодом возврата `1`. В web
IDE ошибка линковки приходит из движка №1 (английские тексты вида
`main.lat:1: module './lib/util.lat' not found (resolved to 'lib/util.lat').
Create the file in the workspace (＋) or fix the import path.`) — это диагностика
JS-резолвера, а не компилятора.

## 6. Цикл импорта

Циклы разрешены: линковка идёт по таблицам, а не по порядку исполнения. Файлы
ниже компилируются как один проект без ошибок:

```text
// a.lat
import { b } from "./b.lat";
export fn a(n: int) -> int { if (n <= 1) { return 1; } return n + b(n - 1); }

// b.lat
import { a } from "./a.lat";
export fn b(n: int) -> int { if (n <= 1) { return 0; } return a(n - 1); }

// main.lat
import { a } from "./a.lat";
fn main() -> int { return a(4); }
```

Ошибкой считается не цикл, а отсутствующий файл или неэкспортированное имя.

## 7. Повторить в CLI

```bash
# три файла в одном каталоге
latentc check main.lat              # ok: 1194 bytes of wasm
latentc compile main.lat app.wasm   # main.lat -> app.wasm (1194 bytes)
latentc bundle main.lat bundle.lat  # main.lat -> bundle.lat (N bytes)
```

`app.wasm` и `bundle.wasm` (результат компиляции bundle однофайловым путём)
совпадают побайтово — на этом проекте sha256 начинается с `5e66d6d2…`. Именно
это свойство и нужно selfhost-компилятору: он получает плоский bundle вместо
дерева файлов (см. [self-hosted компилятор](../specs/selfhost.md#модули-и-bundle)).

## 8. Связанные разделы

- [Файловые модули](../guide/modules.md) — синтаксис, линковка, ограничения.
- [CLI](../reference/cli.md#многофайловые-проекты) — команды и коды возврата.
- [Диагностики](../reference/errors.md#модули-и-линковка) — полный каталог.
- [Web IDE](../tooling/web-ide.md#модули-и-многофайловые-проекты) — как открыть
  проект в playground.
- [Разборы примеров](./index.md) — остальные примеры.
