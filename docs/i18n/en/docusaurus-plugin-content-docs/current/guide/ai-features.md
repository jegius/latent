---
title: AI Primitives
sidebar_label: AI Primitives
sidebar_position: 13
description: Inference, embeddings, streaming, tensors, and contracts — syntax, engine #1 semantics, and engine #2 errors.
---

# AI Primitives

:::caution Engine #1 only (host runtime)

The Latent AI primitives are a **boundary with the host**. They are executed by the
JS interpreter (engine #1) through the AI gateway (or a mock mode). The Rust
compiler (engine #2) deliberately refuses to compile them:

```text
Builtin 'ai_infer' не поддерживается движком №2 (требует host-рантайма)
```

All the examples on this page are marked `// Does not compile with engine #2` and are
validated as expected-invalid.

:::

## Keywords

`ai`, `model`, `agent`, `embedding`, `tensor`, `semantic` are hard keywords;
`model`, `agent`, `embedding`, `tensor`, `semantic` are "soft": they are allowed as
names (`let model = 1;`, `obj.agent`). There is no dedicated "agent" syntax in the
parser — the AI capabilities are implemented as built-in functions.

## Inference: `ai_infer`

```text
ai_infer(model: string, prompt: string) -> string
```

```latent
// Does not compile with engine #2: ai_infer requires a host runtime.
fn main() -> int {
    let answer = ai_infer("gpt-4", "Explain WebAssembly in one sentence");
    print(answer);
    return 0;
}
```

- in a browser with a configured provider — a real request to the AI gateway;
- without a provider — a mock response (a deterministic string);
- in the playground it requires **Run with AI** mode; without it — the error
  `AI is not enabled. Use "Compile & Run with AI" button.`.

## Embeddings

```text
ai_embed(text: string) -> [float]
cosine_similarity(a: [float], b: [float]) -> float
dot(a, b) -> float
magnitude(v) -> float
```

```latent
// Does not compile with engine #2: ai_embed requires a host runtime.
fn main() -> int {
    let a = ai_embed("parallel map-reduce");
    let b = ai_embed("concurrent reduction");
    print("dimensions:", a.length);
    print("similarity:", cosine_similarity(a, b));
    return 0;
}
```

In mock mode an embedding is a deterministic hash projection of the text into a
vector; `cosine_similarity` computes the cosine between the vectors.

## Streaming

```text
ai_stream(model, prompt) -> handle
stream_next(handle) -> string | null
```

```latent
// Does not compile with engine #2: ai_stream/stream_next require a host runtime.
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

Streaming yields tokens one at a time; `stream_next` returns `null` when the stream
is over.

## Tensors and semantic vectors

```text
tensor(data) -> Tensor            // .data, .shape, .rank
zeros(n), ones(n) -> Tensor
matmul(a, b) -> Tensor
semantic(text) -> Semantic
cosine_similarity(a, b) -> float
```

```latent
// Does not compile with engine #2: tensor/matmul require a host runtime.
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

`semantic("text")` returns a semantic vector that `cosine_similarity` can be applied
to.

## Code generation: `ai_generate!`

```text
ai_generate!("prompt") -> string
```

```latent
// Does not compile with engine #2: ai_generate! requires a host runtime.
fn main() -> int {
    let snippet = ai_generate!("Write a Latent function that doubles a number");
    print(snippet);
    return 0;
}
```

This is an **expression**, not a statement; `!` is part of the syntax, and a
parenthesized string must follow it. In the JS engine `ai_generate` is not
implemented as a builtin (`Undefined variable`), so the construct is effectively
available only as engine #2 grammar — where, in turn, it runs into a host error.

## Self-repair and AI contracts

In the playground the **Run with AI** mode enables:

- AI insights about the code;
- self-repair: up to 3 fix attempts driven by the error text
  (`web-ide/compiler/repair.js`);
- AI contracts: `ai_contract("...")` → `Contract`, `enforce_contract(c)`;
- `snapshot("name")` — recording a value for regressions.

```latent
// Does not compile with engine #2: contracts require a host runtime.
fn main() -> int {
    let c = ai_contract("sorted output");
    enforce_contract(c);
    snapshot("demo");
    return 0;
}
```

## Engine #2 limitations

| Primitive | Engine #2 |
|---|---|
| `ai_infer`, `ai_embed`, `ai_stream`, `stream_next` | host runtime error |
| `tensor`, `semantic`, `matmul`, `cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones` | host runtime error |
| `ai_generate!` | host runtime error (after successful parsing) |
| `snapshot`, `ai_contract`, `enforce_contract` | host runtime error |
| `channel` | host runtime error |

The AI primitives are neither emulated nor replaced with stubs: without a host they
are unavailable.

Next: [Tests and contracts](./testing-and-contracts.md).
