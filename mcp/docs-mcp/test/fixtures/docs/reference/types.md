---
title: Типы
sidebar_position: 2
description: Система типов Latent — int, float, bool, string, void, массивы, каналы и функции.
tags: [типы, int, float, bool, string]
---

# Типы

Система типов Latent статическая, с выводом типов. Встроенные скаляры:
`int`, `float`, `bool`, `string`, `void`. Составные типы: массивы `[T]`,
функции `fn(T) -> R`, каналы, классы и enum.

```latent
fn main() -> int {
    let flag: bool = true;
    let pi: float = 3.14;
    if (flag) {
        return 1;
    }
    return 0;
}
```

`int` соответствует `i32` в WebAssembly, `float` — `f64`, `bool` — `i32`.
