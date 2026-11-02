---
title: "Встроенные функции и методы"
description: "Все builtins Latent с точными сигнатурами, семантикой по движкам, ограничениями и примерами: print, len, push, pop, str/int/float, sqrt, assert, assert_eq, память, конструкторы; отдельно host-only функции."
sidebar_position: 6
---

# Встроенные функции и методы

Источники: `src/codegen/emit_call/{mod,direct,method,constructors,array}.rs`
(движок №2), `src/typechecker/infer/expr/{mod,call,effects}.rs`
(типы builtins), `web-ide/compiler/interpreter-builtins.js` и
`web-ide/compiler/value-utils.js` (движок №1).

Столбец «Движок»: **№2** — Rust→WASM, **№1** — JS-интерпретатор, **оба** —
работает в обоих. Host-only (AI, тензоры, каналы, контракты) движок №2
сознательно отвергает с сообщением «требует host-рантайма» (точные тексты — в
[диагностиках](./errors.md#кодоген)).

## Краткая таблица

| Функция/метод | Сигнатура | Движок | Итог |
|---|---|---|---|
| `print` | `print(value, ...)` | оба | вывод в stdout/host; в №2 каждый аргумент — отдельной строкой |
| `len` | `len(array) -> int`, `len(string) -> int` | оба | длина из заголовка `[len u32]` |
| `push` | `push(array, value)` | оба | добавляет элемент; в №2 оставляет массив на стеке |
| `str` | `str(x) -> string` | только №2 | конверсия в строку |
| `int` | `int(x) -> int` | только №2 | строка → число, float → усечение |
| `float` | `float(x) -> float` | только №2 | int/строка → float |
| `sqrt` | `sqrt(x) -> float` | только №2 | `f64.sqrt`; валиден в f64-контексте, при использовании как int — невалидный WASM |
| `assert` | `assert(cond)` | оба | прерывает исполнение при лжи |
| `assert_eq` | `assert_eq(a, b)` | оба | в №2 — `i32` для чисел, содержимое для строк; trap при несовпадении |
| `alloc` | `alloc(size) -> ptr` | №2 | bump-аллокатор рантайма |
| `load8` | `load8(addr) -> int` | №2 | беззнаковый байт |
| `store8` | `store8(addr, value)` | №2 | запись младшего байта |
| `load32` | `load32(addr) -> int` | №2 | 32-битное слово |
| `store32` | `store32(addr, value)` | №2 | запись слова |
| `memcopy` | `memcopy(dst, src, len)` | №2 | побайтовое копирование |
| `channel` | `channel()` / `channel<T>()` | host | создание канала (только №1) |
| `Ok/Err/Some/None` | конструкторы вариантов | оба | встроенные варианты enum |
| `new Class` | `new Class(args)` | оба | создание экземпляра |
| `.push(x)` | `arr.push(x)` | оба | метод массива |
| `.pop()` | `arr.pop() -> T` | оба | метод массива |
| `.length` / `.length()` | `-> int` | оба | массив или строка |
| `.to_str()` / `.toString()` | `-> string` | только №2 | конверсия в строку |
| `.to_int()` / `.toInt()` | `-> int` | только №2 | конверсия в int |
| `ai_infer` и др. | см. [AI-рантайм](../specs/ai-runtime.md) | host | только №1 |

## `print`

```text
print(value, ...) -> unit
```

- **Движок №2**: каждый аргумент компилируется отдельно и передаётся в
  импорт `env.print(i32)` — это **отдельный вызов на аргумент**, поэтому
  `print("x =", x)` печатает две строки (`x =` и число), а не одну. Не-строковые
  аргументы конвертируются в строку по статическому типу: `float` — через
  `f64_to_str` (6 знаков после точки), `int`/`bool`/`null` — через
  `i32_to_str`; массивы и замыкания конвертируются как числа-указатели.
- **Движок №1**: аргументы форматируются (`formatValue`) и склеиваются через
  пробел в одну строку: `print("x =", 42)` → `x = 42`; `null` → `null`,
  `true` → `true`; массивы → `[1, 2, 3]`; тензоры → `Tensor(shape=...,
  data=...)`.

```latent
fn main() -> int {
    print("value:", 42);
    return 0;
}
```

## `len`

```text
len(array) -> int
len(string) -> int
```

Читает первое слово данных (`i32.load`): у массива — число элементов, у
строки — длину в байтах. Арность встроенных функций проверяется тайпчекером
(кроме вариативного `print`): вызов `len()` без аргумента теперь даёт
ошибку «Несовпадение арности … ожидалось N аргументов, найдено M» с позицией.

```latent
fn main() -> int {
    print(len([10, 20, 30]));   // 3
    print(len("latent"));       // 6 (байты UTF-8)
    return 0;
}
```

## `push` и `pop`

```text
push(array, value) -> array   // движок №2 оставляет массив на стеке,
                              // тайпчекер считает результат unit
arr.push(value) -> array
arr.pop() -> T
```

`arr.push(x)` в движке №2: `arr[len] = x; arr.len = len + 1;` — массив
мутируется, на стеке остаётся указатель. `arr.pop()` уменьшает длину на 1 и
возвращает последний элемент. **Границы не проверяются**: `pop()` на пустом
массиве читает `arr[-1]` (порча памяти), `push` на строке компилируется и
пишет в строку.

```latent
fn main() -> int {
    let a = [1, 2];
    a.push(3);
    let last = a.pop();
    print(last);          // 3
    print(a.length);      // 2
    return last;
}
```

Функциональная форма `push(a, v)` работает как `a.push(v)`; в движке №2 при
одном аргументе — ошибка `push expects (array, value)`. Функции `pop(a)` нет —
только метод.

## Приведение типов: `str`, `int`, `float`, `sqrt`

**Только движок №2** — в движке №1 этих имён нет («Undefined function 'str'»).

```text
str(x) -> string
int(x) -> int
float(x) -> float
sqrt(x) -> float
```

- `str(x)`: строка — как есть; `float` → `__latent_f64_to_str` («1.500000»);
  остальное → `__latent_i32_to_str`. Без аргумента — ошибка арности.
  `f64_to_str` считает целую часть через `i32.trunc_f64_s`, поэтому
  `str(1e300)` (и вообще `|x| ≥ 2^31`) в рантайме даёт trap.
- `int(x)`: строка — парсинг ASCII-числа с опциональным `-`
  (`__latent_str_to_i32`), float — `i32.trunc_f64_s` (усечение к нулю), int —
  как есть.
- `float(x)`: float — как есть; строка — парсинг в int и `f64.convert_i32_s`
  (дробная часть строки не разбирается); int — `f64.convert_i32_s`.
- `sqrt(x)`: приводит операнд к f64 (если не float) и применяет `f64.sqrt`.
  Валиден в f64-контексте: `fn f() -> float { return sqrt(16); }` и
  `let x: float = sqrt(16);` работают. Но статический тип вызова отслеживается
  как `Int`, поэтому `print(sqrt(16))` и `int(sqrt(16))` дают **невалидный
  WASM** (см. ниже).

```latent
fn main() -> int {
    print(str(42));       // 42
    print(int("42"));     // 42
    print(int(3.9));      // 3
    return 0;
}
```

## `assert`, `assert_eq`

```text
assert(cond)                // движок №2: если cond == 0 -> unreachable (trap)
assert_eq(a, b)             // движок №2: i32.eq, при несовпадении -> trap
assert(cond, msg?)          // движок №1: сообщение в исключении
assert_eq(a, b, msg?)       // движок №1: структурное равенство
```

- Движок №2: `assert` проверяет «ненулевость» (`i32.eqz` + `if` +
  `unreachable`); `assert_eq` сравнивает числа как i32, строки — по
  содержимому (`STR_EQ`), массивы — по указателям; второй
  аргумент-сообщение **игнорируется**.
- Движок №1: `assert` использует truthiness, `assert_eq` — глубокое
  структурное равенство; при провале бросается исключение
  `assertion failed` / `assert_eq failed: a != b` (сообщение включается).

```latent
fn main() -> int {
    assert(1 + 1 == 2);
    assert_eq(2 * 3, 6);
    return 0;
}
```

## Примитивы линейной памяти (только движок №2)

```text
alloc(size) -> int
load8(addr) -> int
store8(addr, value)
load32(addr) -> int
store32(addr, value)
memcopy(dst, src, len)
```

Это небезопасные операции без проверки границ; добавлены для self-hosting
(самим компилятором Latent на Latent они используются для записи байтов WASM —
см. `selfhost/src/10_buffer.lat`). Исходники — `src/codegen/emit_call/direct.rs`
(`compile_memory_builtin`). Подробности раскладки и аллокатора —
в [WASM ABI](./wasm-abi.md#память-и-аллокатор).

```latent
fn main() -> int {
    let p = alloc(8);
    store8(p, 65);          // p[0] = 65 ('A')
    store32(p + 4, 12345);  // p[4..8] = 12345, little-endian
    print(load32(p + 4));   // 12345
    memcopy(p + 8, p, 4);   // копия 4 байт
    print(load8(p + 8));    // 65
    return 0;
}
```

:::note
Memory-builtins **есть в поставляемой сборке** `web-ide/compiler.wasm`
(651 473 байт, собрана из текущего `src/`): пример выше компилируется в валидный
WASM и печатает `12345`, затем `65`. Если вы взяли более старый артефакт
(например, копию из `editors/idea/src/main/resources/runner/`), `alloc` даст
«Неопределённая переменная 'alloc'» — пересоберите, см.
[tooling/bootstrap](../tooling/bootstrap.md).
:::

## Конструкторы

- `Ok(v)`, `Err(e)`, `Some(v)`, `None` — встроенные варианты, доступные без
  объявления enum. Теги: `Ok`/`Some` = 0, `Err` = 1, `None` = 0-арный.
  Карта вариантов **глобальная по имени** (`enum_variants` в
  `src/codegen/module_builder/mod.rs`), поэтому пользовательский вариант с именем
  `Some` переопределит встроенный.
- `new Class(args)`:
  - выделяет `size` из layout класса в куче (bump-аллокатор),
  - компилирует аргументы,
  - если у класса есть метод `init` (или `new`), вызывает его с неявным `this`,
  - возвращает указатель на экземпляр.
  Если `init` нет, аргументы остаются на стеке WASM, а результат `new`
  оказывается неопределённым — **класс без `init` может дать невалидный
  модуль**. В движке №1 `new` без `init` просто создаёт экземпляр (поля `null`).

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
    return p.norm2();
}
```

## Методы значений

| Метод | Движок №2 | Движок №1 |
|---|---|---|
| `arr.length`, `arr.length()` | `i32.load` заголовка | то же (JS-массив) |
| `str.length`, `str.length()` | `i32.load` (байты UTF-8) | длина JS-строки (UTF-16) |
| `arr.push(x)` | ✅ | ✅ |
| `arr.pop()` | ✅ (без проверки пустоты) | ✅ |
| `str.len` | ❌ («Unknown class») | ✅ (`len` как свойство) |
| `x.to_str()`, `x.toString()` | ✅, но результат не помечен как строка: при `print` может напечатать указатель | ❌ «Unknown method 'to_str'» |
| `s.to_int()`, `s.toInt()` | ✅ | ❌ |
| `str.upper()`, `str.lower()` | ❌ | ✅ |
| `ch.send/recv/try_recv/len` | ❌ host-only | ✅ |
| `t.data/shape/rank/size/reshape` | ❌ host-only | ✅ (тензоры) |

Классовые методы вызываются как `Class_method(obj, args)`; в движке №2 для
корректного определения класса объект должен быть локальной переменной с
известным классом (аннотация, `new Class`, `this` или параметр-класс). Вызов
метода на временном значении (`new A(5).get()`) даёт
«Метод 'get' не поддерживается движком №2».

```latent
fn main() -> int {
    let s = "hello";
    print(s.length);        // 5
    print(s.length());      // 5
    print(s[1]);            // 101 — байт 'e'
    return 0;
}
```

## Host-only builtins (движок №1 / AI-гейтвей)

Движок №2 отвергает их с ошибкой компиляции. Полная семантика — в
[AI-рантайме](../specs/ai-runtime.md).

| Имя | Сигнатура (по движку №1) | Текст ошибки движка №2 |
|---|---|---|
| `tensor` | `tensor(data) -> Tensor` | `Builtin 'tensor' не поддерживается движком №2 (требует host-рантайма)` |
| `semantic` | `semantic(text) -> Semantic` | то же с `'semantic'` |
| `matmul` | `matmul(a, b) -> Tensor` | `'matmul'` |
| `cosine_similarity` | `(a, b) -> float` | `'cosine_similarity'` |
| `dot` | `(a, b) -> float` | `'dot'` |
| `magnitude` | `(v) -> float` | `'magnitude'` |
| `zeros`, `ones` | `(n) -> Tensor` | `'zeros'` / `'ones'` |
| `snapshot` | `snapshot(name) -> bool` | `'snapshot'` |
| `ai_contract` | `ai_contract(name) -> Contract` | `'ai_contract'` |
| `enforce_contract` | `enforce_contract(c) -> bool` | `'enforce_contract'` |
| `ai_infer` | `ai_infer(model, prompt) -> string` | `'ai_infer'` |
| `ai_embed` | `ai_embed(text) -> [float]` | `'ai_embed'` |
| `ai_stream` | `ai_stream(model, prompt) -> int` | `'ai_stream'` |
| `stream_next` | `stream_next(handle) -> string\|null` | `'stream_next'` |
| `channel` | `channel()` / `channel<T>()` | `'channel'` |
| `ch.send/recv/...` | метод | `Метод 'send' не поддерживается движком №2 (требует host-рантайма)` |

В движке №1 дополнительно есть вспомогательные builtins, которых нет в №2:
`range(n)`, `unwrap(v)`, `unwrap_or(v, default)`, `is_ok(v)`, `is_err(v)`,
`is_some(v)`. Они не задокументированы как часть языка — используйте
осторожно.

## Чего нет среди builtins

`abs`, `min`, `max`, `floor`, `ceil`, `round`, `pow`, `random`, `time`, `sleep`,
`input`, `read_file`, `assert_ne`, `panic`, `exit`, `range`, `map`/`filter`/
`reduce`, `split`, `substring`, `contains`, `keys`/`values`, `to_string` —
не существуют (есть `str` и `.to_str()`). `range` есть только в движке №1 как
вспомогательный builtin.

Важно: **builtin имеет приоритет над пользовательской функцией с тем же
именем** — `fn len(a) -> int { return 99; }` не переопределит `len`:
`len([1,2,3])` даст `3`. Не называйте свои функции именами builtins.

## Ограничения и известные дефекты

- `sqrt`: валиден только в **f64-контексте** (`fn f() -> float { return
  sqrt(16); }`, `let x: float = sqrt(16);`). Любое использование, где
  результат трактуется как `int` (`print(sqrt(16))`, `print(sqrt(16.0))`,
  `print(sqrt(2.25))`, `int(sqrt(16))`), даёт **невалидный WASM** — статический
  тип вызова `sqrt` не отслеживается.
- `print` в движке №2 печатает `bool` как `1`/`0`, `null` как `0`, массивы —
  как числа-указатели. Для читаемого вывода используйте строковые конверсии
  или печатайте элементы по одному.
- `str`/`int`/`float`/`sqrt` не существуют в движке №1 — код с ними не
  выполнится в IDE по умолчанию (только через Engine #2, который не исполняет
  программу).
- Функциональный `push` возвращает массив на уровне кода, но тайпчекер
  объявляет результат `unit` — не полагайтесь на возвращаемое значение в
  типизированном коде.

## Связанные разделы

- [AI-рантайм](../specs/ai-runtime.md) — host-функции подробно.
- [WASM ABI](./wasm-abi.md) — представление строк/массивов/классов.
- [Диагностики](./errors.md) — точные тексты ошибок кодогена.
