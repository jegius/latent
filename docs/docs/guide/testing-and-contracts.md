---
title: Тесты и контракты
sidebar_label: Тесты и контракты
sidebar_position: 14
description: test-блоки, assert/assert_eq, snapshot, декораторы @forall/@ai_contract и реальное поведение в движках.
---

# Тесты и контракты

## `test`-блоки

```text
test "имя" { ... }
test("имя") { ... }
```

```latent
fn factorial(n: int) -> int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

test "factorial" {
    assert(factorial(5) == 120);
    assert_eq(factorial(0), 1);
}

test("arithmetic") {
    assert(2 + 2 == 4);
    assert_eq(2 * 3, 6);
}

fn main() -> int {
    assert(factorial(5) == 120);
    print("factorial(5):", factorial(5));
    return 0;
}
```

Правила:

- имя — строковый литерал (`test 42 { }` — ошибка);
- блоки объявляются на верхнем уровне;
- внутри доступны `assert(cond)` и `assert_eq(a, b[, msg])`;
- третье сообщение игнорируется кодогенератором движка №2;
- `test` не является функцией: вызвать его нельзя.

## Когда тесты исполняются

| Движок | Поведение |
|---|---|
| №1 (JS) | После возврата из `main` интерпретатор прогоняет все `test`-блоки; результаты складываются в `interpreter.testResults` (`{name, passed, error}`). Текущий UI web IDE их **не отображает**. |
| №2 (Rust → WASM) | Тело теста типизируется, но **не эмитится** в модуль: раннера тестов в WASM нет. |

Практический совет: для проверок, которые должны «упасть» заметно, используйте
`assert` в `main` или в вызываемой из него функции — тогда ошибка исполнения
(trap в движке №2, исключение в движке №1) проявится сразу.

## `assert` и `assert_eq`

```latent
fn main() -> int {
    let values = [1, 2, 3];
    assert(values.length == 3);
    assert_eq(values[0], 1);
    assert_eq(2 * 3, 6, "multiplication");
    return 0;
}
```

- `assert(false)` в движке №2 — trap `unreachable`;
- `assert_eq` в движке №2 сравнивает **i32-значения** для чисел, строки — по
  содержимому (`STR_EQ`), массивы — по указателям, float — по битам;
- в движке №1 `assert_eq` сравнивает структурно;
- `assert_ne`, `panic`, `exit` отсутствуют.

## `snapshot` и контракты (host-only)

```latent
// Не компилируется движком №2: snapshot/контракты требуют host-рантайма.
fn main() -> int {
    snapshot("demo");
    let c = ai_contract("ordering");
    enforce_contract(c);
    return 0;
}
```

| Конструкция | Тип | Движок №1 | Движок №2 |
|---|---|---|---|
| `snapshot(name)` | `bool` | запись значения | ошибка host-рантайма |
| `ai_contract(name)` | `Contract<String>` | объект-контракт | ошибка host-рантайма |
| `enforce_contract(c)` | `bool` | проверка | ошибка host-рантайма |

## Декораторы

```text
@имя(аргументы)? объявление
```

```latent
@forall("array")
fn non_empty_length(arr) {
    assert(arr.length >= 0);
}

fn main() -> int {
    return 0;
}
```

Известные имена: `@test`, `@forall`, `@snapshot`, `@ai_contract`,
`@enforce_contract` — это ключевые слова/мягкие слова, но **отдельной
семантики в Rust-компиляторе нет**: декоратор прозрачен для typechecker'а.

Важное следствие для движка №2: на верхнем уровне сканер компилятора видит
`Decorator`, а не `Fn`, поэтому **декорированная функция не регистрируется**:

```latent
// Не компилируется движком №2: декорированная функция не регистрируется.
@forall("x")
fn decorated() -> int {
    return 1;
}

fn main() -> int {
    return decorated();
}
```

Вызов даст `Unknown function: decorated`. Объявляйте функции без декоратора,
если их нужно вызывать.

## Ограничения движка №2

- Нет раннера тестов: `test`-блоки не исполняются.
- `assert` — trap; `assert_eq` — числа по i32-битам, строки по содержимому,
  массивы по указателям.
- `snapshot`/`ai_contract`/`enforce_contract` — ошибка host-рантайма.
- Декораторы над верхнеуровневыми `fn`/`class` делают цель недоступной.
- Вложенные `fn` (в том числе внутри `test`) не регистрируются.

## Отличия движка №1

- `test`-блоки действительно исполняются после `main`, но результаты видны
  только через API интерпретатора, не в UI.
- `assert_eq` сравнивает структурно (массивы, объекты).
- `@forall`/`@ai_contract` не ломают вызовы — декораторы в JS-движке
  игнорируются.

Дальше: [Память и низкий уровень](./memory-and-low-level.md).
