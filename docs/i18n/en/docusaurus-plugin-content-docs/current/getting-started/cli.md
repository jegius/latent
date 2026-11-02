---
title: The latentc CLI — compilation and checking
sidebar_label: latentc CLI
sidebar_position: 3
description: The latentc compile/check/version commands, exit codes, output formats, and running WASM.
---

# The `latentc` CLI

`latentc` is a thin wrapper over the `latent` library (`src/bin/latentc.rs`).
Arguments are parsed by hand, and the exit code is `std::process::ExitCode`.

## Syntax

```text
latentc compile <file.lat> [out.wasm]   — compile a file to WASM
latentc check <file.lat>                — lexing/parsing/typing/codegen
latentc version                         — compiler version
```

Without arguments, or with an unknown command, the help is printed and code 1 is
returned:

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

The second argument is optional. By default the result name is the file path
with `.lat` replaced by `.wasm` (the extension is stripped with
`trim_end_matches(".lat")`, so `hello.lat` becomes `hello.wasm`):

```bash
./target/debug/latentc compile hello.lat
# hello.lat -> hello.wasm (1234 bytes)
```

Read/write errors and compilation errors are printed to **stderr** with a
prefix:

```text
error: <error text>
cannot read <path>: <io error>
cannot write <path>: <io error>
```

## `latentc check`

The full pipeline (lexer → parser → type checker → **codegen**), but the result
is not written to disk. Convenient for CI:

```bash
./target/debug/latentc check hello.lat
# ok: 1234 bytes of wasm
```

Note: `check` is not "types only", but a full compilation without writing a
file; codegen errors (for example, host primitives) surface as well. If the file
cannot be read or does not compile, the result is code 1 and a message on
stderr:

```text
error: Ошибка парсинга на строке 2:5: ожидалось ';', найдено RParen
```

## `latentc version`

```bash
./target/debug/latentc version
# latentc 0.1.0
```

Aliases: `--version` and `-v`.

## Exit codes

| Code | When |
|---|---|
| `0` | success (`compile` wrote the file, `check` passed, `version`) |
| `1` | no arguments/unknown command; the file could not be read or written; a compilation error |

The return code of the program's `main` is **not** the return code of `latentc`:
the CLI compiles rather than executes. Execution is the job of the host runtime
(see [Running WASM](../guide/wasm-and-execution.md)).

## Exact compiler error texts

The compiler returns the first error as a string; the texts are formed in
`src/lexer/error.rs`, `src/parser/error.rs`, `src/typechecker/types/mod.rs`:

| Stage | Example text |
|---|---|
| Lexer | `Неожиданный символ '#' на строке 1:14` |
| Lexer | `Незавершённая строка на строке 1:20` |
| Lexer | `Неверная escape-последовательность '\q' на строке 1:26` |
| Parser | `Ошибка парсинга на строке 1:20: ожидалось ';', найдено RBrace` |
| Parser | `Неожиданный конец файла: ожидалось '}'` |
| Parser | `Неверная цель присваивания на строке 1:5` |
| Types | `Неопределённая переменная 'x' на строке 3:12` |
| Types | `Несовпадение типов на строке 2:8: ожидалось 'bool', найдено 'float'` |
| Types | `Несовпадение арности на строке 1:10: ожидалось 2 аргументов, найдено 3` |
| Codegen | `Builtin 'channel' не поддерживается движком №2 (требует host-рантайма)` |
| Codegen | `Unknown function: foo` |

Codegen error texts are free-form English strings without a line number; lexer,
parser, and type errors are in Russian and include `строка:столбец`.
`expected`/`found` in type mismatch messages are historically **inverted**
relative to intuition: `let x: string = 42;` yields
`ожидалось 'float', найдено 'string'` (in fact, the other way round).

Errors from several independent type checks are joined with `; `.

## Example: checking in CI

```bash
set -e
cargo build --bin latentc
for f in examples/*.lat; do
  ./target/debug/latentc check "$f"
done
```

To check a compiled module, use `scripts/verify-wasm.mjs`:

```bash
./target/debug/latentc compile hello.lat
node scripts/verify-wasm.mjs hello.wasm --run --expect=0
# validate: ok
# instantiate: ok
# main() = 0
```

## See also

- [Installation](./install.md) — how to build `latentc` and `compiler.wasm`.
- [Running WASM](../guide/wasm-and-execution.md) — the ABI, the `env.print`
  import, running in Node.js.
- [Web IDE](./web-ide.mdx) — compilation without the CLI.
