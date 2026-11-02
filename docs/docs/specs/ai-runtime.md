---
title: "AI-рантайм"
description: "AI-примитивы Latent: ai_infer/ai_embed/ai_stream/stream_next, ai_generate!, tensor/semantic/matmul, контракты и snapshot; семантика в JS-движке, поведение в движке №2, настройка AI Gateway в web IDE."
sidebar_position: 4
---

# AI-рантайм

AI-примитивы Latent реализованы **только движком №1** (JS) и требуют
host-рантайма — браузера/IDE с AI-гейтвеем. Движок №2 (Rust→WASM) их не
исполняет и выдаёт ошибку компиляции. Ниже — что именно реализовано **в
коде**, а не в задумке.

Источники: `web-ide/compiler/interpreter-builtins.js`,
`interpreter-ai.js`, `interpreter.js`, `ai-config.js`, `ai-gateway.js`,
`run.js`, `repair.js`, `src/codegen/emit_call.rs` (host-список),
`src/parser/expressions/prefix.rs` (`ai_generate!`).

## Сводка примитивов

| Примитив | Где реализован | Движок №2 |
|---|---|---|
| `ai_infer(model, prompt) -> string` | builtin №1 | ошибка `Builtin 'ai_infer' не поддерживается…` |
| `ai_embed(text) -> [float]` | builtin №1 | ошибка |
| `ai_stream(model, prompt) -> int` | builtin №1 (handle) | ошибка |
| `stream_next(handle) -> string\|null` | builtin №1 | ошибка |
| `ai_generate!("prompt")` | парсер Rust; кодоген — ошибка | `AI-примитивы требуют host-рантайма движка №1` |
| `tensor(data) -> Tensor` | builtin №1 | ошибка |
| `semantic(text) -> Semantic` | builtin №1 | ошибка |
| `matmul(a, b)`, `dot(a,b)`, `cosine_similarity(a,b)`, `magnitude(v)`, `zeros(n)`, `ones(n)` | builtin №1 | ошибка |
| `snapshot(name) -> bool` | builtin №1 (заглушка) | ошибка |
| `ai_contract(name) -> Contract` | builtin №1 (объект-маркер) | ошибка |
| `enforce_contract(c) -> bool` | builtin №1 (no-op) | ошибка |
| `@forall(...)`, `@ai_contract(...)`, `@test(...)` | декораторы парсеров; **инертны** в обоих | парсятся/типизируются, код не генерируется |

## Что реализовано в движке №1

### `ai_infer(model, prompt)`

1. Если AI не включён (`Run` без AI) — исключение
   `AI is not enabled. Use "Compile & Run with AI" button.`
2. Если в `interpreter.aiCache` есть ответ для этого промпта — берётся оттуда
   (кэш заполняется pre-fetch'ем в `run.js`).
3. Иначе — `mockInfer(model, prompt)` — **детерминированный мок**:
   - ищет в промпте числа и печатает статистику (count/sum/mean/std);
   - распознаёт ключевые слова `sort|order|partition`, `sum|total|reduce`,
     `recursive|recursion`, `error|edge|empty|null` и добавляет
     соответствующие «инсайты»;
   - если ничего не нашёл — выбирает фразу из фиксированного набора по хэшу.
   Формат ответа: `[<model>] <инсайт1>; <инсайт2>.`.

### Pre-fetch и кэш (только «Run with AI»)

`runLatent` (`compiler/run.js`):

- если провайдер не `mock`, парсер используется для сбора строковых
  промптов **только из вызовов `ai_infer(model, "literal")`** (функция
  `collectAIPrompts`); динамические промпты не предзагружаются;
- для каждого промпта сначала ищется `persistentAICache` (ключ
  `provider::model::prompt`), затем вызывается `aiInferRemote`;
- ошибка сети/гейтвея — `[AI] Gateway error: … — falling back to mock`
  (ответ не кэшируется);
- кэш живёт между перезапусками программы (в памяти страницы, не в
  localStorage).

### `ai_embed(text)`

Всегда детерминированный `mockEmbed(text)`: **8-мерный** вектор, значения
≈ `[-1, 1]`. Гейтвей для эмбеддингов не используется. Вектор подставляется в
`semantic(text)` и доступен по индексу (`s[i]` → `vector[i]`).

### `ai_stream(model, prompt)` / `stream_next(handle)`

- `ai_stream` синхронно вызывает `ai_infer` и режет ответ по пробелам на
  токены; возвращает целочисленный handle (начиная с 1).
- `stream_next(handle)` возвращает следующий токен или `null`, если токены
  закончились/неизвестный handle.
- Никакой асинхронности/сетевого стриминга в реализации нет — это
  детерминированное разбиение уже полученного ответа.

### Тензоры и семантика

- `tensor(data)` — объект `Tensor` с полями `data` (вложенные массивы) и
  `shape` (выводится из данных). Методы/свойства: `shape`, `rank`, `data`,
  `size()`, `reshape(shape)`.
- `matmul(a, b)` — матричное умножение (2D×2D, 2D×1D, 1D×2D), проверка
  согласованности размерностей; результат — новый `Tensor`.
- `dot`, `magnitude`, `cosine_similarity` — скалярное произведение, норма,
  косинус; операнды приводятся к плоским векторам (`vectorOf`).
- `zeros(n)`, `ones(n)` — одномерные тензоры.
- `semantic(text)` — объект `{__semantic: true, text, vector}`; `vector` —
  mock-эмбеддинг; `cosine_similarity` умеет принимать `Semantic`.

### Тесты, snapshot, контракты

- `test "name" { ... }` — блок исполняется после `main` (движок №1);
  результаты — в `interpreter.testResults`, в UI не показываются.
- `snapshot(name)` — **заглушка**: регистрирует ключ и возвращает `true`;
  значения не сохраняются и не сравниваются.
- `ai_contract(name)` — возвращает объект `{__contract: true, name}`;
  `enforce_contract(c)` — всегда `true`, проверок нет.
- Декораторы `@forall`, `@ai_contract`, `@test` синтаксически обёртывают
  объявление; парсер регистрирует цель как функцию, но декоратор **не
  исполняется** (никаких property-based прогонов нет).

## Чего нет ни в одном движке

В `tooling/language-data/language.json` и старых описаниях можно встретить
синтаксис `ai.load(...)`, `ai.infer(...)`, `ai.embed(...)`, `ai.agent(...)`, а
также объявления `model`/`agent`/`embedding`. **В реализованном парсере этого
нет:**

- в Rust-AST есть узлы `AiLoad`, `AiInfer`, `AiEmbed`, `AiAgent`,
  `AiAgentCall`, но **парсер их не создаёт** (`src/parser/expressions/*`
  не содержит соответствующих ветвей);
- слово `ai` в позиции операнда становится идентификатором `"ai"`, поэтому
  `ai.load("gpt-4")` даёт «Неопределённая переменная 'ai'»;
- в движке №1 `model`/`agent`/`embedding` вообще не являются ключевыми
  словами — это обычные идентификаторы;
- единственный «макрос» AI, который реально разбирается, —
  `ai_generate!("prompt")`; он типизируется как `string`, но кодоген №2
  отказывается: `AI-примитивы требуют host-рантайма движка №1`. В движке №1
  `ai_generate!` — ошибка парсинга.

Итог: **рабочий AI-API Latent — это функции-билтины** `ai_infer`, `ai_embed`,
`ai_stream`, `stream_next`, `tensor`, `semantic`, `matmul` и т.д., а не
`ai.*`-namespace.

## Настройка AI в web IDE

Панель `AI` (кнопка AI в тулбаре/меню `AI → AI Gateway Settings`):

| Поле | По умолчанию (HTML) | Смысл |
|---|---|---|
| Provider | `ollama` (в `AIConfig` дефолт — `mock`) | `mock` / `ollama` / `openai-compatible` |
| Base URL | `http://localhost:11434` | базовый URL гейтвея |
| Model | `qwen3:4b` | имя модели |
| API Key | пусто | Bearer-токен для `openai-compatible` |

- Настройки хранятся в `localStorage` под ключом `latent-ai-config`.
- «Test Connection»: для `ollama` — `GET <baseUrl>/api/tags`; для
  `openai-compatible` — `GET <baseUrl>/models` с `Authorization: Bearer …`;
  для `mock` — сразу `ok`.
- Таймаут запросов — 120 000 мс (`AIConfig.timeout`).
- AI-примитивы работают только при **Run with AI** (иначе ошибка
  «AI is not enabled»).
- Для `ollama` используется `POST /api/generate` (`stream: false`,
  `temperature: 0.2`), из ответа вырезаются reasoning-блоки вида
  `&lt;think&gt; … &lt;/think&gt;` (см. регулярку в `ai-gateway.js`).
- Для `openai-compatible` — `POST /chat/completions` с одним user-сообщением.
- Модель из настроек имеет приоритет над литералом модели в коде
  (`AIConfig.model || model`).

:::warning
API-ключ хранится в `localStorage` в открытом виде, а запросы идут напрямую
из браузера (нужен CORS на гейтвее). Для публичного playground используйте
mock или локальный Ollama.
:::

## Поведение движка №2 (Rust→WASM)

- `ai_infer`, `ai_embed`, `ai_stream`, `stream_next`, `tensor`, `semantic`,
  `matmul`, `cosine_similarity`, `dot`, `magnitude`, `zeros`, `ones`,
  `snapshot`, `ai_contract`, `enforce_contract`, `channel` — в списке
  `HOST_BUILTINS` (`src/codegen/emit_call.rs`) и дают ошибку компиляции:
  `Builtin '<имя>' не поддерживается движком №2 (требует host-рантайма)`.
- `ch.send(...)`/`ch.recv()` — `Метод '…' не поддерживается движком №2
  (требует host-рантайма)`.
- `ai_generate!("…")` — `AI-примитивы требуют host-рантайма движка №1`.
- Типчекер при этом обычно **не** жалуется: `ai_infer` и др. объявлены как
  вариативные builtins (`VARIADIC_BUILTINS`), поэтому ошибка возникает только
  на этапе кодогена.
- Сам self-hosted компилятор AI-примитивов не знает.

## Примеры (host-only)

Следующие блоки **не компилируются движком №2** — это примеры для «Run with
AI» в web IDE:

```latent
// Не компилируется движком №2: AI-примитивы требуют host-рантайма (движок №1)
fn main() -> int {
    let analysis = ai_infer("gpt-4", "Analyze this dataset: [12, 45, 7]");
    print(analysis);
    return 0;
}
```

```latent
// Не компилируется движком №2: ai_embed — host-функция движка №1
fn main() -> int {
    let v = ai_embed("parallel map-reduce");
    print("dims:", v.length);
    return 0;
}
```

```latent
// Не компилируется движком №2: ai_stream/stream_next — host-функции движка №1
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

Полные рабочие примеры — `web-ide/examples/ai_infer.lat`,
`ai_embed.lat`, `ai_streaming.lat`, `ai_pipeline.lat`, `tensors.lat`
(разбор — [examples/ai](../examples/ai.md)).

## Связанные разделы

- [Движки web IDE](./engines.md) — как включается «Run with AI».
- [Встроенные функции](../reference/builtins.md) — сводная таблица (раздел про host-only).
- [Self-hosted компилятор](./selfhost.md) — почему AI там нет.
- [Web IDE](../tooling/web-ide.md) — настройки и горячие клавиши.
