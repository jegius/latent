---
title: "Self-hosted компилятор"
description: "Финальный статус компилятора Latent, написанного на самом Latent: фиксированная точка stage2===stage3, 166 тестов, паритет 64/65 с Rust-эталоном, Rust-free bootstrap (seed+WASM), части src/*.lat, ABI компилятора, бюджет памяти, host-конструкции и остаточные расхождения."
sidebar_position: 1
---

# Self-hosted компилятор (`selfhost/`)

`selfhost/` — компилятор Latent→WebAssembly, **написанный на самом Latent**.
Он собирает сам себя до фиксированной точки: `stage2 === stage3` побайтово.

Источники истины: `selfhost/README.md`, `selfhost/build.mjs`,
`selfhost/bootstrap.mjs`, `selfhost/src/*.lat`.

## Статус: паритет достигнут

- **Фиксированная точка**: `stage2 === stage3` (проверяют `bootstrap.mjs` и
  `bootstrap.test.mjs`); Rust-free цепочка `seed → stage-sh-1 → stage-sh-2 →
  stage-sh-3` даёт `stage-sh-2 === stage-sh-3` (проверяют `bootstrap-wasm.mjs`
  и `bootstrap-wasm.test.mjs`).
- **Регресс-набор — 166 тестов** (`node --test "selfhost/test/*.test.mjs"`,
  17 сьютов, 0 падений): 85 исходных + 56 дифференциальных в `parity.test.mjs`
  + 25 Rust-free в `bootstrap-wasm.test.mjs`.
- **Rust не обязателен для сборки**: в репозитории лежит `selfhost/seed.wasm`
  (самохостящийся компилятор, sha256 в `seed.json`), которым собирается
  `shc.lat`; CLI `selfhost/wasm-compiler.mjs` компилирует пользовательские
  программы без `cargo`/`latentc`.
- **Матрица паритета** (`latent-work/gap-matrix.mjs`): **64/65 кейсов** совпадают
  с Rust-эталоном, включая 11 кейсов «все три компилятора дают ошибку».
  Единственное оставшееся расхождение — `float`-литералы, где selfhost
  **сильнее** эталона.
- Текст ошибок stage2 **посимвольно совпадает** с stage1 (исправлен баг
  типизации строковых параметров).
- Host-конструкции реализованы в объёме наблюдаемого поведения эталона:
  `spawn`/`yield`/`async`/`await`/`select`/`test`/`match` по строкам.

```bash
node selfhost/build.mjs             # src/*.lat -> shc.lat
node selfhost/bootstrap.mjs         # stage1 -> stage2 -> stage3; FIXED POINT (Rust)
node selfhost/bootstrap-wasm.mjs    # seed -> stage1' -> stage2' -> stage3'; FIXED POINT (без Rust)
node --test "selfhost/test/*.test.mjs"
```

## Структура: один файл, собираемый из частей

У Latent нет системы модулей и импортов: программа компилируется как **один
файл**. Поэтому «линковка» — детерминированная конкатенация частей в порядке
имён (`selfhost/build.mjs`):

```text
selfhost/src/00_abi.lat              карта линейной памяти, слоты состояния
selfhost/src/10_buffer.lat           байтовые буферы [len u32][bytes], LEB128
selfhost/src/20_lexer.lat            исходник → параллельные массивы токенов
selfhost/src/30_syntax.lat           курсор токенов, локальные, таблицы имён
selfhost/src/35_class.lat            классы (поля/методы), enum-варианты
selfhost/src/36_lambda.lat           лямбды/захваты, closure/env
selfhost/src/40a_expr_emit.lat       эмиссия выражений: диспетчер/Pratt
selfhost/src/40b_expr_values.lat     значения, литералы, float
selfhost/src/40c_expr_primary.lat    первичные выражения, вызовы
selfhost/src/40d_expr_objects.lat    поля/методы/конструкторы
selfhost/src/40e_expr_postfix.lat    постфиксные операции, индексация
selfhost/src/40f_expr_assign.lat     присваивания
selfhost/src/40g_expr_operators.lat  бинарные/унарные операторы, строки
selfhost/src/45a_tc_core.lat         тайп-чек: ядро, таблица типов, ошибки
selfhost/src/45b_tc_expr.lat         тайп-чек выражений
selfhost/src/45c_tc_flow.lat         тайп-чек инструкций/потока
selfhost/src/45d_tc_program.lat      тайп-чек программы (проход по функциям)
selfhost/src/50_stmt.lat             эмиссия инструкций
selfhost/src/60_func.lat             сборка одного тела функции
selfhost/src/70a_module_helpers.lat  рантайм-хелперы (8 тел) + эмиттеры
selfhost/src/70b_module_convert.lat  конверсии значений (int/float/string)
selfhost/src/70c_module_sections.lat секции WASM-модуля
selfhost/src/90_driver.lat           точка входа: полный проход компиляции
```

Части разбиты по зонам ответственности (SRP) и продолжают дробиться по мере
роста; актуальный список — `selfhost/src/` и `selfhost/build.mjs` (склейка идёт
в отсортированном порядке имён).

```text
shc.lat = BANNER + join(sorted(src/*.lat), разделитель)
```

Сборка идемпотентна: один набор частей всегда даёт один и тот же `shc.lat`.
**Редактировать `shc.lat` вручную нельзя** — он генерируется.

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
  `OUTPUT_ADDR+4` лежит `[len u32 LE][utf8-текст ошибки]`. Так ведут себя и
  ошибки тайп-чека, и ошибки кодогена (раньше кодоген отдавал невалидный WASM).
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
переменной окружения `LATENTC` (по умолчанию `target/debug/latentc`).

## Bootstrap без Rust (seed + WASM)

`selfhost/seed.wasm` — уже собранный selfhost-компилятор (последняя версия
`shc.lat`, паритет 64/65). Им собирается `shc.lat`, затем компилятор
воспроизводит себя; `cargo`/`latentc` не участвуют:

```text
seed.wasm        -> shc.lat -> stage-sh-1.wasm   (stage1')
stage-sh-1.wasm  -> shc.lat -> stage-sh-2.wasm   (stage2')
stage-sh-2.wasm  -> shc.lat -> stage-sh-3.wasm   (stage3')

stage-sh-2 === stage-sh-3                        (FIXED POINT, stage2' === stage3')
```

```bash
node selfhost/build.mjs            # src/*.lat -> shc.lat (только Node)
node selfhost/bootstrap-wasm.mjs   # seed -> ... -> FIXED POINT
node selfhost/wasm-compiler.mjs compile hello.lat   # CLI без Rust
node selfhost/wasm-compiler.mjs check|run|version   # проверка/запуск/метаданные
node selfhost/bootstrap-wasm.mjs --refresh-seed     # новый seed из текущего shc.lat
node selfhost/bootstrap-wasm.mjs --verify-seed      # sha256 seed.json + shc.lat
```

* Артефакты `stage-sh-1/2/3.wasm` игнорируются git'ом
  (`selfhost/stage*.wasm`) и не пересекаются с `stage1/2/3.wasm` Rust-цепочки.
* `bootstrap-wasm.mjs` использует тот же ABI (`INPUT_ADDR=3145728`,
  `OUTPUT_ADDR=65536`, `ret < 0` — текст ошибки), что и `bootstrap.mjs`;
  общая обёртка — `selfhost/wasm-compiler.mjs` (`compileWith`, `runWasm`).
* `seed.json` — манифест доверия: `compilerVersion`, `seedRevision`,
  `seedSha256`/`seedBytes` (бинарник), `shcSha256`/`shcBytes` (исходник),
  `fixedPoint`, `updatedAt`/`verifiedAt`. При старте sha256/размер seed
  сверяются с манифестом; несовпадение — код 2 (порча/подмена).
* `--refresh-seed` собирает `stage1' → stage2' → stage3'` в памяти и пишет
  `seed.wasm` + `seed.json` только при `stage2' === stage3'` и
  самовоспроизведении `stage2'`; печатает diff (размеры, sha256, число
  отличающихся байт, первое смещение, `shcSha256`). `seedRevision` растёт
  только при изменении байтов seed; `shcSha256`/`shcBytes`/даты обновляются
  всегда. `--dry-run` показывает diff без записи.
* Ограничение: Rust-free обновление возможно, пока текущий seed умеет
  компилировать новый `shc.lat`. Если изменение требует новой конструкции
  языка, один раз нужен Rust (`bootstrap.mjs --update-seed`), после чего
  цепочка снова работает без Rust. Сломанный/подменённый seed
  `--refresh-seed` не «лечит» — он собирает новый seed из текущего.
* Аварийный Rust-путь `bootstrap.mjs --update-seed` пишет `seed.json` старого
  формата (без `compilerVersion`/`seedRevision`); после него нужен
  `bootstrap-wasm.mjs --refresh-seed`, чтобы обновить манифест до схемы v2
  (байты seed при этом не меняются).

## Что компилирует self-hosted компилятор

| Область | Поддержка |
|---|---|
| `let`/`if`/`else`/`while`/`for`/`for-in`/`return` | ✅ |
| арифметика, сравнения, битовые, сдвиги | ✅ |
| `&&`/`\|\|` с коротким замыканием | ✅ |
| массивы: литерал, `[]`, `.length`, `push`, `pop`, `len` | ✅ |
| строки: `+`, `==`/`!=`, `s[i]`, `len` | ✅ |
| escape-строки `\n` `\t` `\\` `\"` | ✅ |
| вложенные блочные комментарии `/* a /* b */ c */` | ✅ |
| `str`/`int`/`float`/`to_str`/`to_int` (по статическому типу получателя) | ✅ |
| `print(a, b, …)` — конверсия int/float/строка, отдельная строка на аргумент | ✅ |
| `null` (`0`, как в эталоне) | ✅ |
| `assert`/`assert_eq` | ✅ |
| классы: `class`, поля, `this`, методы, `new` | ✅ |
| enum: варианты (теги + payload) | ✅ |
| `match`/`case` (числа, строки, `_`/`default`, конструкторы) | ✅ |
| замыкания: `fn(x) => expr`, `fn(x) { ... }`, захваты, `call_indirect` | ✅ |
| тайп-чек: аннотации, возвраты, арность, условия, присваивания | ✅ |
| float: литералы `1.25`, `1e3`, `2.5e1`, `1250e-1`, `+ - * /`, сравнения | ✅ |
| `float`-возврат `fn f() -> float`, f64 в выражениях | ✅ |
| `float`-локальные, `sqrt`, `float(x)`, `str(float)` | ✅ |
| смешанная арифметика `int ⊕ float` (повышение int→f64) | ✅ (сверх эталона) |
| `spawn { … }` / `spawn expr;` | ✅ — тело inline (последовательно), как в эталоне |
| `yield;` | ✅ — no-op |
| `async fn` | ✅ — флаг игнорируется |
| `await expr` | ✅ — passthrough значения |
| `select`-выражение/инструкция | ✅ — первая ветка, иначе `default`, иначе `0` |
| `test "name" { … }` | ✅ — top-level не эмитится, внутри функции исполняется |
| `channel`/`tensor`/`ai_*`/`ch <- v`/`ch.send` | ❌ ошибка «требует host-рантайма» с именем конструкции |
| `float`-параметры `fn f(r: float)` | ❌ (в эталоне тоже невалидно) |
| `@`-декораторы | ❌ (см. «Остаточные расхождения») |

**Float без IEEE754-битов.** Литерал собирается как f64-арифметика
(`mant / 10^k * 10^exp`, i32→f64 через `f64.convert_i32_s`) — компилятору не
нужна 64-битная мантисса в i32-коде. Целочисленно-значные литералы (`2.0`,
`1e3`) сворачиваются в int, как в эталоне.

**Selfhost — надмножество эталона по float.** Живые проверки:
`int(2.5 * 2.0)`, `int(sqrt(16.0))`, `let x: float = 2.5`, `str(2.5)`,
`let x = 1e-3; x * 1000.0`, смешанные `2 < 2.5` / `1 + 0.5` дают **валидный
WASM и верный результат** в selfhost, тогда как `latentc` падает с невалидным
WASM или ошибкой типов.

## Host-конструкции: что именно делает selfhost

Selfhost повторяет **наблюдаемое поведение эталона**, а не гипотетическую
семантику:

- `spawn { ... }` / `spawn expr;` — тела выполняются **последовательно** в
  текущей функции; `return` внутри `spawn` возвращает из объемлющей функции;
  результат выражения-формы отбрасывается (`DROP`).
- `yield;` — no-op (`;` обязательна, как в парсере эталона).
- `async fn` — флаг `is_async` не влияет на сигнатуру/код; Promise не
  материализуется.
- `await expr` — прозрачное разворачивание: значение операнда как есть.
- `select { case v <- ch: … }` — выражения каналов **не компилируются**
  (эмитятся и откатываются), `v` связывается с `0`, исполняется тело **первой**
  ветки; `default` — только если веток нет; пустой `select` в позиции выражения
  даёт `0`.
- `test "name" { … }` — на верхнем уровне парсится и **не эмитится** (раннера
  нет); внутри функции тело исполняется как обычный блок.
- `channel()`, `channel<T>()`, `tensor(…)`, `ai_*`, `ch <- v`, `<-ch`,
  `ch.send`/`ch.recv`, неизвестные методы — **ошибка кодогена** с именем
  конструкции:
  `error: builtin 'channel' requires host runtime (engine #2)`,
  `error: channel operations require host runtime (engine #1)`,
  `error: AI primitives require host runtime (engine #1)`.

## Устройство прохода компиляции

`selfhost/src/90_driver.lat` (`compile_program`):

1. `alloc(4600000)` — гарантировать рост памяти под все области;
2. `binit(...)` — обнулить буферы (OUTB, SCRB, FNB, CODEB, BODYC, DATAB) и
   слоты состояния (статус, счётчики классов/вариантов/лямбд);
3. `tokenize()` — параллельные массивы `KIND`, `TVAL`, `TLEN`; терминатор —
   kind 0;
4. `scan_classes()`, `scan_enums()`, `scan_signatures()`, `scan_lambdas()`,
   `register_lambdas()` — таблицы первого прохода;
5. `tc_program()` — тайп-чек; при ошибке текст пишется в `ERRB`/`OUTB`,
   возвращается `-len`;
6. `compile_fn(i)` для каждой функции, `compile_lambda(li)`;
7. `helper_bodies()` — 8 рантайм-хелперов;
8. если кодоген выставил `status` — вернуть `-len` с текстом ошибки;
9. `build_module()` — секции WASM;
10. вернуть `blen(OUTB())` — длину модуля.

### Бюджет памяти

Компилятор работает в собственной линейной памяти и **резервирует 4 600 000
байт** (`alloc(4600000)` в начале `compile_program`) — этого хватает на все
области карты:

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
| тип-стек, float-константы, типы параметров | 2 981 888 … 3 112 960 | по 32K |
| таблицы классов/методов/enum/лямбд | 3 407 872 … 4 308 992 | — |
| таблицы тайп-чекера, `ERRB` | 4 313 088 … 4 547 072 | — |

Следствия:

- **Хост обязан** нарастить память до `INPUT_ADDR + 4 + len` перед записью
  исходника — иначе запись уйдёт за пределы страниц и потеряется;
- верхняя занятая область — `ERRB` (4 547 072 + 4K), это меньше резерва
  4 600 000, поэтому `alloc` гарантированно покрывает карту;
- **выходной модуль** компилятора имеет память **16 страниц** (1 МиБ), без
  `max`; глобал `heap` = `1024 + len(DATAB)`, рост — через хелпер `alloc`.

Слоты состояния: `0=PC 1=NT 2=NF 3=NL 4=status 5=produces 6=NS(strings)
7=TS`; доступ через `get(st, k)`/`set(st, k, v)` = `load32/store32`.

### Выходной модуль

`70c_module_sections.lat` собирает модуль так же, как Rust-кодоген, но с
фиксированными типами (конверсии значений — `70b_module_convert.lat`):

- секция типов: 20 типов — `(i32)->void` (idx0), `(i32×arity)->i32` (idx1..9),
  `(i32×arity)->f64` (idx10..18), `(f64)->i32` (idx19, для `f64_to_str`);
- одна импортная функция `env.print (i32)->void` (индекс 0);
- 8 рантайм-хелперов: `alloc`, `memcopy`, `str_concat`, `str_eq`,
  `str_char_at`, `i32_to_str`, `str_to_i32`, `f64_to_str`;
- память: **16 страниц**, без max;
- глобал `heap` = `1024 + len(DATAB)` (стартовое значение после данных);
- экспорты: `memory` и `main` (индекс `find_main()+1`);
- таблица/element-секции — только если есть лямбды; слот = индекс функции;
- данные: строковые литералы `[len u32][utf8]`.

## Остаточные расхождения с эталоном (сознательные)

Матрица паритета — 64/65; расхождения ниже зафиксированы осознанно:

1. **float-литералы/выражения** — selfhost принимает и корректно исполняет то,
   что `latentc` компилирует в невалидный WASM или отвергает по типам.
2. **`fn f() -> unit { return; }`** — oracle выдаёт invalid WASM, selfhost —
   валидный модуль.
3. **`await` не-Promise** — oracle требует `Promise<T>` и падает на типах;
   selfhost прозрачен.
4. **`@`-декораторы** — лексер selfhost не выделяет `@`: `@forall("x") fn f()`
   даёт `undefined function: forall`, а `@test("t") fn f()` компилирует `f`.
   В `shc.lat` и тестах декораторы не используются.
5. **`unit`-возврат и float-параметры** — см. п. 1–2.
6. **Арность builtin'ов** — oracle местами молча игнорирует лишние/недостающие
   аргументы; selfhost строже (`error: compilation failed`).
7. **Мягкие ключевые слова** — `spawn`/`yield`/`async`/`await`/`select`/`test`/
   `null` в selfhost — полноценные ключевые слова; `fn test()` или
   `let spawn = 1` не компилируются (oracle частично допускает).
8. **Точность float-литералов с длинной мантиссой** — мантисса парсится в i32,
   поэтому >~9 значащих цифр или экстремальные экспоненты могут отличаться.
9. **Невалидный WASM по вине самого языка** (`x = 2.5` для `let x = 1`,
   `a[0] = 1.5`) — selfhost, как и oracle, не диагностирует эти дыры типовой
   системы; часть из них (например, `5.5 % 2.0`) даёт честную ошибку.
10. **Точнее типизирует результаты методов**: oracle теряет строковый
    статический тип у результата метода, selfhost отслеживает `T_STR`.

## Тесты

```bash
node --test "selfhost/test/*.test.mjs"
```

166 тестов в 17 сьютах (покрытие: **94.56% функций / 96.68% строк**,
`node tooling/selfhost-coverage/run.mjs`):

- `bootstrap.test.mjs` — валидность stage1/2/3 и фиксированная точка (Rust-путь);
- `bootstrap-wasm.test.mjs` — Rust-free bootstrap: `seed → stage-sh-1 →
  stage-sh-2 → stage-sh-3`, `stage-sh-2 === stage-sh-3`, `stage-sh-1 === seed`,
  соответствие `seed.json` (sha256/размер/исходник), CLI
  `compile/check/run/version` (hello, классы, enum, match, float), текст ошибок,
  `--refresh-seed` и `--dry-run` без записи файлов;
- `lexer.test.mjs` — атомарные проверки `tokenize` по категориям токенов;
- `scoping.test.mjs` — область видимости локальных (`find_local`);
- `features.test.mjs` — дифференциальные тесты oracle (Rust) vs stage1 vs
  stage2;
- `coverage.test.mjs` — дифференциальное покрытие конструкций из `shc.lat`;
- `parity.test.mjs` — 56 кейсов паритета: spawn/yield/async-await/select/test,
  match по строкам, to_str/to_int, top-level let, host-ошибки
  (channel/tensor/ai_*/каналы/методы), print, null, строковые параметры,
  `float("…")`, экспоненциальные литералы, escape-строки, вложенные
  комментарии; для ошибочных кейсов требуется совпадение текстов stage1/stage2;
- `build.test.mjs` — детерминизм и идемпотентность сборщика частей.

Матрица паритета (вне `selfhost/`, в рабочей папке агента):

```bash
node latent-work/gap-matrix.mjs [--verbose]
```

## Memory-примитивы

Для self-hosting в Rust-компилятор (`latentc`) добавлены встроенные функции
линейной памяти: `alloc`, `load8`, `store8`, `load32`, `store32`, `memcopy`
(`src/codegen/emit_call/direct.rs`, `compile_memory_builtin`; регистрация —
`emit_call/mod.rs`). На них написан `10_buffer.lat` (LEB128, байтовые буферы,
`bcopy`). Именно они позволяют компилятору-на-Latent писать байты WASM, и они
**есть в поставляемом `web-ide/compiler.wasm`**.

> Строковые литералы в памяти — `[len u32][utf8]`, поэтому байты литерала
> читаются по смещению `+4` после `memcopy`, а не через `s + 4`.

## Связанные разделы

- [Паритетная матрица](./parity-matrix.md) — кто что умеет.
- [Движки web IDE](./engines.md) — как selfhost соотносится с движками №1/№2.
- [Интерналы кодогена](./internals-codegen.md) — эталонная реализация того же
  ABI.
- [tooling/bootstrap](../tooling/bootstrap.md) — пересборка и прогон тестов.
