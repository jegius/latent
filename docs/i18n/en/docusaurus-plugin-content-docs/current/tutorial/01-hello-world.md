---
title: "Chapter 1. Hello, world"
sidebar_label: "01. Hello, world"
sidebar_position: 2
description: Your first Latent program — main, print, comments, and the exit code.
---

# Chapter 1. Hello, world

## The program

```latent
// The first Latent program.
// The entry point is the main function. It returns int — the exit code.

fn main() -> int {
    print("Hello, world!");
    return 0;
}
```

Run it in the [playground](../getting-started/web-ide.mdx) with the **Run** button
or compile it to WASM:

```bash
cargo build --bin latentc
./target/debug/latentc compile hello.lat hello.wasm
```

To see the execution result in Node.js, use the host runtime from the
[Hello, world (getting-started)](../getting-started/hello-world.md) chapter.

## What matters here

- **`fn main() -> int`** — the entry point. The compiler exports `main` from the
  WASM module; the host calls it and gets back an `int`.
- **`return 0;`** — the exit code. `0` means success, a non-zero value means
  failure. If `main` is declared without a `return`, the compiler inserts `0`.
- **`print(...)`** — a built-in function; it accepts any number of arguments.
- **Comments**: `//` to the end of the line and `/* ... */` (blocks can be nested).

## Several lines

```latent
fn main() -> int {
    print("Latent");
    print("compiles to WebAssembly");
    let answer = 42;
    print("answer:", answer);
    return 0;
}
```

In engine #2, `print` calls the host function `env.print` for **every** argument —
so `answer` ends up on a separate line. In engine #1 all arguments are printed on
one line, separated by spaces. This is the first noticeable difference between the
engines; the rest are collected in the
[guide](../guide/wasm-and-execution.md#engine-2-limitations).

## Comments

```latent
/* Block comment.
   /* Blocks can be nested. */
   All of this is a comment. */

fn main() -> int {
    let x = 10; // line comment to the end of the line
    print(x /* comment in the middle of an expression */ + 5);
    return 0;
}
```

## Exercise

Write a program that prints your name and the current year and returns `0`. Then
change the exit code to `7` and check it in Node.js:

```bash
node run.mjs hello.wasm
echo "exit code: $?"
# exit code: 7
```

Next: [Variables and types](./02-variables-and-types.md).
