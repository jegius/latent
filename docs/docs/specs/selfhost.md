---
title: "Self-hosted компилятор"
description: "Архитектура компилятора Latent, написанного на самом Latent: части src/*.lat, ABI компилятора (INPUT_ADDR/OUTPUT_ADDR), сборка shc.lat, bootstrap-цепочка stage1/2/3, фиксированная точка, memory-примитивы и ограничения подмножества."
sidebar_position: 1
---

# Self-hosted компилятор (`selfhost/`)

`selfhost/` — компилятор Latent→WebAssembly, **написанный на самом Latent**.
Он собирает сам себя до фиксированной точки: `stage2 === stage3` побайтово.

Источники истины: `selfhost/README.md`, `selfhost/build.mjs`,
`selfhost/bootstrap.mjs`, `selfhost/src/*.lat`. Часть утверждений ниже —
из README и из кода сборки; где факт не проверялся исполнением, это отмечено.

## Статус (по `selfhost/README.md`)

- **Фиксированная точка достигнута**: компилятор, собранный собой,
  воспроизводит себя побайтово (`stage2 === stage3`).
- `shc.lat` компилирует подмножество языка: рекурсия, циклы (в т.ч. `for-in`),
  строки (конкатенация, равенство, индексация, длина), массивы
  (литерал/индексация/`push`/`pop`), `str`/`int`/`to_str`/`to_int`,
  `assert`/`assert_eq`, короткое замыкание `&&`/`||`, линейная память.
- Регресс-набор — `selfhost/test/*.test.mjs` (`node --test`). README говорит о
  85 тестах; число меняется по мере развития — сверяйтесь с README и тестами.

## Структура: один файл, собираемый из частей

У Latent нет системы модулей и импортов: программа компилируется как **один
файл**. Поэтому «линковка» — детерминированная конкатенация частей в порядке
имён (`selfhost/build.mjs`):

```text
selfhost/src/00_abi.lat      карта линейной памяти, слоты состояния
selfhost/src/10_buffer.lat   байтовые буферы [len u32][bytes], LEB128
selfhost/src/20_lexer.lat    исходник → параллельные массивы токенов
selfhost/src/30_syntax.lat   курсор токенов, локальные, таблицы имён
selfhost/src/35_class.lat    классы (поля/методы), enum-варианты
selfhost/src/36_lambda.lat   лямбды/захваты, closure/env
selfhost/src/40_emit_expr.lat эмиссия выражений (Pratt), вызовы
selfhost/src/45_typecheck.lat тайп-чекер, буфер ошибки
selfhost/src/50_stmt.lat     эмиссия инструкций
selfhost/src/60_func.lat     сборка одного тела функции
selfhost/src/70_module.lat   сборка секций WASM-модуля
selfhost/src/90_driver.lat   точка входа: полный проход компиляции
```

```text
shc.lat = BANNER + join(sorted(src/*.lat), разделитель)
```

Сборка идемпотентна: один набор частей всегда даёт один и тот же `shc.lat`.
**Редактировать `shc.lat` вручную нельзя** — он генерируется.

```bash
node selfhost/build.mjs     # src/*.lat -> shc.lat
```

## ABI компилятора

Контракт «хост → компилятор-as-WASM» (`selfhost/bootstrap.mjs`):

| Адрес | Назначение |
|---:|---|
| `3145728` (`INPUT_ADDR`, 3 МиБ) | вход: `[len u32 LE][utf8-исходник]` |
| `65536` (`OUTPUT_ADDR`) | выход: `[len u32 LE][wasm-байты]` |

- Хост обязан **нарастить память** до `INPUT_ADDR + 4 + len` перед записью
  исходника (`memory.grow`): компилятор растит память только внутри `main()`
  (через `alloc(4600000)` в `compile_program`).
- `main()` компилятора возвращает длину выходного WASM.
- При ошибке компиляции возвращается **отрицательное** число, а по адресу
  `OUTPUT_ADDR+4` лежит `[len u32 LE][utf8-текст ошибки]`.
- Вход вынесен в отдельную высокую область, потому что при исходнике >32K его
  хвост перекрывал `OUTB`, который `binit()` зануляет на старте (это ломало
  последние токены). См. комментарии в `00_abi.lat` и `bootstrap.mjs`.

```js
// bootstrap.mjs (упрощённо)
const need = Math.ceil((INPUT_ADDR + 4 + enc.length) / 65536);
if (need > have) inst.exports.memory.grow(need - have);
new DataView(memory.buffer).setUint32(INPUT_ADDR, enc.length, true);
new Uint8Array(memory.buffer).set(enc, INPUT_ADDR + 4);
const ret = inst.exports.main();
const len = new DataView(memory.buffer).getUint32(OUTPUT_ADDR, true);
const wasm = new Uint8Array(memory.buffer).slice(OUTPUT_ADDR + 4, OUTPUT_ADDR + 4 + len);
if (ret < 0) throw new Error(`compile error: ${new TextDecoder().decode(wasm)}`);
```

Это **другой** ABI, чем у компилятора-as-WASM в web IDE
(`latent_alloc/latent_compile`, [WASM ABI](../reference/wasm-abi.md#c-abi-компилятора-движок-2-в-браузере)):
не путайте.

## Сборка и bootstrap-цепочка

```bash
# 1. нативный latentc (Rust) — им собирается stage1
cargo build --bin latentc

# 2. цепочка
node selfhost/bootstrap.mjs
```

Что делает `bootstrap.mjs`:

1. `latentc` (Rust) компилирует `selfhost/shc.lat` → `selfhost/stage1.wasm`;
2. `stage1.wasm` компилирует `selfhost/shc.lat` → `selfhost/stage2.wasm`
   (self-compiled);
3. `stage2.wasm` компилирует `selfhost/shc.lat` → `selfhost/stage3.wasm`;
4. проверяется `stage2 === stage3` — фиксированная точка.

Каждый stage проверяется `WebAssembly.validate`. Путь к `latentc` можно задать
переменной окружения `LATENTC` (по умолчанию
`target/debug/latentc`).

## Что компилирует self-hosted компилятор

По `selfhost/README.md` (и по коду частей):

| Область | Поддержка |
|---|---|
| `let`/`if`/`else`/`while`/`for`/`for-in`/`return` | ✅ |
| арифметика, сравнения, битовые, сдвиги | ✅ |
| `&&`/`\|\|` с коротким замыканием | ✅ |
| массивы: литерал, `[]`, `.length`, `push`, `pop`, `len` | ✅ |
| строки: `+`, `==`/`!=`, `s[i]`, `len` | ✅ |
| `str`/`int`/`to_str`/`to_int` | ✅ |
| `assert`/`assert_eq` | ✅ |
| классы: `class`, поля, `this`, методы, `new` | ✅ |
| enum: варианты (теги + payload) | ✅ |
| `match`/`case` (литералы, `_`/`default`, конструкторы) | ✅ |
| замыкания: `fn(x) => expr`, `fn(x) { ... }`, захваты, `call_indirect` | ✅ |
| тайп-чек: аннотации, возвраты, арность, условия, присваивания | ✅ |
| ошибки: текст вместо WASM (отрицательный результат) | ✅ |
| float: литералы `1.25`, `+ - * /`, сравнения, `int(float)` | ✅ (см. ниже) |
| `float`-возврат, float-локальные, `sqrt`, `float(x)`, `str(float)` | ✅ |
| смешанная арифметика `int ⊕ float` (повышение int→f64) | ✅ (сверх эталона) |
| `spawn`/`select`/`await`/AI | ❌ (host-рантайм; в эталоне — no-op/ошибка) |
| `float`-параметры `fn f(r: float)` | ❌ (в эталоне тоже невалидно) |

**Float без IEEE754-битов.** Литерал `I.F` эмитится как f64-арифметика
`I + F/10^k` (int→f64 через `f64.convert_i32_s`) — компилятору не нужна
64-битная мантисса в i32-коде. Целочисленно-значные литералы (`2.0`)
сворачиваются в int, как в эталоне. По README, selfhost — строгое надмножество
Rust-компилятора по float: `int(2.5 * 4.0)`, `int(sqrt(16.0))`,
`let x: float = 2.5`, `str(2.5)`, `2 < 2.5`, `1 + 0.5` дают валидный WASM и
верный результат, тогда как `latentc` на них падает с невалидным WASM.

## Устройство прохода компиляции

`selfhost/src/90_driver.lat` (`compile_program`):

1. `alloc(4600000)` — гарантировать рост памяти под все области;
2. `binit(...)` — обнулить все буферы (OUTB, SCRB, FNB, CODEB, BODYC, DATAB);
3. сбросить слоты состояния (статус, счётчики классов/вариантов/лямбд);
4. `tokenize()` — параллельные массивы: `KIND`, `TVAL`, `TLEN` (тип токена,
   значение/оффсет, длина); терминатор — kind 0;
5. `scan_classes()`, `scan_enums()`, `scan_signatures()`, `scan_lambdas()`,
   `register_lambdas()` — таблицы первого прохода;
6. `tc_program()` — тайп-чек; при ошибке текст пишется в `ERRB`/`OUTB`,
   возвращается `-len` (отрицательный результат);
7. `compile_fn(i)` для каждой функции, `compile_lambda(li)`;
8. `helper_bodies()` — 8 рантайм-хелперов;
9. `build_module()` — секции WASM;
10. вернуть `blen(OUTB())` — длину модуля.

### Карта памяти компилятора (`00_abi.lat`)

Все области — фиксированные адреса, выровненные по 4/16/32K. Основные:

| Область | Адрес | Размер |
|---|---:|---:|
| `INPUT` — вход | 3 145 728 | 128K |
| `OUTB` — выходной WASM | 65 536 | 192K |
| `SCRB` — скретч секции | 262 144 | 192K |
| `FNB` — тело текущей функции | 458 752 | 192K |
| `BODYC` — финальное тело | 655 360 | 192K |
| `CODEB` — все тела | 851 968 | 384K |
| `KIND`/`TVAL`/`TLEN` — токены | 1 245 184 … | по 256K |
| таблицы функций/локальных | 2 031 616 … | по 32K |
| `ST` — слоты состояния | 2 260 992 | 256 |
| `CODEOF`/`CODELN` — тела | 2 261 248 / 2 293 760 | 32K |
| `DATAB` — данные/строки | 2 326 528 | 256K |
| `STRO`/`STRL`/`STRA` — строки | 2 588 672 … | по 128K |
| таблицы классов/методов/enum/лямбд | 3 407 872 … 4 308 992 | — |
| таблицы тайп-чекера, `ERRB` | 4 313 088 … 4 547 072 | — |

Слоты состояния: `0=PC 1=NT 2=NF 3=NL 4=status 5=produces 6=NS(strings)
7=TS`; доступ через `get(st, k)`/`set(st, k, v)` = `load32/store32`.

### Выходной модуль

`70_module.lat` собирает модуль так же, как Rust-кодоген, но с фиксированными
типами:

- секция типов: 20 типов — `(i32)->void` (idx0), `(i32×arity)->i32` (idx1..9),
  `(i32×arity)->f64` (idx10..18), `(f64)->i32` (idx19, для `f64_to_str`);
- одна импортная функция `env.print (i32)->void` (индекс 0);
- 8 рантайм-хелперов: `alloc`, `memcopy`, `str_concat`, `str_eq`,
  `str_char_at`, `i32_to_str`, `str_to_i32`, `f64_to_str` (все — `i32`-функции,
  кроме `f64_to_str`);
- память: **16 страниц**, без max;
- глобал `heap` = `1024 + len(DATAB)` (стартовое значение после данных);
- экспорты: `memory` и `main` (индекс `find_main()+1`);
- таблица/element-секции — только если есть лямбды; слот = индекс функции;
- данные: строковые литералы `[len u32][utf8]`.

## Ограничения подмножества

- **Нет модулей/импортов** — только один файл (поэтому и возможна склейка
  частей).
- **Нет `spawn`/`select`/`await`/`channel`/`yield`** — лексер selfhost вообще
  не знает этих ключевых слов (его `kw_code` содержит только
  `let fn if else while return for in true false class new this match enum case
  default`).
- **Нет AI-примитивов** и `tensor`/`semantic`.
- **Строки**: лексер selfhost не обрабатывает escape-последовательности (он
  просто копирует байты между кавычками); `\n` в литерале не превращается в
  перевод строки — этим selfhost отличается от Rust-компилятора.
- **Нет экспоненты в числах** и нет ошибки на неизвестный символ: лексер
  selfhost молча пропускает нераспознанные символы (`i = i + 1`).
- **Нет `async`/`await`** как ключевых слов — они станут идентификаторами.
- **Enum-варианты** поддерживаются с глобальной таблицей (как и в Rust-кодогене).
- `float`-параметры не поддерживаются (как и в эталоне).
- **Нет внешних импортов**, кроме `env.print` — как и у Rust-кодогена.

## Тесты

```bash
node --test "selfhost/test/*.test.mjs"
```

- `bootstrap.test.mjs` — валидность stage1/2/3 и фиксированная точка;
- `lexer.test.mjs` — атомарные проверки токенизации;
- `scoping.test.mjs` — области видимости локальных (`find_local`);
- `features.test.mjs` — дифференциальные тесты oracle (Rust) vs stage1 vs
  stage2;
- `build.test.mjs` — детерминизм/идемпотентность сборщика;
- `coverage.test.mjs` — покрытие фич (см. файл);
- `debug-validate.mjs` — вспомогательный скрипт.

## Memory-примитивы

Для self-hosting в Rust-компилятор (`latentc`) добавлены встроенные функции
линейной памяти: `alloc`, `load8`, `store8`, `load32`, `store32`, `memcopy`
(`src/codegen/emit_call.rs`, `compile_memory_builtin`). На них написан
`10_buffer.lat` (LEB128, байтовые буферы, `bcopy`). Именно они позволяют
компилятору-на-Latent писать байты WASM.

> Примечание из README: строковые литералы в памяти — `[len u32][utf8]`,
> поэтому байты литерала читаются по смещению `+4` после `memcopy`, а не через
> `s + 4` (это разные вещи).

## Связанные разделы

- [Паритетная матрица](./parity-matrix.md) — кто что умеет.
- [Движки web IDE](./engines.md) — как selfhost соотносится с движками №1/№2.
- [Интерналы кодогена](./internals-codegen.md) — эталонная реализация того же
  ABI.
- [tooling/bootstrap](../tooling/bootstrap.md) — пересборка и прогон тестов.
