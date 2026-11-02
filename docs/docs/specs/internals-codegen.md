---
title: "Внутреннее устройство кодогена"
description: "Как Rust-компилятор Latent строит WASM: проходы, секции, пул строк, bump-аллокатор, runtime-хелперы, лямбды/таблица/call_indirect, классы (mangled-имена), enum-теги, void-значения, print-конверсии и известные дефекты."
sidebar_position: 5
---

# Внутреннее устройство кодогена

Источник истины: `src/codegen/`. Модуль собран вручную, байт-в-байт, без
`wasm-bindgen`/`wasm-encoder`.

## Карта файлов

| Файл | Ответственность |
|---|---|
| `bytecode.rs` | `ByteBuffer` (LEB128), константы опкодов/valtype |
| `module_builder.rs` | структура `WasmCodegen`, проходы сборки, регистрация функций, layout классов |
| `sections.rs` | эмиссия секций (exports, table, memory, global, element, code, data) |
| `memory.rs` | bump-аллокатор статической памяти и пул строковых констант |
| `context.rs` | `FuncContext` (локальные, статические типы), `ClassLayout`, `latent_to_wasm`/`StaticTy` |
| `compile_fn.rs` | тело функции: локальные, пролог захватов, завершение результата |
| `emit_stmt.rs` | инструкции (`let`/`if`/`while`/`for`/`return`/`spawn`/`select`/...) |
| `emit_expr.rs` | выражения, бинарные/унарные операторы, индексация, присваивания |
| `emit_call.rs` | вызовы: builtins, функции, конструкторы, методы, массивы, память |
| `emit_lambda.rs` | лямбды: регистрация, closure-конвертация, `call_indirect` |
| `emit_enum.rs` | enum-варианты и паттерны |
| `emit_match.rs` | `match` как цепочка `if/else` |
| `runtime_helpers.rs` | 9 рантайм-хелперов, эмитимых в WASM |

## Проходы

`WasmCodegen::compile` (`module_builder.rs`):

1. `write_header()` — магия `\0asm`, версия 1;
2. `collect_class_layouts` — размеры и смещения полей всех классов;
3. `collect_enum_variants` — теги вариантов (сначала встроенные
   `Ok/Err/Some/None`);
4. `collect_function_signatures` — типы и индексы всех пользовательских `fn`;
5. `collect_class_methods` — методы классов как функции `Class_method` с
   неявным `this`;
6. `collect_lambdas` — находит лямбды, регистрирует их как `__lambda_N`;
7. `register_helpers` — 9 рантайм-функций;
8. тела пользовательских функций;
9. тела методов классов;
10. тела лямбд;
11. тела хелперов;
12. `emit_exports`, `emit_sections`.

Порядок индексов функций: import (0) → пользовательские `fn` → методы →
лямбды → хелперы. Индекс функции = `import_count + func_count` на момент
регистрации, поэтому более поздние сущности сдвигаются при добавлении ранних.

## Статические типы (StaticTy)

Тайпчекер `Type` в кодоген не передаётся. Вместо этого кодоген вычисляет
best-effort `StaticTy` (`context.rs`): `Int`, `Float`, `Bool`, `Str`, `Array`,
`Fn`, `Unknown`.

- Для литерала числа: `Int`, если `n.fract() == 0.0`, иначе `Float`;
- `static_ty_of(expr)` (`emit_expr.rs`) — рекурсивная оценка: литералы,
  локальные (по `local_static` из аннотации), бинарные операции (строки →
  `Str`, float → `Float`, иначе `Int`), `len`/`int` → `Int`, `str` → `Str`,
  `float` → `Float`, вызовы — `fn_return_static` функции;
- `StaticTy::valtype()`: `Float` → `f64`, всё остальное → `i32`.

Ошибки этой модели — главный источник невалидного WASM (см.
[дефекты](#известные-дефекты)).

## Локальные переменные

`FuncContext` (`context.rs`) хранит для каждого локального:

- `locals: HashMap<name, (index, wasm_valtype)>`;
- `local_types: Vec<u8>` — фактический WASM-тип слота;
- `local_static: Vec<StaticTy>` — для выбора инструкций;
- `local_class: Vec<Option<String>>` — имя класса (для полей/методов).

`let` без аннотации получает тип из `static_ty_of(value)`, с аннотацией — из
`latent_to_wasm`. `write_locals` группирует подряд идущие локальные одного типа
в `[count][valtype]`-серии (после параметров).

## Секции

Порядок: type(1), import(2), func(3), table(4 — только при лямбдах),
memory(5), global(6), export(7), element(9 — только при лямбдах), code(10),
data(11). Подробный контракт — в [WASM ABI](../reference/wasm-abi.md).

- `memory`: 16 страниц (`memory_pages = 16`), без max;
- `global 0`: `(mut i32)` = `memory_offset` на момент эмиссии секций —
  старт кучи после статических данных;
- `export`: `memory` всегда; `main` — если функция существует;
- table/element: только если `lambdas` непуст; слот = индекс функции,
  element-сегмент перечисляет все функции `0..total_funcs`.

## Пул строк и bump-аллокатор

`memory.rs`:

- `alloc_memory(size, align)` выравнивает `memory_offset` и двигает его;
- `add_string(text)` дедуплицирует по содержимому, кладёт данные в
  data-секцию: активный сегмент `[len u32 LE][utf8]` по адресу `addr`,
  возвращает адрес. Стартовое значение `memory_offset` = 1024.
- Куча начинается после всех литералов (глобал), растёт через
  `__latent_alloc` (bump + `memory.grow`), память не переиспользуется.

## Runtime-хелперы

`runtime_helpers.rs` регистрирует функции (имена в комментариях README —
`__latent_*`):

| Хелпер | Сигнатура | Что делает |
|---|---|---|
| `__latent_alloc` | `(i32)->i32` | bump, `memory.size/grow` |
| `__latent_mem_copy` | `(i32,i32,i32)` | побайтовый `loop` c `load8_u`/`store8` |
| `__latent_str_len` | `(i32)->i32` | `i32.load` заголовка |
| `__latent_str_concat` | `(i32,i32)->i32` | alloc(len_a+len_b+4), 2×memcopy |
| `__latent_str_eq` | `(i32,i32)->i32` | сначала указатели, затем длина, затем байты |
| `__latent_str_char_at` | `(i32,i32)->i32` | байт или `-1` |
| `__latent_i32_to_str` | `(i32)->i32` | десятичное представление, минус |
| `__latent_f64_to_str` | `(f64)->i32` | `<int>.<6 цифр>` |
| `__latent_str_to_i32` | `(i32)->i32` | ASCII-парсер с `-`, стоп на нецифре |

Тела хелперов пишутся вручную теми же `ByteBuffer`/опкодами; `f64_to_str`
использует отдельный набор локальных (i32 + f64).

## Классы

- Layout: `float`-поле → 8 байт (`f64`), остальные → 4 (`i32`); каждое поле
  выравнивается по своему размеру; итоговый размер — по 4.
- Методы: имя манглятся как `ИмяКласса_имяМетода`; первый параметр — `this`
  типа класса (добавляется в `collect_class_methods`).
- `obj.method(args)` (`emit_call.rs`): имя класса выводится
  `infer_class_name` (локальная с классом, `this`, `new Class`); затем прямой
  вызов `Class_method(obj, args...)`.
- `new Class(args)`: alloc(layout.size) через глобал кучи → компиляция
  аргументов → вызов `Class_init`/`Class_new`, если найден → результат —
  указатель.
- Доступ к полю — `obj + offset` + `i32.load`/`f64.load`; присваивание —
  `i32.store`/`f64.store`; выражение присваивания оставляет значение.

## Enum

`emit_enum.rs`:

- 0-арный вариант — значение-тег (`i32.const tag`);
- n-арный — `alloc(4+4n)`, в `[0]` tag, далее поля через `i32.store` (поэтому
  float-payload ломается);
- `match` по конструктору — `emit_constructor_test`: сравнение `i32.load(scrut)`
  с тегом; для 0-арных — сравнение значения; связывание полей —
  `bind_constructor_fields`;
- таблица вариантов — `HashMap<имя_варианта, (tag, arity)>`, глобальная для
  модуля; встроенные регистрируются `entry().or_insert`, пользовательские —
  `insert` (перетирают).

## Лямбды и замыкания

`emit_lambda.rs`:

1. `collect_lambdas` обходит программу; для каждой лямбды сохраняет параметры,
   тело, захваченные имена (`locals` из парсера, отфильтрованные от имён
   функций);
2. лямбда регистрируется как `__lambda_N` с каноническим типом
   `(env i32, params…) -> i32` (тип дедуплицируется `add_func_type_cached`);
3. при вычислении лямбды (`compile_lambda`): `env = alloc(4*n)`, копирование
   захватов, `closure = alloc(8)`, `[0]=table_slot(=func_idx)`, `[4]=env`;
4. вызов (`compile_indirect_call`): на стек `env, args…, table_slot`,
   `call_indirect` с типом `(i32 env, i32…) -> i32`.

Результат всегда `i32`, поэтому лямбда, возвращающая float, даёт
несогласованный модуль (дефект).

## `match`

`emit_match.rs` компилирует match как вложенные `if/else` с блоком типа
`i32`:

- scrutinee сохраняется в локальную;
- wildcard — сразу тело;
- identifier — связывает значение и выполняет тело;
- литерал — сравнение (`i32.eq`/`f64.eq`/`str_eq`) + `if/else`;
- конструктор — `emit_constructor_test` + связывание полей.

Нет ветки — `else`-ветвь оставляет `0`. Ветка `default` компилируется как
wildcard.

## `void` и значения

- `body_returns_value` (в `module_builder.rs`) рекурсивно ищет `return expr`
  в теле — от этого зависит, получит ли функция результат `i32` без аннотации.
- `compile_fn`: `has_result = ret_ty.is_some() || body_returns_value`; если
  результат объявлен, а тело не заканчивается `RETURN`, дописывается
  `i32.const 0` (или `f64.const 0`).
- `expr_produces_value` (`emit_expr.rs`) сообщает, оставляет ли выражение
  значение: `print`/`assert`/`assert_eq`/`store8`/`store32`/`memcopy` и
  void-функции — нет; иначе — да. В позиции инструкции лишнее значение
  снимается `drop`.

## `print`-конверсии

`compile_direct_call("print", args)`:

- для каждого аргумента: `compile_expr(arg)`;
- по `static_ty_of(arg)`: `Str` — без конверсии, `Float` —
  `__latent_f64_to_str`, иначе — `__latent_i32_to_str`;
- затем `call env.print` (на каждый аргумент отдельный вызов).

Поэтому `print(true)` печатает `1`, `print(null)` — `0`, а строки из
`.to_str()` могут печататься как адрес (тип результата метода не отслеживается).

## Известные дефекты

См. подробную таблицу в
[диагностиках](../reference/errors.md#известные-ограничения-движка-2-компилируется-но-невалидный-wasm). Кратко:
float-литералы с нулевой дробной частью эмитятся как `i32.const`, что ломает
f64-контекст; `%` всегда `i32.rem_s`; `sqrt` над int-литералом; float-поля
классов и enum-payload; `new Class` без `init`; результат лямбды всегда `i32`;
поставляемый `compiler.wasm` не содержит memory-builtins.

## Как расширять кодоген

Новая конструкция обычно требует изменений в цепочке:

1. `src/parser/…` (новая продукция);
2. `src/ast/…` (узел AST);
3. `src/typechecker/infer/…` (тип);
4. `src/codegen/emit_*.rs` (эмиссия);
5. `src/codegen/module_builder.rs` (если нужен новый проход/таблицы);
6. `tooling/language-data/language.json`, selfhost, доки, тесты.

Подробный чек-лист — в [contributing](../tooling/contributing.md).

## Связанные разделы

- [WASM ABI](../reference/wasm-abi.md) — раскладка памяти.
- [Карта инструкций](./bytecode.md) — какие опкоды используются.
- [Движки](./engines.md), [selfhost](./selfhost.md).
