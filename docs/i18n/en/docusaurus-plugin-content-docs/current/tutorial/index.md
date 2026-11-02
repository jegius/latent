---
title: Tutorial
sidebar_label: Overview
sidebar_position: 1
description: A step-by-step Latent tutorial — from Hello, world to a capstone project.
---

# Tutorial

This tutorial takes you from your first program to a small, complete project.
Each chapter is a compilable program plus an explanation. All examples are checked
by the engine #2 compiler when the documentation is built, and in the
[playground](../getting-started/web-ide.mdx) you can run them on engine #1.

## How to work through it

1. Read the chapter and run the code — in the playground or with `latentc` + Node.js
   (see [Hello, world](../getting-started/hello-world.md)).
2. Change the examples and watch how the behavior changes.
3. Every chapter ends with an exercise; the tutorial ends with a capstone.

## Outline

| # | Chapter | What you will learn |
|---|---|---|
| 1 | [Hello, world](./01-hello-world.md) | `main`, `print`, comments, returning a status code |
| 2 | [Variables and types](./02-variables-and-types.md) | `let`, type inference, `int`/`float`/`bool`/`string` |
| 3 | [Operators and control flow](./03-operators-and-control-flow.md) | arithmetic, comparisons, `if`/`else`, `while`, `for` |
| 4 | [Functions and recursion](./04-functions-and-recursion.md) | parameters, return, recursion, mutual recursion |
| 5 | [Arrays and strings](./05-arrays-and-strings.md) | literals, indices, `push`/`pop`, `for-in`, concatenation |
| 6 | [Classes](./06-classes.md) | fields, methods, `new`, `this`, `init` |
| 7 | [Enums and match](./07-enums-and-match.md) | sum types, pattern matching, `Ok`/`Err` |
| 8 | [Lambdas and higher-order functions](./08-lambdas-and-higher-order.md) | `fn(x) => ...`, closures, higher-order functions |
| 9 | [Tests and contracts](./09-tests-and-contracts.md) | `test`, `assert`, `assert_eq`, engine limits |
| 10 | [Capstone](./10-capstone.md) | classes + enum + match + closures + tests |

## Requirements

- Node.js ≥ 18 if you run WASM in Node.js; a browser if you use the playground.
- A built `latentc` (chapters 1–10) — see [Installation](../getting-started/install.md).

Let's start: [Hello, world](./01-hello-world.md).
