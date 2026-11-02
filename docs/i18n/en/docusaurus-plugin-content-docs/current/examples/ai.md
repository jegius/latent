---
title: "AI and tensors"
sidebar_label: AI and tensors
sidebar_position: 7
description: "Walkthroughs of the web-ide AI examples: ai_infer, ai_embed, ai_stream/stream_next, a parallel AI pipeline, tensors and semantics, tests and contracts. Engine #1 only (host runtime)."
---

# AI and tensors

The AI primitives are executed **only by engine #1** (the JS interpreter), and
only in **Run with AI**. On these examples engine #2 (Rust→WASM) reports
"requires the host runtime". The detailed semantics are in the
[AI runtime](../specs/ai-runtime.md).

:::warning
All blocks in this section are marked `// Does not compile with engine #2: ...` —
they are host-only examples for the web IDE. In a plain "Run" (without AI) the AI
functions produce `AI is not enabled. Use "Compile & Run with AI" button.`
:::

## `ai_infer.lat` — model inference

`web-ide/examples/ai_infer.lat`:

```latent
// Does not compile with engine #2: ai_infer is a host function of engine #1
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

What you will see with **Run with AI** (the default mock provider):

```text
data: [12, 45, 7, 89, 23, 56, 91, 34]
mean: 44.625
AI analysis: [gpt-4] detected 9 numeric values (sum=401.625, mean=44.63, std=28.50).
AI suggestion: [gpt-4] sorting pattern recognized — comparison-based, lower bound O(n log n).
```

Analysis: `ai_infer(model, prompt)` returns a string. Without AI mode it raises an
exception. The mock inference is deterministic: it "analyzes" the numbers and the
keywords in the prompt (sort/sum/recursion/error). If a real gateway is configured
(Ollama / OpenAI-compatible), the answer comes from the model and is cached
between runs (`provider::model::prompt`).

## `ai_embed.lat` — embeddings and cosine similarity

`web-ide/examples/ai_embed.lat` (the complete file also contains `magnitude` built
on loops; below is the gist):

```latent
// Does not compile with engine #2: ai_embed is a host function of engine #1
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

What you will see with **Run with AI**:

```text
embedding dims: 8
v1[0..3]: [ -0.662 -1.62 0.718 -2.24 ]
similarity(related texts):   0.6315607361975832
similarity(unrelated texts): 0.46168978776104225
```

Analysis: `ai_embed` always yields an **8-dimensional** deterministic mock vector
(the gateway is not used for embeddings). `cosine_similarity` is a host builtin of
engine #1.

## `ai_streaming.lat` — the token stream

`web-ide/examples/ai_streaming.lat`:

```latent
// Does not compile with engine #2: ai_stream/stream_next are host functions of engine #1
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

Output (Run with AI, mock):

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

Analysis: `ai_stream` obtains the answer synchronously and cuts it on whitespace
into tokens, returning an integer handle; `stream_next` returns the next token, or
`null` at the end. There is no real network streaming.

## `ai_pipeline.lat` — AI + goroutines

`web-ide/examples/ai_pipeline.lat`:

```latent
// Does not compile with engine #2: channels and ai_infer/ai_embed are host features of engine #1
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

Output (Run with AI): the same partial sums as in
[`parallel_sum`](./concurrency.md), plus:

```text
AI Insight: [gpt-4] detected 1 numeric values (sum=333833500, mean=333833500.00, std=0.00); reduction pattern — parallelizable via map-reduce.
Embedding (first 4 dims): [ -0.662 -1.62 0.718 -2.24 ]
```

## `tensors.lat` — tensors and semantics

`web-ide/examples/tensors.lat`:

```latent
// Does not compile with engine #2: tensor/matmul/semantic are host functions of engine #1
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

Output (engine #1):

```text
matmul[0][0] = 19
C shape = [2, 2]
self-similarity = 1.0000000000000002
zeros = Tensor(shape=[3], data=[0, 0, 0])
rank = 2
```

`main` returns `21` (`19 + 2`). Tensors and `semantic` do not require AI mode —
they are ordinary builtins of engine #1.

## `testing_contracts.lat` — tests, snapshots, contracts

`web-ide/examples/testing_contracts.lat`:

```latent
// Does not compile with engine #2: snapshot/ai_contract/enforce_contract are host functions
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

Output (engine #1): `contracts active`; the test blocks are executed after `main`,
but their results are not shown in the UI.

Important (honestly):

- `@forall`/`@ai_contract` are **inert decorators**: there are no property-based
  runs; moreover, in engine #2 a decorated function is not registered as a
  function (a call produces `Unknown function`).
- `snapshot(name)` is a stub: it remembers the key and returns `true`; the values
  are not compared.
- `ai_contract(name)` returns a marker object, `enforce_contract` always returns
  `true`; there are no checks.
- All of this consists of host features of engine #1; in #2 it is a compilation
  error.

## How to run them

1. Open the [Web IDE](../tooling/web-ide.md) and load an example.
2. `Ctrl/⌘+Shift+Enter` (**Run with AI**) — for `ai_*`; for `tensors`/
   `testing_contracts` plain **Run** is enough.
3. If no AI gateway is configured, the mock (deterministic) is used; on a network
   error the console prints `[AI] Gateway error: ... — falling back to mock`.

## Related sections

- [AI runtime](../specs/ai-runtime.md) — the exact semantics and the settings.
- [Builtins](../reference/builtins.md) — the host-only and AI function section.
- [Concurrency](./concurrency.md) — the `spawn`/channels used in the pipeline.
- [Web IDE](../tooling/web-ide.md) — the AI Gateway settings.
