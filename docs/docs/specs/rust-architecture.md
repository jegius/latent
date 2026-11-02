# Rust-компилятор Latent: архитектура, декомпозиция и покрытие

Документ описывает `src/` — компилятор Latent → WebAssembly («движок №2»),
принципы его декомпозиции, публичный контракт и инварианты. Обзор всего
репозитория — в корневом [`ARCHITECTURE.md`](../../../ARCHITECTURE.md).

## 1. Слои и поток данных

```
&str
 │  lexer  (src/lexer)
 ▼
Vec<Token>          комментарии — тоже токены, парсер их отфильтровывает
 │  parser (src/parser)
 ▼
ast::Program        src/ast — чистые структуры, без логики
 │  typechecker (src/typechecker)
 ▼
Ok(()) | Vec<TypeError>
 │  codegen (src/codegen)
 ▼
Vec<u8>             бинарный WASM-модуль (без WASI, один импорт env.print)
```

Единственная точка входа — `latent::compile_source` (`src/lib.rs`):
fail-fast на лексере/парсере, накопление ошибок тайпчекера (склейка `"; "`),
первая ошибка кодогена. C-ABI (`latent_alloc/latent_free/latent_compile/
latent_version`) — обёртка над той же функцией для браузера.

### Порядок проходов кодогена

`WasmCodegen::compile` (`src/codegen/module_builder/mod.rs`):

1. заголовок модуля;
2. `collect_class_layouts` — layout классов (выравнивание полей, f64 = 8 байт);
3. `collect_enum_variants` — теги `enum` + встроенные `Ok/Err/Some/None`;
4. `collect_function_signatures` — top-level `fn` (включая неявный i32-результат
   при `return expr` без аннотации);
5. `collect_class_methods` — методы как `Class_method(this, ...)`;
6. `collect_lambdas` — хойстинг лямбд в функции `__lambda_N`;
7. `register_helpers` — 9 рантайм-хелперов;
8. тела функций → тела методов → тела лямбд → тела хелперов;
9. экспорты (`memory`, `main`) и секции.

## 2. Карта модулей

| Модуль | Ответственность |
|---|---|
| `lexer/` | `scanner` (цикл), `next_token` (операторы/разделители), `readers` (числа, строки, комментарии), `keywords`, `token`, `position`, `error` |
| `parser/` | `cursor` (поток токенов), `declarations` (fn/class/enum/test), `statements`, `expressions/{core,prefix,postfix,lambda_match}`, `type_parser` |
| `ast/` | `expr`, `stmt`, `ops` — только данные |
| `typechecker/` | `checker` (обход), `environment` (scopes), `infer/{expr,call,effects,stmt}`, `types/` (HM-типы, unify, free_vars) |
| `codegen/` | `bytecode` (LEB128, опкоды), `context` (FuncContext, StaticTy, layout), `module_builder/{mod,collect,emit_ops}`, `compile_fn`, `emit_stmt`, `emit_expr/{mod,binary,access,ty}`, `emit_call/{mod,direct,constructors,method,array}`, `emit_lambda`, `emit_match`, `emit_enum`, `runtime_helpers/{mod,alloc,mem,string,int,f64}`, `memory`, `sections` |
| `runtime/` | host-каналы/планировщик для native-цели (не подключены к `compile_source`, тесты — отдельно) |
| `ai/`, `fp/` | автономные AI/FP-подсистемы (offline-провайдеры, Result/Option/Promise, VectorDB); подключены к crate, но не к пайплайну |
| `types.rs`, `syntax.rs` | альтернативные модели типов/синтаксиса, не используются пайплайном (оставлены для совместимости API) |

## 3. Публичный контракт (менять нельзя)

```rust
pub fn compile_source(source: &str) -> Result<Vec<u8>, String>;
pub const VERSION: &str;

// C-ABI (wasm32): буфер ответа = [status u32 LE][len u32 LE][payload...]
pub extern "C" fn latent_alloc(size: usize) -> *mut u8;
pub extern "C" fn latent_free(ptr: *mut u8, size: usize);
pub extern "C" fn latent_compile(src_ptr: *const u8, src_len: usize) -> *mut u8;
pub extern "C" fn latent_version() -> *mut u8;
```

`scripts/build-wasm.sh` копирует `target/wasm32-unknown-unknown/release/latent.wasm`
в `web-ide/compiler.wasm` и `web-ide/latent.wasm`; движок №2 в браузере вызывает
именно этот ABI. Изменение сигнатур/формата буфера ломает web-ide.

## 4. Инварианты WASM-кодогена

1. **Один импорт**: `env.print: (i32) -> ()`; все функции модуля сдвинуты на 1.
2. **Память**: собственная секция (16 страниц старт), bump-аллокатор
   `__latent_alloc` растёт через `memory.grow`; строки — `[len u32 LE][utf8]`.
3. **Секции строго по возрастанию id**; table/element — только при лямбдах.
4. **Типы на стеке**: выбор инструкций (`i32` vs `f64`) определяется
   синтаксическим `StaticTy`, а слот локальной — аннотацией; никаких приведений
   нет. Отсюда известные ограничения (`5.0` — int-литерал, `sqrt` в `print` и
   т.п.) — они **зафиксированы golden-набором** и не исправляются рефакторингом.
5. **Детерминизм**: порядок обхода AST и регистрации сущностей фиксирован;
   golden-набор (`scripts/check-golden.mjs`) требует байт-в-байт совпадения.

## 5. Декомпозиция: что и почему

Файлы > ~300–350 строк разбиты по SRP; поведение не менялось (golden-WASM
совпадает). Таблица «до → после»:

| Было (строк) | Стало |
|---|---|
| `codegen/runtime_helpers.rs` (662) | `runtime_helpers/{mod,alloc,mem,string,int,f64}.rs` — регистрация/общие примитивы, аллокатор, копирование, строки, int→str, f64→str |
| `codegen/emit_expr.rs` (572) | `emit_expr/{mod,binary,access,ty}.rs` — диспетчер, операторы/коэрция, индексация/поля/присваивания, статические типы |
| `codegen/emit_call.rs` (495) | `emit_call/{mod,direct,constructors,method,array}.rs` — диспетчер, builtins/память, `new`, методы/push/pop, литерал массива |
| `codegen/module_builder.rs` (388) | `module_builder/{mod,collect,emit_ops}.rs` — состояние/порядок проходов, первый проход, переиспользуемые эмиттеры |
| `typechecker/infer/expr.rs` (352) | `infer/expr/{mod,call,effects}.rs` — базовые формы, вызовы/builtins, host-эффекты |
| `codegen/tests/features.rs` (370) | `tests/features.rs` + `tests/features_misc.rs` |
| `parser/tests/stmts_exprs.rs` (353) | `tests/stmts_exprs.rs` + `tests/new_features.rs` |

Дублирование устранено: общие эмиттеры `i32.load/store`, `f64.load/store`,
`emit_helper_call` вынесены в `module_builder/emit_ops.rs`; двойной
`#[allow(dead_code)]` и неиспользуемые поля `WasmCodegen` удалены.

### SOLID-решения

* **SRP** — каждый файл отвечает за одну зону (лексер/парсер/типы/эмиссия
  выражений/вызовов/хелперов); данные (`ast/`, `bytecode`) отделены от логики.
* **OCP** — новые builtins/операторы добавляются в диспетчеры `direct.rs`/
  `binary.rs`, не трогая диспетчер `mod.rs`.
* **DIP** — кодоген не зависит от типов тайпчекера: общается через `StaticTy`
  и `FuncContext`; замена тайпчекера не требует менять эмиттеры.
* **ISP** — `FuncContext` даёт узкий интерфейс (locals/static/class), а
  `WasmCodegen` — только `emit_*`/`helper_idx`, без «божественных» фасадов.

## 6. Тесты и покрытие

```pwsh
# все тесты (202 базовых + новые на покрытие)
cargo +stable-x86_64-pc-windows-gnu test

# golden: 48 программ (23 фикстуры + 24 примера web-ide + selfhost/shc.lat)
node scripts/check-golden.mjs
node scripts/check-golden.mjs --update   # только при осознанном изменении

# покрытие строк (llvm-cov)
pwsh scripts/coverage-rust.ps1
```

### Покрытие (llvm-cov, строки, тесты исключены)

Итог: **91.0 % строк** (5845 строк, 526 непокрытых), 93.5 % функций.
Отчёт получен `llvm-cov report` по инструментированному `cargo test
--all-targets`; в репозитории команда доступна как `scripts/coverage-rust.ps1`.

Что покрыто тестами (включая «мёртвые» host-модули):

* `lexer/**`, `parser/**`, `ast/**` — валидный синтаксис + все ветки ошибок;
* `typechecker/**` — вывод типов, unify, ошибки типов, builtins, host-эффекты;
* `codegen/**` — все семейства выражений/инструкций, лямбды, enum/match,
  классы, рантайм-хелперы, ветки ошибок (включая достижимые только при
  отключённом тайпчекере);
* `ai/**`, `fp/**`, `runtime/**` — прямые unit-тесты публичных API (хотя эти
  модули не участвуют в `compile_source`);
* `types.rs`, `syntax.rs`, `bytecode.rs`, `context.rs` — inline-тесты.

Осознанно **не входит** в порог: `src/bin/**` (CLI, тестируется smoke-тестами
и golden), тестовые файлы, объекты std/rustc.

### Почему не обычный `cargo llvm-cov` на Windows-gnu

В этом окружении rust-std для `x86_64-pc-windows-gnu` не содержит
`libprofiler_builtins` (`E0463`), а GNU ld некорректно размещает секции
`.lcov*` (получается невалидный exe). Рабочий обход (реализован в
`scripts/coverage-rust.ps1`):

1. rlib-заглушка `profiler_builtins` с `#![profiler_runtime]` (собирается
   `rustc` с `RUSTC_BOOTSTRAP=1`);
2. `RUSTFLAGS="-C instrument-coverage"` + линковка через `lld`
   (`-fuse-ld=lld`, `--no-gc-sections`) со статическим профилировочным
   рантаймом (`COV_PROFILER_RT`), собранным из `compiler-rt/lib/profile`;
3. `llvm-profdata merge` + `llvm-cov report` из компонента
   `llvm-tools-preview` (`rustc --print sysroot`).

## 7. Известные ограничения (не исправляются в рамках рефакторинга)

Это дефекты текущей семантики, зафиксированные golden-набором; их исправление
изменило бы байты WASM и является отдельной задачей:

* литералы вида `2.0` трактуются как `int` (лексер + `fract() == 0.0`);
* `sqrt`/методы, возвращающие `f64`, не имеют статического типа результата —
  `print(sqrt(x))` даёт invalid WASM;
* `push` в массив, созданный как `[]`, пишет за пределы выделенного блока;
* `spawn`/`select`/`yield`/`await` компилируются в суррогат без host-рантайма;
* top-level `let`, вложенные `fn`, декораторы на top-level не эмитятся.
