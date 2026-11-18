---
title: AI-примитивы
sidebar_label: AI-примитивы
sidebar_position: 13
description: Инференс, эмбеддинги, стриминг, тензоры и контракты — синтаксис, семантика движка №1 и ошибки движка №2.
---

# AI-примитивы

:::caution Только движок №1 (host-рантайм)

AI-примитивы Latent — это **граница с хостом**. Их исполняет JS-интерпретатор
(движок №1) через AI-гейтвей (или mock-режим). Rust-компилятор (движок №2)
сознательно отказывается их компилировать:

```text
Builtin 'ai_infer' не поддерживается движком №2 (требует host-рантайма)
```

Все примеры на этой странице помечены `// Не компилируется движком №2` и
проверяются как ожидаемо невалидные.

:::

## Ключевые слова

`ai`, `model`, `agent`, `embedding`, `tensor`, `semantic` — жёсткие ключевые
слова; `model`, `agent`, `embedding`, `tensor`, `semantic` — «мягкие»: они
допустимы как имена (`let model = 1;`, `obj.agent`). Отдельного синтаксиса
«агентов» в парсере нет — AI-возможности реализованы встроенными функциями.

## Инференс: `ai_infer`

```text
ai_infer(model: string, prompt: string) -> string
```

```latent
// Не компилируется движком №2: ai_infer требует host-рантайма.
fn main() -> int {
    let answer = ai_infer("gpt-4", "Explain WebAssembly in one sentence");
    print(answer);
    return 0;
}
```

- в браузере с настроенным провайдером — реальный запрос к AI-гейтвею;
- без провайдера — mock-ответ (детерминированная строка);
- в playground требует режима **Run with AI**; без него — ошибка
  `AI is not enabled. Use "Compile & Run with AI" button.`.

## Эмбеддинги

```text
ai_embed(text: string) -> [float]
cosine_similarity(a: [float], b: [float]) -> float
dot(a, b) -> float
magnitude(v) -> float
```

```latent
// Не компилируется движком №2: ai_embed требует host-рантайма.
fn main() -> int {
    let a = ai_embed("parallel map-reduce");
    let b = ai_embed("concurrent reduction");
    print("dimensions:", a.length);
    print("similarity:", cosine_similarity(a, b));
    return 0;
}
```

В mock-режиме эмбеддинг — детерминированная хэш-проекция текста в вектор;
`cosine_similarity` считает косинус между векторами.

## Стриминг

```text
ai_stream(model, prompt) -> handle
stream_next(handle) -> string | null
```

```latent
// Не компилируется движком №2: ai_stream/stream_next требуют host-рантайма.
fn main() -> int {
    let handle = ai_stream("gpt-4", "stream a short sentence about parallelism");
    let token = stream_next(handle);
    let count = 0;
    while (token != null) {
        print(token);
        count = count + 1;
        token = stream_next(handle);
    }
    print("tokens:", count);
    return count;
}
```

Стриминг отдаёт токены по одному; `stream_next` возвращает `null`, когда поток
закончился.

## Тензоры и семантические векторы

```text
tensor(data) -> Tensor            // .data, .shape, .rank
zeros(n), ones(n) -> Tensor
matmul(a, b) -> Tensor
semantic(text) -> Semantic
cosine_similarity(a, b) -> float
```

```latent
// Не компилируется движком №2: tensor/matmul требуют host-рантайма.
fn main() -> int {
    let a = tensor([[1, 2], [3, 4]]);
    let b = tensor([[5, 6], [7, 8]]);
    let c = matmul(a, b);
    print("c[0][0]:", c.data[0][0]);
    print("rank:", c.rank);
    let z = zeros(3);
    print("zeros rank:", z.rank);
    return 0;
}
```

`semantic("text")` возвращает семантический вектор, по которому можно считать
`cosine_similarity`.

## Генерация кода: `ai_generate!`

```text
ai_generate!("prompt") -> string
```

```latent
// Не компилируется движком №2: ai_generate! требует host-рантайма.
fn main() -> int {
    let snippet = ai_generate!("Write a Latent function that doubles a number");
    print(snippet);
    return 0;
}
```

Это **выражение**, а не инструкция; `!` — часть синтаксиса, за ним обязательна
строка в скобках. В JS-движке `ai_generate` не реализован как builtin
(`Undefined variable`), поэтому конструкция фактически доступна только как
грамматика движка №2 — где она, в свою очередь, упирается в host-ошибку.

## Самоисправление и AI-контракты

В playground режим **Run with AI** включает:

- AI-инсайты по коду;
- self-repair: до 3 попыток исправления по тексту ошибки
  (`web-ide/compiler/repair.js`);
- AI-контракты: `ai_contract("...")` → `Contract`, `enforce_contract(c)`;
- `snapshot("name")` — запись значения для регрессий.

```latent
// Не компилируется движком №2: контракты требуют host-рантайма.
fn main() -> int {
    let c = ai_contract("sorted output");
    enforce_contract(c);
    snapshot("demo");
    return 0;
}
```

## Ограничения движка №2

| Примитив | Движок №2 |
|---|---|
| `ai_infer`, `ai_embed`, `ai_stream`, `stream_next` | ошибка host-рантайма |
| `tensor`, `semantic`, `matmul`, `cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones` | ошибка host-рантайма |
| `ai_generate!` | ошибка host-рантайма (после успешного парсинга) |
| `snapshot`, `ai_contract`, `enforce_contract` | ошибка host-рантайма |
| `channel` | ошибка host-рантайма |

AI-примитивы не эмулируются и не заменяются заглушками: без хоста они
недоступны.

Дальше: [Тесты и контракты](./testing-and-contracts.md).
