---
title: "Карта WASM-инструкций"
description: "Какие WASM-опкоды использует кодоген Latent, для каких конструкций, как кодируются LEB128 и типы; карта «конструкция → инструкции»."
sidebar_position: 6
---

# Карта инструкций

Кодоген не использует готовый энкодер: он пишет байты через `ByteBuffer`
(`src/codegen/bytecode.rs`). Набор опкодов ограничен константами из
`bytecode::op`; ниже — что и для чего эмитится.

## Кодирование

- Заголовок модуля: `00 61 73 6D 01 00 00 00`.
- `u32`/`i32` — LEB128 (`write_u32`, `write_i32`); есть `write_u64`/`write_i64`
  (для будущих 64-битных значений; сейчас почти не используются).
- `f64`-константа — `f64.const` + **8 байт little-endian**
  (`ctx.body.extend(&n.to_le_bytes())`).
- `memarg`: `align` (log2 выравнивания) и `offset`. Для `i32` — align=2
  (4 байта), для `f64` — align=3 (8 байт), для байтовых — align=0.
- `valtype`: `I32=0x7F`, `I64=0x7E`, `F32=0x7D`, `F64=0x7C`, `VOID=0x40`.

## Используемые опкоды

### Управление

| Опкод | Код | Где |
|---|---|---|
| `unreachable` | `0x00` | `assert`/`assert_eq` при провале |
| `block` | `0x02` | циклы (`while`, `for`), memcopy/str_eq |
| `loop` | `0x03` | циклы, хелперы |
| `if` | `0x04` | `if`/`else`, `&&`/`\|\|`, `match`, assert |
| `else` | `0x05` | `if`/`else`, короткое замыкание |
| `end` | `0x0B` | конец блоков/тел/секций |
| `br` | `0x0C` | конец итерации цикла |
| `br_if` | `0x0D` | условие выхода из цикла |
| `return` | `0x0F` | `return` |
| `call` | `0x10` | вызовы функций/хелперов/импорта |
| `call_indirect` | `0x11` | вызовы замыканий (через таблицу) |
| `drop` | `0x1A` | снятие значения выражения-инструкции |

### Переменные и глобалы

| Опкод | Код | Где |
|---|---|---|
| `local.get` | `0x20` | чтение локальной/параметра |
| `local.set` | `0x21` | запись локальной |
| `local.tee` | `0x22` | «записать и оставить» (массивы, `new`, closure) |
| `global.get` | `0x23` | чтение heap-указателя |
| `global.set` | `0x24` | запись heap-указателя |

### Память

| Опкод | Код | Где |
|---|---|---|
| `i32.load` | `0x28` | заголовки строк/массивов, поля, элементы |
| `f64.load` | `0x2B` | float-поля объектов |
| `i32.load8_u` | `0x2D` | байты строк, `load8`, memcopy |
| `i32.store` | `0x36` | заголовки, элементы, поля, tag enum |
| `f64.store` | `0x39` | float-поля объектов |
| `i32.store8` | `0x3A` | байты строк, `store8` |
| `memory.size` | `0x3F` | внутри `__latent_alloc` |
| `memory.grow` | `0x40` | внутри `__latent_alloc` |
| `i32.const` | `0x41` | все целочисленные константы и смещения |
| `f64.const` | `0x44` | float-литералы (нецелые) |

### Сравнения/логика (i32)

| Опкод | Код | Где |
|---|---|---|
| `i32.eqz` | `0x45` | `!`, `assert`, выход из цикла, `&&`/`\|\|` |
| `i32.eq` | `0x46` | `==`, `assert_eq`, теги enum, match-литералы |
| `i32.ne` | `0x47` | `!=` |
| `i32.lt_s` / `gt_s` / `le_s` / `ge_s` | `0x48/0x4A/0x4C/0x4E` | `< > <= >=` |
| `i32.ge_u` | `0x4F` | циклы (`for-in`), memcopy, str_eq |

### Сравнения f64

| Опкод | Код | Где |
|---|---|---|
| `f64.eq`/`ne`/`lt`/`gt`/`le`/`ge` | `0x61..0x66` | сравнения float |

### Арифметика i32

| Опкод | Код | Где |
|---|---|---|
| `i32.add` | `0x6A` | `+`, адресная арифметика |
| `i32.sub` | `0x6B` | `-`, унарный минус |
| `i32.mul` | `0x6C` | `*`, индексация (`i*4`) |
| `i32.div_s` | `0x6D` | `/` для int |
| `i32.div_u` | `0x6E` | хелперы (цифры `i32_to_str`) |
| `i32.rem_s` | `0x6F` | `%` |
| `i32.rem_u` | `0x70` | хелпер `i32_to_str` |
| `i32.and` | `0x71` | `&`, `&&` (нет — там `if`) |
| `i32.or` | `0x72` | `\|` |
| `i32.xor` | `0x73` | `^` |
| `i32.shl` | `0x74` | `<<` |
| `i32.shr_s` | `0x75` | `>>` |
| `i32.shr_u` | `0x76` | selfhost (LEB128) |

### Арифметика/математика f64

| Опкод | Код | Где |
|---|---|---|
| `f64.add`/`sub`/`mul`/`div` | `0xA0..0xA3` | float-арифметика |
| `f64.neg` | `0x9A` | унарный минус float |
| `f64.sqrt` | `0x9F` | builtin `sqrt` |

### Преобразования

| Опкод | Код | Где |
|---|---|---|
| `i32.trunc_f64_s` | `0xAA` | `int(float)` |
| `f64.convert_i32_s` | `0xB7` | `float(int)`, `sqrt(int)`, `float(str)` |
| `i32.wrap_i64` | `0xA7` | зарезервировано |

## Карта «конструкция → инструкции»

| Конструкция | Эмиссия |
|---|---|
| `let x = e;` | код `e` + `local.set` |
| `x = e;` | код `e` + `local.set` + `local.get` (результат — значение) |
| `a[i] = v` | код `v` → temp; `a`, `i`, `i32.const 4`, `i32.mul`, `i32.add`, `i32.const 4`, `i32.add`, `local.get temp`, `i32.store`; результат — temp |
| `o.f = v` | код `v` → temp; `o + offset`; `local.get temp`; `i32.store`/`f64.store` |
| `if` | `cond`, `if void`, then, `else`, else, `end` |
| `while` | `block void`, `loop void`, `cond`, `i32.eqz`, `br_if 1`, body, `br 0`, `end`, `end` |
| `for` C-стиль | init; `block/loop`; `cond`, `i32.eqz`, `br_if 1`; body; step, `drop`; `br 0`; `end`×2 |
| `for (x in arr)` | arr → local; idx=0; `block/loop`; проверка idx < len; `br_if`; `arr[idx]` → var; body; idx++; `br 0` |
| `spawn { ... }` | тело как обычные инструкции (последовательно) |
| `select` | тело первой ветки (или default), переменная = 0 |
| `yield` | ничего |
| `print(x)` | код `x` → конверсия в строку (`i32_to_str`/`f64_to_str`) → `call import0`; на каждый аргумент отдельно |
| `len(x)` | код `x`, `i32.load` |
| `str/int/float/sqrt` | код `x` + нужные конверсии (см. `emit_call/direct.rs`) |
| `assert(c)` | код `c`, `i32.eqz`, `if void`, `unreachable`, `end` |
| `assert_eq(a,b)` | код `a`, `b`, `i32.eq`, `i32.eqz`, `if void`, `unreachable`, `end` |
| `arr.push(v)` | arr → local; v → local; `arr[len]=v`; `arr.len=len+1`; push arr |
| `arr.pop()` | `arr.len--`; `i32.load(arr+4+len*4)` |
| литерал массива | `alloc(4+4n)`; `len`; элементы через `i32.store` |
| `new Class(args)` | `global.get heap`, temp, `+size`, `global.set heap`; args; `call Class_init` (если есть); `local.get temp` |
| `obj.method(args)` | `obj`, args, `call Class_method` |
| 0-арный enum-вариант | `i32.const tag` |
| n-арный enum-вариант | `alloc(4+4n)`, `tee`, tag, поля |
| `match` | scrutinee → local; цепочка `if/else` по паттернам |
| лямбда | env-alloc, копирование захватов, closure-alloc (8 байт) |
| вызов замыкания | `env`, args, `table_slot`, `call_indirect (env,args)->i32` |
| `await e` | код `e` (passthrough) |
| тело функции | locals-декларации, пролог захватов, инструкции, при `has_result` — `const 0`, если нет `return`, затем `end` |

## Чего нет

- `select`-опкода (не путать с языковым `select`) — не используется.
- `br_table`, циклы с результатом, `block` с типом — не используются.
- `memory.copy`/`memory.fill` (bulk memory) — вместо них ручной `loop` и
  `memcopy`-хелпер.
- f32, i64-арифметики, ссылочных типов, SIMD, GC-инструкций — нет.
- `start`-секции, data count, пассивных сегментов — нет.

## Чтение байткода

В web IDE вкладка WASM показывает hex-дамп `formatBytecode`
(`web-ide/services/compiler-service.js`): смещение, 16 байт hex, ASCII. Секции
можно найти по ID (`0x01` type, `0x02` import, `0x03` func, `0x04` table,
`0x05` memory, `0x06` global, `0x07` export, `0x09` element, `0x0A` code,
`0x0B` data). Строки в data-секции видны как `[len][utf8]`.

## Связанные разделы

- [Интерналы кодогена](./internals-codegen.md) — проходы и структуры.
- [WASM ABI](../reference/wasm-abi.md) — раскладка данных.
- [Диагностики](../reference/errors.md) — тексты ошибок кодогена.
