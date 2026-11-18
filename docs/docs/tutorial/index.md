---
title: Туториал
sidebar_label: Обзор
sidebar_position: 1
description: Пошаговый туториал по Latent — от Hello, world до capstone-проекта.
---

# Туториал

Этот туториал проводит от первой программы до небольшого законченного проекта.
Каждая глава — компилируемая программа и объяснение. Все примеры проверяются
компилятором движка №2 при сборке документации, а в
[playground](../getting-started/web-ide.mdx) их можно запустить движком №1.

## Как проходить

1. Читайте главу и запускайте код — в playground или через `latentc` + Node.js
   (см. [Hello, world](../getting-started/hello-world.md)).
2. Меняйте примеры и смотрите, как меняется поведение.
3. В конце каждой главы — задание; в конце туториала — capstone.

## План

| № | Глава | Что освоите |
|---|---|---|
| 1 | [Hello, world](./01-hello-world.md) | `main`, `print`, комментарии, возврат кода |
| 2 | [Переменные и типы](./02-variables-and-types.md) | `let`, вывод типов, `int`/`float`/`bool`/`string` |
| 3 | [Операторы и управление](./03-operators-and-control-flow.md) | арифметика, сравнения, `if`/`else`, `while`, `for` |
| 4 | [Функции и рекурсия](./04-functions-and-recursion.md) | параметры, возврат, рекурсия, взаимная рекурсия |
| 5 | [Массивы и строки](./05-arrays-and-strings.md) | литералы, индексы, `push`/`pop`, `for-in`, конкатенация |
| 6 | [Классы](./06-classes.md) | поля, методы, `new`, `this`, `init` |
| 7 | [Enum и match](./07-enums-and-match.md) | sum-типы, pattern matching, `Ok`/`Err` |
| 8 | [Лямбды и высшие функции](./08-lambdas-and-higher-order.md) | `fn(x) => ...`, замыкания, функции высшего порядка |
| 9 | [Тесты и контракты](./09-tests-and-contracts.md) | `test`, `assert`, `assert_eq`, пределы движков |
| 10 | [Capstone](./10-capstone.md) | классы + enum + match + замыкания + тесты |

## Требования

- Node.js ≥ 18, если запускаете WASM в Node.js; браузер — если playground.
- Собранный `latentc` (главы 1–10) — см. [Установка](../getting-started/install.md).

Начнём: [Hello, world](./01-hello-world.md).
