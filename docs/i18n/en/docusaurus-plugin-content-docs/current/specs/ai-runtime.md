---
title: "AI Runtime"
description: "Latent AI primitives: ai_infer/ai_embed/ai_stream/stream_next, ai_generate!, tensor/semantic/matmul, contracts and snapshot; the semantics in the JS engine, the behavior in engine #2, and configuring AI Gateway in the web IDE."
sidebar_position: 4
---

# AI runtime

The Latent AI primitives are implemented **only by engine #1** (JS) and require a host
runtime — a browser/IDE with an AI gateway. Engine #2 (Rust→WASM) does not execute them
and reports a compilation error. Below is what is actually implemented **in the code**,
not in the design.

Sources: `web-ide/compiler/interpreter-builtins.js`,
`interpreter-ai.js`, `interpreter.js`, `ai-config.js`, `ai-gateway.js`,
`run.js`, `repair.js`, `src/codegen/emit_call/mod.rs` (the host list),
`src/parser/expressions/prefix.rs` (`ai_generate!`).

## Summary of the primitives

| Primitive | Where it is implemented | Engine #2 |
|---|---|---|
| `ai_infer(model, prompt) -> string` | builtin #1 | error `Builtin 'ai_infer' не поддерживается…` (not supported…) |
| `ai_embed(text) -> [float]` | builtin #1 | error |
| `ai_stream(model, prompt) -> int` | builtin #1 (a handle) | error |
| `stream_next(handle) -> string\|null` | builtin #1 | error |
| `ai_generate!("prompt")` | the Rust parser; codegen — an error | `AI-примитивы требуют host-рантайма движка №1` (AI primitives require the engine #1 host runtime) |
| `tensor(data) -> Tensor` | builtin #1 | error |
| `semantic(text) -> Semantic` | builtin #1 | error |
| `matmul(a, b)`, `dot(a,b)`, `cosine_similarity(a,b)`, `magnitude(v)`, `zeros(n)`, `ones(n)` | builtin #1 | error |
| `snapshot(name) -> bool` | builtin #1 (a stub) | error |
| `ai_contract(name) -> Contract` | builtin #1 (a marker object) | error |
| `enforce_contract(c) -> bool` | builtin #1 (a no-op) | error |
| `@forall(...)`, `@ai_contract(...)`, `@test(...)` | parser decorators; **inert** in both | parsed/typed, no code is generated |

## What is implemented in engine #1

### `ai_infer(model, prompt)`

1. If AI is not enabled (`Run` without AI) — the exception
   `AI is not enabled. Use "Compile & Run with AI" button.`
2. If `interpreter.aiCache` has an answer for this prompt, it is taken from there
   (the cache is filled by the pre-fetch in `run.js`).
3. Otherwise — `mockInfer(model, prompt)` — a **deterministic mock**:
   - it looks for numbers in the prompt and prints statistics (count/sum/mean/std);
   - it recognizes the keywords `sort|order|partition`, `sum|total|reduce`,
     `recursive|recursion`, `error|edge|empty|null` and adds the corresponding
     "insights";
   - if it found nothing, it picks a phrase from a fixed set by hash.
   The answer format: `[<model>] <insight1>; <insight2>.`.

### Pre-fetch and cache (only with "Run with AI")

`runLatent` (`compiler/run.js`):

- if the provider is not `mock`, the parser is used to collect string prompts **only
  from `ai_infer(model, "literal")` calls** (the `collectAIPrompts` function); dynamic
  prompts are not pre-fetched;
- for each prompt `persistentAICache` is checked first (the key is
  `provider::model::prompt`), then `aiInferRemote` is called;
- a network/gateway error — `[AI] Gateway error: … — falling back to mock`
  (the answer is not cached);
- the cache survives restarts of the program (in page memory, not in `localStorage`).

### `ai_embed(text)`

Always the deterministic `mockEmbed(text)`: an **8-dimensional** vector with values
≈ `[-1, 1]`. No gateway is used for embeddings. The vector is substituted into
`semantic(text)` and is available by index (`s[i]` → `vector[i]`).

### `ai_stream(model, prompt)` / `stream_next(handle)`

- `ai_stream` synchronously calls `ai_infer` and splits the answer by whitespace into
  tokens; it returns an integer handle (starting from 1).
- `stream_next(handle)` returns the next token or `null` if the tokens are exhausted or
  the handle is unknown.
- There is no asynchrony/network streaming in the implementation — it is a deterministic
  splitting of an already received answer.

### Tensors and semantics

- `tensor(data)` — a `Tensor` object with the fields `data` (nested arrays) and
  `shape` (derived from the data). Methods/properties: `shape`, `rank`, `data`,
  `size()`, `reshape(shape)`.
- `matmul(a, b)` — matrix multiplication (2D×2D, 2D×1D, 1D×2D) with a dimension
  consistency check; the result is a new `Tensor`.
- `dot`, `magnitude`, `cosine_similarity` — the dot product, the norm, and the cosine;
  the operands are converted to flat vectors (`vectorOf`).
- `zeros(n)`, `ones(n)` — one-dimensional tensors.
- `semantic(text)` — the object `{__semantic: true, text, vector}`; `vector` is a mock
  embedding; `cosine_similarity` accepts a `Semantic`.

### Tests, snapshot, contracts

- `test "name" { ... }` — the block runs after `main` (engine #1); the results are in
  `interpreter.testResults` and are not shown in the UI.
- `snapshot(name)` — a **stub**: it registers the key and returns `true`; values are
  neither saved nor compared.
- `ai_contract(name)` — returns the object `{__contract: true, name}`;
  `enforce_contract(c)` — always `true`, there are no checks.
- The decorators `@forall`, `@ai_contract`, `@test` syntactically wrap a declaration;
  the parser registers the target as a function, but the decorator is **not executed**
  (there are no property-based runs).

## What neither engine has

In `tooling/language-data/language.json` and in older descriptions you may find the
syntax `ai.load(...)`, `ai.infer(...)`, `ai.embed(...)`, `ai.agent(...)`, as well as
`model`/`agent`/`embedding` declarations. **The implemented parser has none of this:**

- the Rust AST has the nodes `AiLoad`, `AiInfer`, `AiEmbed`, `AiAgent`, `AiAgentCall`,
  but **the parser never creates them** (`src/parser/expressions/*` has no corresponding
  branches);
- the word `ai` in operand position becomes the identifier `"ai"`, so
  `ai.load("gpt-4")` produces «Неопределённая переменная 'ai'» (undefined variable);
- in engine #1 `model`/`agent`/`embedding` are not keywords at all — they are ordinary
  identifiers;
- the only AI "macro" that is really parsed is `ai_generate!("prompt")`; it is typed as
  `string`, but codegen #2 refuses: `AI-примитивы требуют host-рантайма движка №1`.
  In engine #1 `ai_generate!` is a parsing error.

Bottom line: **the working Latent AI API is the builtin functions** `ai_infer`,
`ai_embed`, `ai_stream`, `stream_next`, `tensor`, `semantic`, `matmul`, and so on, not
the `ai.*` namespace.

## Configuring AI in the web IDE

The `AI` panel (the AI button in the toolbar/the `AI → AI Gateway Settings` menu):

| Field | Default (HTML) | Meaning |
|---|---|---|
| Provider | `ollama` (the `AIConfig` default is `mock`) | `mock` / `ollama` / `openai-compatible` |
| Base URL | `http://localhost:11434` | the base URL of the gateway |
| Model | `qwen3:4b` | the model name |
| API Key | empty | the Bearer token for `openai-compatible` |

- The settings are stored in `localStorage` under the key `latent-ai-config`.
- "Test Connection": for `ollama` — `GET <baseUrl>/api/tags`; for `openai-compatible` —
  `GET <baseUrl>/models` with `Authorization: Bearer …`; for `mock` — immediately `ok`.
- The request timeout is 120 000 ms (`AIConfig.timeout`).
- The AI primitives work only with **Run with AI** (otherwise the error
  "AI is not enabled").
- For `ollama`, `POST /api/generate` is used (`stream: false`,
  `temperature: 0.2`), and reasoning blocks of the form
  `&lt;think&gt; … &lt;/think&gt;` are cut out of the answer (see the regex in
  `ai-gateway.js`).
- For `openai-compatible` — `POST /chat/completions` with a single user message.
- The model from the settings takes precedence over the model literal in the code
  (`AIConfig.model || model`).

:::warning
The API key is stored in `localStorage` in plain text, and requests go directly from the
browser (CORS is required on the gateway). For a public playground, use mock or a local
Ollama.
:::

## Behavior of engine #2 (Rust→WASM)

- `ai_infer`, `ai_embed`, `ai_stream`, `stream_next`, `tensor`, `semantic`,
  `matmul`, `cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones`,
  `snapshot`, `ai_contract`, `enforce_contract`, `channel` are in the
  `HOST_BUILTINS` list (`src/codegen/emit_call/mod.rs`) and produce a compilation error:
  `Builtin '<имя>' не поддерживается движком №2 (требует host-рантайма)` ("builtin is
  not supported by engine #2 (requires a host runtime)").
- `ch.send(...)`/`ch.recv()` — `Метод '…' не поддерживается движком №2
  (требует host-рантайма)` ("the method is not supported by engine #2 (requires a host
  runtime)").
- `ai_generate!("…")` — `AI-примитивы требуют host-рантайма движка №1`.
- The type checker usually does **not** complain: `ai_infer` and the others are declared
  as variadic builtins (`VARIADIC_BUILTINS`), so the error only arises at the codegen
  stage.
- The self-hosted compiler itself does not know the AI primitives.

## Examples (host-only)

The following blocks **do not compile with engine #2** — they are examples for
"Run with AI" in the web IDE:

```latent
// Does not compile with engine #2: AI primitives require a host runtime (engine #1)
fn main() -> int {
    let analysis = ai_infer("gpt-4", "Analyze this dataset: [12, 45, 7]");
    print(analysis);
    return 0;
}
```

```latent
// Does not compile with engine #2: ai_embed is a host function of engine #1
fn main() -> int {
    let v = ai_embed("parallel map-reduce");
    print("dims:", v.length);
    return 0;
}
```

```latent
// Does not compile with engine #2: ai_stream/stream_next are host functions of engine #1
fn main() -> int {
    let handle = ai_stream("gpt-4", "stream a short sentence");
    let token = stream_next(handle);
    let count = 0;
    while (token != null) {
        count = count + 1;
        token = stream_next(handle);
    }
    return count;
}
```

The full working examples are `web-ide/examples/ai_infer.lat`,
`ai_embed.lat`, `ai_streaming.lat`, `ai_pipeline.lat`, `tensors.lat`
(walkthrough — [examples/ai](../examples/ai.md)).

## Related sections

- [Web IDE engines](./engines.md) — how "Run with AI" is enabled.
- [Builtins](../reference/builtins.md) — the summary table (the host-only section).
- [Self-hosted compiler](./selfhost.md) — why AI is not there.
- [Web IDE](../tooling/web-ide.md) — settings and keyboard shortcuts.
