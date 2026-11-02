# Fixtures файловых модулей (Latent)

Каталог используется двумя проверками:

1. `scripts/check-golden.mjs` — хост-инварианты Rust-компилятора (48/48);
2. `selfhost/test/modules.test.mjs` — дифференциальный тест
   «хост линкует → selfhost компилирует bundle».

## Маркеры

* `// entry: true` — файл является entry-точкой проекта. Только такие файлы
  проверяются; остальные — импортируемые модули.
* `// expect-main: N` — после компиляции `main()` должен вернуть `N`
  (проверяется инстанцированием WASM в Node).
* `// expect-error: <подстрока>` — компиляция обязана завершиться ошибкой,
  содержащей подстроку (exit code ≠ 0).

## Состав

| Файл | Смысл |
|---|---|
| `basic/math.lat`, `basic/main.lat` | функции + класс + enum + алиас импорта + match; `main()` = 29 |
| `cycle/cycle_*.lat` | цикл импорта и взаимная рекурсия между модулями; `main()` = 1 |
| `errors/*.lat` | ошибки: нет экспорта, нет файла, кривой путь, дубль импорта, import/export не на верхнем уровне |

## Что проверяет check-golden (хост, Rust)

1. `latentc compile <entry>` (compile_files) собирает проект с диска.
2. `latentc bundle <entry> bundle.lat` даёт плоский исходник без
   `import`/`export` (имена манглены как `m0__name`).
3. `latentc compile bundle.lat` даёт **побайтово тот же WASM**, что
   `compile_files(entry)` — это инвариант линкера/бандлера (Rust-путь).
4. Для `expect-main` — реальный запуск `main()`.

## Что проверяет selfhost/test/modules.test.mjs (selfhost)

Selfhost-компилятор не имеет файловой системы и не разбирает `import`/`export`:
модули — фича **хоста/линкера**, selfhost потребляет уже связанный bundle.

Для `basic` и `cycle`:

1. `latentc bundle <entry>` → bundle; в нём нет `import`/`export`, нет `$`
   (selfhost-лексер допускает только `[A-Za-z_][A-Za-z0-9_]*`), есть
   мангленные имена `mN__name`.
2. Rust `compile_files(entry)` компилируется, `main()` = `expect-main` (oracle).
3. Rust `compile(bundle)` байт-в-байт равен `compile_files(entry)`.
4. selfhost (`seed.wasm`, а если есть — `stage1.wasm`/`stage2.wasm` после
   `bootstrap*.mjs`) компилирует bundle без ошибок; `main()` selfhost равен
   `expect-main` и результату Rust. Все поколения компилятора дают один и тот
   же WASM.
5. Байтовое расхождение selfhost vs Rust печатается диагностикой (см. ниже),
   но НЕ является провалом.

Для `errors/**`:

* `latentc check` и `latentc compile` возвращают ошибку (exit ≠ 0), текст
  содержит `expect-error`;
* `latentc bundle` тоже возвращает ошибку, bundle-файл не создаётся;
* selfhost обязан отказать и на **сыром** модульном исходнике (сейчас —
  `error: undefined variable: import`), т.е. ошибка не «проглатывается».

## Ограничение: байт-паритет selfhost vs Rust

Требование «selfhost(bundle) байт-в-байт == Rust compile_files» на текущем
selfhost **не выполнимо и не является целью**. Причина не в модулях: Rust и
selfhost исторически генерируют разный WASM даже для простейшей однофайловой
программы `fn main() -> int { return 42; }` — 1019 байт (selfhost) против
934 байт (Rust). Это давно известное расхождение кодогенераторов
(см. отчёт modules-core), а не дефект bundle.

Наблюдаемые размеры на этих fixtures (seed/stage1/stage2, 2026-11):

| fixture | selfhost(bundle) | Rust compile_files | diff (байт) |
|---|---|---|---|
| basic | 1193 | 1111 | 1085 |
| cycle | 1067 | 987 | 978 |

При этом `main()` совпадает (29 и 1), Rust `compile(bundle)` равен
`compile_files` байт-в-байт, а bundle однозначно определяет поведение.
Поэтому контракт модулей для selfhost — **поведенческий паритет**, а не
байтовый. Если когда-нибудь selfhost и Rust сойдутся по байтам, тест это
переживёт (он не требует неравенства), но опираться на это нельзя.

## Проверенное подмножество bundle

Текущие fixtures покрывают: top-level `fn`/`class`/`enum`, поля/`init`/методы
класса, enum-варианты с payload, `new`, доступ к полям/методам, `match` с
конструкторами и wildcard (`case m0__Circle(r):`, `case _:` — так bundle
печатает `default`), алиас импорта, цикл импорта и межмодульную рекурсию.
Дополнительно проверено вручную: 0-арные enum-паттерны bundle печатает как
`case m0__A():` — selfhost их принимает.

Что НЕ покрыто этими fixtures: лямбды, `select`/`spawn`, `async`/`await`,
декораторы, `test`, top-level `let` и прочие конструкции, которые bundle
умеет печатать, но selfhost покрывает отдельными тестами. Для такого проекта
нужно расширять fixtures и смотреть на реальный результат, а не предполагать
паритет.

## Как запускать

```bash
node scripts/check-golden.mjs                  # хост: 48/48, включая эти fixtures
node --test selfhost/test/modules.test.mjs     # bundle → selfhost (Rust + selfhost)
node selfhost/build.mjs && node selfhost/bootstrap.mjs && node selfhost/bootstrap-wasm.mjs
```

`node selfhost/bootstrap*.mjs` создаёт `stage1.wasm`/`stage2.wasm`; при их
отсутствии тест использует только `seed.wasm` (этого достаточно).
Если selfhost не компилирует bundle, тест делает честный SKIP с причиной
(хост-часть при этом уже доказала валидность проекта) — это сигнал для
разбора, а не способ скрыть регресс.
