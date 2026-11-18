---
title: CLI latentc — компиляция и проверка
sidebar_label: CLI latentc
sidebar_position: 3
description: Команды latentc compile/check/version, коды выхода, форматы вывода и запуск WASM.
---

# CLI `latentc`

`latentc` — тонкая обёртка над библиотекой `latent` (`src/bin/latentc.rs`).
Аргументы разбираются вручную, exit-code — `std::process::ExitCode`.

## Синтаксис

```text
latentc compile <file.lat> [out.wasm]   — скомпилировать файл в WASM
latentc check <file.lat>                — лексинг/парсинг/типизация/кодоген
latentc version                         — версия компилятора
```

Без аргументов или с неизвестной командой печатается справка и возвращается
код 1:

```text
latentc 0.1.0
usage:
  latentc compile <file.lat> [out.wasm]
  latentc check <file.lat>
  latentc version
```

## `latentc compile`

```bash
./target/debug/latentc compile hello.lat hello.wasm
# hello.lat -> hello.wasm (1234 bytes)
```

Второй аргумент необязателен. По умолчанию имя результата — путь файла с
заменой `.lat` на `.wasm` (расширение снимается через
`trim_end_matches(".lat")`, поэтому для `hello.lat` получится `hello.wasm`):

```bash
./target/debug/latentc compile hello.lat
# hello.lat -> hello.wasm (1234 bytes)
```

Ошибки чтения/записи и ошибки компиляции печатаются в **stderr** с префиксом:

```text
error: <текст ошибки>
cannot read <path>: <io-ошибка>
cannot write <path>: <io-ошибка>
```

## `latentc check`

Полный конвейер (лексер → парсер → типчекер → **кодоген**), но результат не
записывается. Удобно для CI:

```bash
./target/debug/latentc check hello.lat
# ok: 1234 bytes of wasm
```

Обратите внимание: `check` — это не «только типы», а полная компиляция без
записи файла; кодоген-ошибки (например, host-примитивы) тоже всплывут. Если
файл не читается или не компилируется — код 1 и сообщение в stderr:

```text
error: Ошибка парсинга на строке 2:5: ожидалось ';', найдено RParen
```

## `latentc version`

```bash
./target/debug/latentc version
# latentc 0.1.0
```

Псевдонимы: `--version` и `-v`.

## Коды выхода

| Код | Когда |
|---|---|
| `0` | успех (`compile` записал файл, `check` прошёл, `version`) |
| `1` | нет аргументов/неизвестная команда; не удалось прочитать или записать файл; ошибка компиляции |

Код возврата `main` программы — это **не** код возврата `latentc`: CLI
компилирует, а не исполняет. Исполнение — задача host-рантайма
(см. [Запуск WASM](../guide/wasm-and-execution.md)).

## Точные тексты ошибок компилятора

Компилятор возвращает первую ошибку строкой; тексты формируются в
`src/lexer/error.rs`, `src/parser/error.rs`, `src/typechecker/types/mod.rs`:

| Стадия | Пример текста |
|---|---|
| Лексер | `Неожиданный символ '#' на строке 1:14` |
| Лексер | `Незавершённая строка на строке 1:20` |
| Лексер | `Неверная escape-последовательность '\q' на строке 1:26` |
| Парсер | `Ошибка парсинга на строке 1:20: ожидалось ';', найдено RBrace` |
| Парсер | `Неожиданный конец файла: ожидалось '}'` |
| Парсер | `Неверная цель присваивания на строке 1:5` |
| Типы | `Неопределённая переменная 'x' на строке 3:12` |
| Типы | `Несовпадение типов на строке 2:8: ожидалось 'bool', найдено 'float'` |
| Типы | `Несовпадение арности на строке 1:10: ожидалось 2 аргументов, найдено 3` |
| Кодоген | `Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)` |
| Кодоген | `Unknown function: foo` |

Тексты ошибок кодогенератора — английские свободные строки без номера строки;
ошибки лексера/парсера/типов — русские и содержат `строка:столбец`.
`expected`/`found` в сообщениях о несовпадении типов исторически
**инвертированы** относительно интуиции: `let x: string = 42;` даёт
`ожидалось 'float', найдено 'string'` (фактически — наоборот).

Ошибки нескольких независимых проверок типов объединяются через `; `.

## Пример: проверка в CI

```bash
set -e
cargo build --bin latentc
for f in examples/*.lat; do
  ./target/debug/latentc check "$f"
done
```

Для проверки скомпилированного модуля используйте `scripts/verify-wasm.mjs`:

```bash
./target/debug/latentc compile hello.lat
node scripts/verify-wasm.mjs hello.wasm --run --expect=0
# validate: ok
# instantiate: ok
# main() = 0
```

## Смотрите также

- [Установка](./install.md) — как собрать `latentc` и `compiler.wasm`.
- [Запуск WASM](../guide/wasm-and-execution.md) — ABI, импорт `env.print`,
  запуск в Node.js.
- [Web IDE](./web-ide.mdx) — компиляция без CLI.
