---
title: ABI WebAssembly
sidebar_position: 4
description: ABI экспортов и импортов WebAssembly-модулей Latent — main и env.print.
tags: [abi, wasm, экспорт]
---

# ABI WebAssembly

Модуль, сгенерированный компилятором Latent, экспортирует `main` и импортирует
`env.print(i32)`. Вызов `print` передаёт указатель на строку в линейной памяти.

- `main` — точка входа, возвращает `i32`;
- `env.print` — печать значения через host-окружение;
- линейная память — общая для всех функций модуля.

ABI низкоуровневых примитивов (`alloc`, `load8`, `store8`, `load32`,
`store32`, `memcopy`) описан в разделе памяти.
