---
title: "AI и тензоры"
description: "Разбор AI-примеров web-ide: ai_infer, ai_embed, ai_stream/stream_next, параллельный AI-пайплайн, тензоры/семантика, тесты и контракты. Только движок №1 (host-рантайм)."
sidebar_position: 7
---

# AI и тензоры

AI-примитивы выполняет **только движок №1** (JS-интерпретатор) и только при
**Run with AI**. Движок №2 (Rust→WASM) на этих примерах выдаёт ошибку
«требует host-рантайма». Подробная семантика — в
[AI-рантайме](../specs/ai-runtime.md).

:::warning
Все блоки этого раздела помечены `// Не компилируется движком №2: ...` — это
host-only примеры для web IDE. В обычном «Run» (без AI) AI-функции дают
`AI is not enabled. Use "Compile & Run with AI" button.`
:::

## `ai_infer.lat` — инференс модели

`web-ide/examples/ai_infer.lat`:

```latent
// Не компилируется движком №2: ai_infer — host-функция движка №1
// AI inference: ask the model to analyze computed results
// Run with "🤖 Compile & Run with AI"

fn main() -> int {
    // Compute some statistics
    let data = [12, 45, 7, 89, 23, 56, 91, 34];
    let sum = 0;
    for (let i = 0; i < data.length; i = i + 1) {
        sum = sum + data[i];
    }
    let mean = sum / data.length;
    print("data:", data);
    print("mean:", mean);

    // AI inference: analyze the dataset
    let analysis = ai_infer("gpt-4", "Analyze this dataset: [12, 45, 7, 89, 23, 56, 91, 34] with mean 44.625");
    print("AI analysis:", analysis);

    // AI inference: suggest an algorithm
    let suggestion = ai_infer("gpt-4", "Suggest a sorting algorithm for nearly-sorted data");
    print("AI suggestion:", suggestion);

    return 0;
}
```

Что увидите при **Run with AI** (mock-провайдер по умолчанию):

```text
data: [12, 45, 7, 89, 23, 56, 91, 34]
mean: 44.625
AI analysis: [gpt-4] detected 9 numeric values (sum=401.625, mean=44.63, std=28.50).
AI suggestion: [gpt-4] sorting pattern recognized — comparison-based, lower bound O(n log n).
```

Разбор: `ai_infer(model, prompt)` возвращает строку. Без AI-режима — исключение.
Mock-инференс детерминирован: он «анализирует» числа и ключевые слова в
промпте (sort/sum/recursion/error). Если настроен реальный гейтвей (Ollama /
OpenAI-compatible), ответ приходит из модели и кэшируется между запусками
(`provider::model::prompt`).

## `ai_embed.lat` — эмбеддинги и косинусное сходство

`web-ide/examples/ai_embed.lat` (полный файл содержит ещё `magnitude` на
циклах; ниже — суть):

```latent
// Не компилируется движком №2: ai_embed — host-функция движка №1
fn main() -> int {
    let v1 = ai_embed("parallel map-reduce sum of squares");
    let v2 = ai_embed("concurrent reduction with goroutines");
    let v3 = ai_embed("recipe for chocolate cake");

    print("embedding dims:", v1.length);
    print("v1[0..3]: [", v1[0], v1[1], v1[2], v1[3], "]");

    let sim_related = cosine_similarity(v1, v2);
    let sim_unrelated = cosine_similarity(v1, v3);

    print("similarity(related texts):  ", sim_related);
    print("similarity(unrelated texts):", sim_unrelated);

    return 0;
}
```

Что увидите при **Run with AI**:

```text
embedding dims: 8
v1[0..3]: [ -0.662 -1.62 0.718 -2.24 ]
similarity(related texts):   0.6315607361975832
similarity(unrelated texts): 0.46168978776104225
```

Разбор: `ai_embed` всегда даёт **8-мерный** детерминированный mock-вектор
(гейтвей для эмбеддингов не используется). `cosine_similarity` — host-builtin
движка №1.

## `ai_streaming.lat` — поток токенов

`web-ide/examples/ai_streaming.lat`:

```latent
// Не компилируется движком №2: ai_stream/stream_next — host-функции движка №1
fn main() -> int {
    let handle = ai_stream("gpt-4", "stream a short sentence about parallelism");

    let token = stream_next(handle);
    let count = 0;
    while (token != null) {
        print("token", count, ":", token);
        count = count + 1;
        token = stream_next(handle);
    }

    print("total tokens:", count);
    return count;
}
```

Вывод (Run with AI, mock):

```text
token 0 : [gpt-4]
token 1 : consider
token 2 : adding
token 3 : error
token 4 : handling
token 5 : for
token 6 : edge
token 7 : cases.
total tokens: 8
```

Разбор: `ai_stream` синхронно получает ответ и режет его по пробелам на
токены, возвращая целочисленный handle; `stream_next` отдаёт следующий токен
или `null` в конце. Настоящего сетевого стриминга нет.

## `ai_pipeline.lat` — AI + горутины

`web-ide/examples/ai_pipeline.lat`:

```latent
// Не компилируется движком №2: каналы и ai_infer/ai_embed — host-фичи движка №1
fn worker(data: [int], start: int, end: int, ch: channel) {
    let sum = 0;
    for (let i = start; i < end; i = i + 1) {
        sum = sum + data[i] * data[i];
    }
    ch.send(sum);
}

fn main() -> int {
    let data = [];
    for (let i = 1; i <= 1000; i = i + 1) {
        data.push(i);
    }

    let ch = channel();
    let workers = 4;
    let chunk = data.length / workers;
    for (let w = 0; w < workers; w = w + 1) {
        let start = w * chunk;
        let end = start + chunk;
        spawn worker(data, start, end, ch);
    }

    let total = 0;
    for (let w = 0; w < workers; w = w + 1) {
        let partial = ch.recv();
        print("Worker", w, "partial sum of squares:", partial);
        total = total + partial;
    }

    let insight = ai_infer("gpt-4", "Analyze parallel sum of squares result 333833500");
    print("AI Insight:", insight);

    let vec = ai_embed("parallel map-reduce sum of squares");
    print("Embedding (first 4 dims): [", vec[0], vec[1], vec[2], vec[3], "]");

    return total;
}
```

Вывод (Run with AI): те же partial sums, что в
[`parallel_sum`](./concurrency.md), плюс:

```text
AI Insight: [gpt-4] detected 1 numeric values (sum=333833500, mean=333833500.00, std=0.00); reduction pattern — parallelizable via map-reduce.
Embedding (first 4 dims): [ -0.662 -1.62 0.718 -2.24 ]
```

## `tensors.lat` — тензоры и семантика

`web-ide/examples/tensors.lat`:

```latent
// Не компилируется движком №2: tensor/matmul/semantic — host-функции движка №1
fn main() -> int {
    let a = tensor([[1, 2], [3, 4]]);
    let b = tensor([[5, 6], [7, 8]]);

    let c = matmul(a, b);
    print("matmul[0][0] =", c.data[0][0]);
    print("C shape =", c.shape);

    let s1 = semantic("the quick brown fox");
    let s2 = semantic("the quick brown fox");
    let sim = cosine_similarity(s1, s2);
    print("self-similarity =", sim);

    let z = zeros(3);
    print("zeros =", z);
    print("rank =", c.rank);

    return c.data[0][0] + c.rank;
}
```

Вывод (движок №1):

```text
matmul[0][0] = 19
C shape = [2, 2]
self-similarity = 1.0000000000000002
zeros = Tensor(shape=[3], data=[0, 0, 0])
rank = 2
```

`main` возвращает `21` (`19 + 2`). Тензоры/`semantic` не требуют AI-режима —
это обычные builtins движка №1.

## `testing_contracts.lat` — тесты, snapshot, контракты

`web-ide/examples/testing_contracts.lat`:

```latent
// Не компилируется движком №2: snapshot/ai_contract/enforce_contract — host-функции
@forall("array")
fn non_empty_length(arr) {
    assert(arr.length >= 0);
}

@ai_contract("sorting")
fn sorting_contract(f) {
    assert(true);
}

test "arithmetic" {
    assert(1 + 1 == 2);
    assert_eq(2 * 3, 6, "multiplication");
}

test "arrays" {
    let a = [1, 2, 3];
    assert(a.length == 3);
    assert_eq(a[0], 1);
}

fn main() -> int {
    // snapshot records a named value for regression tracking
    snapshot("demo");
    let c = ai_contract("ordering");
    enforce_contract(c);
    print("contracts active");
    return 1;
}
```

Вывод (движок №1): `contracts active`; тестовые блоки исполняются после
`main`, но их результаты в UI не выводятся.

Важно (честно):

- `@forall`/`@ai_contract` — **инертные декораторы**: property-based прогонов
  нет; более того, в движке №2 декорированная функция не регистрируется как
  функция (вызов даст `Unknown function`).
- `snapshot(name)` — заглушка: запоминает ключ и возвращает `true`, значения не
  сравниваются.
- `ai_contract(name)` возвращает объект-маркер, `enforce_contract` — всегда
  `true`; проверок нет.
- Всё это — host-фичи движка №1; в №2 ошибка компиляции.

## Как запускать

1. Откройте [Web IDE](../tooling/web-ide.md), загрузите пример.
2. `Ctrl/⌘+Shift+Enter` (**Run with AI**) — для `ai_*`; для `tensors`/
   `testing_contracts` достаточно **Run**.
3. Если AI-гейтвей не настроен — используется mock (детерминированный);
   при ошибке сети в консоль печатается `[AI] Gateway error: ... — falling
   back to mock`.

## Связанные разделы

- [AI-рантайм](../specs/ai-runtime.md) — точная семантика и настройки.
- [Builtins](../reference/builtins.md) — раздел host-only и AI-функции.
- [Конкурентность](./concurrency.md) — `spawn`/каналы, используемые в pipeline.
- [Web IDE](../tooling/web-ide.md) — настройки AI Gateway.
