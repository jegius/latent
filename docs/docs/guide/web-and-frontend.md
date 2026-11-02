---
title: "Latent во фронтенде"
sidebar_label: "Latent во фронтенде"
sidebar_position: 17
description: "Модель исполнения Latent-модуля в браузере: ABI main/memory/env.print, передача строк и массивов через линейную память, паттерны для JS/React/Vue/Svelte, Web Worker, кэширование, сравнение с альтернативами и ограничения."
---

# Latent во фронтенде

Latent не пытается заменить JavaScript. Его ниша во фронтенде — **чистое
вычислительное ядро**: небольшой WASM-модуль, который считает алгоритм,
разбирает строку, валидирует данные или готовит кадр, а весь UI, DOM, сеть и
хранение остаются на JS/React/Vue.

Этот гайд описывает реальный контракт такого модуля: что он импортирует и
экспортирует, как передавать данные через линейную память, какие архитектурные
паттерны работают, а какие ограничения придётся обойти. Все примеры проверены
компилятором `web-ide/compiler.wasm`; кейсы — в разделе
[«Примеры»](../examples/index.md).

## 1. Модель исполнения: модуль + JS-хост

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│ JS / React / Vue (UI)        │        │ WebAssembly.Instance (Latent) │
│                              │        │                               │
│  fetch / DOM / state         │        │  main() -> i32 | f64 | void   │
│  DataView ←→ memory.buffer   │◀──────▶│  memory: 16 страниц (1 МиБ)   │
│  env.print(ptr) ◀────────────┼────────┤  print(...) → env.print(ptr)  │
└──────────────────────────────┘        └───────────────────────────────┘
```

Ключевые свойства модели:

- **Модуль синхронный.** В нём нет event loop, таймеров, `fetch` и DOM.
  `main()` выполняется до конца и возвращает значение; всё, что должно
  произойти после, делает хост.
- **Один экземпляр — одна линейная память.** Память сохраняется между вызовами
  `main()`, поэтому её можно использовать как состояние (глобальных переменных
  в языке нет).
- **Нет start-секции.** Пока JS не вызовет `exports.main()`, ничего не
  произойдёт.
- **Нет GC и `free`.** Аллокатор bump-овый: память только растёт. Долгоживущая
  страница должна либо переиспользовать буферы, либо пересоздавать экземпляр.
- **Граница JS↔WASM дешёвая**, но каждое значение — это `i32`/`f64`;
  «объекты» передаются указателями на линейную память.

## 2. ABI: что импортирует и экспортирует модуль

### 2.1. Импорт: только `env.print`

```text
(import "env" "print" (func (param i32)))
```

- Импорт **всегда** присутствует, даже если `print` в программе не вызывается.
  Если не передать его в `instantiate`, будет ошибка
  `Import #0 "env": module is not an object or function`.
- `print` получает указатель на строку `[len u32 LE][utf8]`; больше никаких
  импортов у модуля нет — ни `memory`, ни `abort`, ни `now`.
- Каждый аргумент `print(...)` вызывает `env.print` отдельно.

### 2.2. Экспорты: `memory` и, как правило, `main`

| Имя | Вид | Когда есть |
|---|---|---|
| `memory` | память | всегда |
| `main` | функция | если в программе объявлена `fn main` |

Ни `alloc`, ни `free`, ни рантайм-хелперы, ни пользовательские функции не
экспортируются. Модуль без `main` валиден, но экспортирует только память.

### 2.3. Сигнатура `main`

| Объявление | Экспорт | JS получает |
|---|---|---|
| `fn main() -> int` | `() -> i32` | `number` |
| `fn main() -> float` | `() -> f64` | `number` |
| `fn main()` без `return` | `() -> void` | `undefined` |
| `fn main()` с `return expr` без аннотации | `() -> i32` | `number` |
| `fn main() -> string` | `() -> i32` | указатель на строку |
| `fn main() -> [int]` | `() -> i32` | указатель на массив |

Возвращать указатель на строку или массив можно, если не указывать `int`:
`-> string` и `-> [int]` компилируются в `i32`-результат. Это основной способ
отдать хосту структурированный результат.

:::caution Параметры `main` — работающая, но неформальная возможность
Канонический ABI — `main()` **без аргументов**. Но если объявить параметры,
экспорт сохраняет их сигнатуру, и JS может передать значения:

```latent
fn main(n: int) -> int {
    return n * 2;
}
```

```js
instance.exports.main(21); // 42
```

Строки и массивы передаются как `i32`-указатели на `[len][...]` (см. §3).
Это проверено на текущем компиляторе и удобно, когда хост и модуль пишутся
вместе. Минус: чужой хост, который вызывает `main()` без аргументов, передаст
нули — программа получит указатель `0` и увидит пустую строку/массив нулевой
длины (или нули, если читает через `load32`). Поэтому в модулях «общего
назначения» используйте `main()` без параметров и фиксированную область
памяти, а параметры — в своих страницах и воркерах, где контракт известен
обеим сторонам.
:::

### 2.4. Повторные вызовы `main`

`main()` можно вызывать много раз: локальные переменные создаются заново,
куча и память сохраняются. Язык не даёт глобальных переменных, поэтому
состояние между вызовами хранят в линейной памяти:

```latent
fn main(pass: int) -> int {
    let state = load32(20);
    if (state == 0) {
        state = alloc(64);
        store32(20, state);
    }
    store32(state, load32(state) + 1);
    return load32(state);
}
```

Это же свойство означает, что каждый вызов, который что-то аллоцирует,
**увеличивает** кучу: память не переиспользуется.

## 3. Данные через линейную память

Все многобайтовые значения — little-endian. `i32.load`/`i32.store` в кодогене
используют выравнивание 4, `f64` — 8.

### 3.1. Числа

| Тип Latent | WASM | В памяти | Замечание |
|---|---|---|---|
| `int` | `i32` | 4 байта | знаковый, 32 бита; переполнение заворачивается |
| `bool` | `i32` | 4 байта | `0`/`1` |
| `null` | `i32` | 4 байта | `0` |
| `float` | `f64` | 8 байт | только скаляр; в массивах/полях представим плохо |
| `string` | `i32` | указатель | см. §3.2 |
| `[T]` | `i32` | указатель | элементы по 4 байта |
| класс/enum/замыкание | `i32` | указатель | layout — в [WASM ABI](../reference/wasm-abi.md) |

`i64` в языке нет. Массивы `[float]` движок №2 не представляет: элементы
всегда пишутся 4-байтовым `i32.store`, поэтому `[1.5, 2.5]` даёт невалидный
WASM. Для вещественных векторов используйте фиксированную точку (масштабируйте
числа до `int`), считайте в JS или ждите полноценной поддержки `f64`-массивов.

### 3.2. Строки: `[len u32 LE][utf8]`

```text
адрес → +0: длина в байтах (u32 LE)
        +4: байты UTF-8
```

- Указатель строки — на длину, а не на первый байт.
- `len(s)` и `s.length` возвращают длину в **байтах UTF-8**, а не в символах.
  `"привет".length` = 12, `"Latent".length` = 6.
- `s[i]` возвращает **байт** (`0..255`), а не символ: `"abc"[0]` = 97.
- `+` конкатенирует строки, `==` сравнивает содержимое; `<`/`>` сравнивают
  указатели (не используйте их для строк).
- Строки неизменяемы, конкатенация каждый раз аллоцирует новую строку.

JS-помощники:

```js
function readString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

function writeString(memory, ptr, text) {
  const bytes = new TextEncoder().encode(text); // длина в байтах UTF-8
  ensureCapacity(memory, ptr + 4 + bytes.length);
  new DataView(memory.buffer).setUint32(ptr, bytes.length, true);
  new Uint8Array(memory.buffer).set(bytes, ptr + 4);
  return ptr;
}
```

`TextEncoder`/`TextDecoder` работают с UTF-8 — это ровно формат Latent. Не
используйте `text.length` для длины: в JS это UTF-16 code units.

Собрать строку из сырых байтов в самом Latent нельзя: нет builtin «строка из
буфера». Поэтому входную строку либо передают указателем (JS пишет
`[len][utf8]`), либо она является литералом в исходнике; байты можно читать
через индексацию и `load8`.

### 3.3. Массивы: `[len u32][i32...]`

```text
адрес → +0: длина (u32 LE)
        +4: элемент 0 (i32)
        +8: элемент 1 (i32)
        ...
```

- Элемент всегда 4 байта; `float`-массивов нет.
- `arr[i]` = `i32.load(arr + 4 + i*4)`; `a[i] = v` пишет на месте.
- Границы не проверяются: выход за пределы — порча памяти или trap.
- Массивы передаются по указателю и мутируются на месте.
- `push` **не резервирует** ёмкость: он пишет за текущей длиной, даже если блок
  выделен меньше. Это безопасно, только пока между `push` и чтением нет других
  аллокаций (строки, новые массивы, `new`). Подробно —
  [Bump-аллокатор и `push`](./arrays-and-strings.md#массивы).

JS-помощники:

```js
function readI32Array(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return Array.from({length: len}, (_, i) => view.getInt32(ptr + 4 + i * 4, true));
}

function writeI32Array(memory, ptr, values) {
  ensureCapacity(memory, ptr + 4 + values.length * 4);
  const view = new DataView(memory.buffer);
  view.setUint32(ptr, values.length, true);
  for (let i = 0; i < values.length; i += 1) {
    view.setInt32(ptr + 4 + i * 4, values[i], true);
  }
  return ptr;
}
```

### 3.4. Куда писать входные данные

Компилятор размещает строковые литералы в data-секции начиная с адреса 1024,
а куча начинается после них. Область `0..1023` в текущей реализации не
используется, и её удобно занять «почтовым ящиком» хост↔модуль: например,
адрес `16` для заголовка и `20` — для массива. Это **соглашение, а не часть
ABI**: не полагайтесь на него, если компилятор изменит раскладку, и не пишите
в область от 1024 вверх, не зная, что там литералы и куча.

```js
function ensureCapacity(memory, endByte) {
  const needPages = Math.ceil(endByte / 65536);
  const havePages = memory.buffer.byteLength / 65536;
  if (needPages > havePages) memory.grow(needPages - havePages);
}
```

Три способа передать вход:

| Способ | Как | Когда |
|---|---|---|
| Константа в исходнике | `let expr = "2 + 3";` и компиляция под каждый вход | редкие входы, демо, тесты |
| Параметр `main` | `fn main(data: [int])`, JS пишет `[len][i32...]` и вызывает `main(ptr)` | свой хост/воркер, контракт известен |
| Фиксированная область | `main()` без аргументов читает `load32(16)`/`load8(20+i)` | строгий ABI, чужие хосты, минимум связанности |

Третий способ работает и без параметров `main`, но требует, чтобы программа
знала адрес «почтового ящика». Второй короче и типобезопаснее внутри Latent, но
опирается на неформальную передачу параметров (см. §2.3).

### 3.5. Как прочитать результат

- `i32`/`f64` — обычное число JS (`typeof result === 'number'`).
- `void` — `undefined`.
- Строка/массив — `i32`-указатель: читайте `[len]` и данные, как в §3.2–3.3.
- Тип результата не виден в рантайме: `WebAssembly` не хранит его в экспорте
  для JS. Контракт (что именно вернул `main`) фиксируйте в коде страницы.

```js
const result = instance.exports.main();
if (typeof result === 'number') {
  // i32 или f64 — зависит от объявления main
}
```

## 4. Как вызывать `main` и что ловить

```js
let instance;
const imports = {
  env: {
    print(ptr) {
      console.log(readString(instance.exports.memory, ptr));
    },
  },
};

const bytes = await (await fetch('/core.wasm')).arrayBuffer();
({instance} = await WebAssembly.instantiate(bytes, imports));

if (typeof instance.exports.main !== 'function') {
  throw new Error('в модуле нет экспортированной main()');
}

try {
  const result = instance.exports.main();
  console.log('main() =', result);
} catch (error) {
  // WebAssembly.RuntimeError: trap (unreachable из assert, деление на 0,
  // выход за память) — программа не «вернула ошибку», а прервалась.
  console.error('Latent trap:', error);
}
```

- `assert(false)` и деление на ноль дают **trap**, а не код ошибки. Если нужна
  мягкая обработка, возвращайте `-1`/`enum Result` и проверяйте результат.
- Ошибки компиляции (`latentc`) и ошибки инстанцирования (`Import ...`) — это
  разные стадии; первая приходит текстом от компилятора, вторая — исключением
  JS.
- `main` синхронна: таймаутов и прерываний нет. Для недоверенного кода —
  только Web Worker с `terminate()` (см. §6.5).

## 5. Архитектурные паттерны

### 5.1. Чистое вычислительное ядро

Самый надёжный паттерн: Latent считает функцию от чисел, UI — на JS.

```latent
// Количество простых чисел <= n.
fn is_prime(n: int) -> bool {
    if (n < 2) {
        return false;
    }
    let d = 2;
    while (d * d <= n) {
        if (n % d == 0) {
            return false;
        }
        d = d + 1;
    }
    return true;
}

fn main(n: int) -> int {
    let count = 0;
    let i = 2;
    while (i <= n) {
        if (is_prime(i)) {
            count = count + 1;
        }
        i = i + 1;
    }
    return count;
}
```

```js
const result = instance.exports.main(1000); // 168
```

Плюсы: нет аллокаций, нет состояния, воспроизводимо, легко тестировать.
Минусы: всё общение — числа; строки и массивы требуют ABI из §3.

### 5.2. Данные и обработка

Массив живёт в памяти, модуль сортирует/фильтрует/агрегирует его на месте.

```latent
// Сумма элементов не меньше порога.
fn main(data: [int], threshold: int) -> int {
    let total = 0;
    for (let value in data) {
        if (value >= threshold) {
            total = total + value;
        }
    }
    return total;
}
```

```js
writeI32Array(memory, 16, [42, 7, 19, 3, 88, 21, 10, 55]);
const sum = instance.exports.main(16, 10); // 235
```

Для сортировки возвращайте тот же указатель (`fn main(data: [int]) -> [int]`)
или стройте новый массив. Помните: `push` не резервирует ёмкость, а память не
освобождается. Крупные данные обрабатывайте порциями или в воркере.

### 5.3. AI-фичи в браузере

Здесь важно не перепутать движки:

| | Движок №1 (JS-интерпретатор) | Движок №2 (Rust → WASM) |
|---|---|---|
| `ai_infer`, `ai_embed`, `ai_stream` | исполняет через host-гейтвей | ошибка «требует host-рантайма» |
| `tensor`, `semantic`, `matmul`, `cosine_similarity` | host-объекты JS | ошибка |
| «Run with AI» / self-repair | да | нет |
| Исполнение в браузере (в web IDE) | да (интерпретатор) | нет: только компиляция |

То есть AI-примитивы Latent в браузере — это **host-фичи движка №1**: они
реализованы в JS (`web-ide/compiler/ai-gateway.js`), требуют настроенного
провайдера (Ollama или OpenAI-совместимый endpoint), CORS на гейтвее и ключа
(если он нужен провайдеру; хранится в `localStorage`). Без «Run with AI» они
бросают `AI is not enabled. Use "Compile & Run with AI" button.`

```latent
// host-only: этот блок компилируется только движком №1.
fn main() -> int {
    let answer = ai_infer("gpt-4", "ping");
    print(answer);
    return 0;
}
```

В продакшн-фронтенде AI-вызов почти всегда делает JS/бекенд, а Latent получает
уже числа: вероятности, счётчики, фиксированную точку. Эмбеддинги — это
`float`-векторы, а `[float]` в движке №2 не представим, поэтому косинусное
сходство на Latent в WASM сейчас не сделать без ручной фиксированной точки.

### 5.4. Интерактивный playground как среда обучения

Playground — это тот же паттерн «компилятор + запуск», но с редактором и
выводом. Он полезен, чтобы:

- показать разницу движков №1 и №2 на одном исходнике;
- дать попробовать язык без установки;
- делиться ссылкой на код (base64 в URL);
- демонстрировать ошибки компилятора и WASM-байты.

Ограничения: движок №2 в playground только компилирует (не исполняет), а
host-фичи доступны лишь в движке №1. Подробно —
[Web IDE](../tooling/web-ide.md) и [движки](../specs/engines.md).

### 5.5. Компилятор в браузере (code-in-browser)

Сам компилятор Latent собран в WASM (`web-ide/compiler.wasm`, 651 473 байт) и
экспортирует C-ABI:

| Экспорт | Сигнатура | Назначение |
|---|---|---|
| `latent_alloc` | `(i32 size) -> i32` | выделить буфер под исходник |
| `latent_compile` | `(i32 src_ptr, i32 src_len) -> i32` | скомпилировать |
| `latent_free` | `(i32 ptr, i32 size)` | освободить буфер |
| `latent_version` | `() -> i32` | `[len][utf8]` с версией |

Ответ `latent_compile`: `[status u32][len u32][payload]`, где `status = 1` —
WASM-байты, `status = 0` — UTF-8 текст ошибки. Компилятор инстанцируется без
импортов: `WebAssembly.instantiate(bytes, {})`.

На этом ABI можно собрать собственный playground: текстовый редактор →
`latent_compile` → `WebAssembly.instantiate` результата → `main()` → вывод.
Готовый самодостаточный пример —
[«Свой playground»](../examples/frontend-compiler-playground.md); эталонный
загрузчик — `web-ide/compiler/wasm-loader.js` в репозитории.

## 6. Интеграция

### 6.1. Vanilla JS

Минимальный рецепт — в
[«Latent в браузере за 5 минут»](../getting-started/web-browser.md): `fetch` →
`arrayBuffer` → `instantiate` → `main()`. Загружайте модуль один раз и
переиспользуйте экземпляр, если состояние не мешает.

### 6.2. React: `useEffect` + `ref`

Компонент ниже грузит `sum.wasm`, вызывает `main(n)` при изменении `n` и
показывает строку, которую вернуло ядро.

```latent
fn main(n: int) -> string {
    let total = 0;
    let i = 1;
    while (i <= n) {
        total = total + i;
        i = i + 1;
    }
    return "sum 1.." + str(n) + " = " + str(total);
}
```

```tsx
// src/SumPanel.tsx
import {useEffect, useRef, useState} from 'react';
import wasmUrl from './sum.wasm?url'; // Vite: URL ассета

let modulePromise: Promise<WebAssembly.Module> | null = null;

function loadModule() {
  modulePromise ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`wasm: HTTP ${response.status}`);
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  return modulePromise;
}

function readString(memory: WebAssembly.Memory, ptr: number) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

export function SumPanel({initial = 100}: {initial?: number}) {
  const [n, setN] = useState(initial);
  const [text, setText] = useState('…');
  const [error, setError] = useState<string | null>(null);
  const instanceRef = useRef<WebAssembly.Instance | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!instanceRef.current) {
          const module = await loadModule();
          let inst: WebAssembly.Instance | null = null;
          const imports = {
            env: {
              print(ptr: number) {
                if (inst) {
                  console.log('[latent]', readString(inst.exports.memory as WebAssembly.Memory, ptr));
                }
              },
            },
          };
          inst = await WebAssembly.instantiate(module, imports);
          instanceRef.current = inst;
        }

        if (cancelled) return;
        const instance = instanceRef.current!;
        const main = instance.exports.main as (value: number) => number;
        const ptr = main(n);
        setText(readString(instance.exports.memory as WebAssembly.Memory, ptr));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [n]);

  return (
    <div>
      <input
        type="range" min={1} max={1000} value={n}
        onChange={(event) => setN(Number(event.target.value))}
      />
      <output>{text}</output>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

Что важно в этом коде:

- **Модуль кэшируется на уровне модуля.** `modulePromise` живёт дольше
  компонента; повторный mount не скачивает `.wasm` заново.
- **Экземпляр — в `ref`.** `useState` для инстанса вызвал бы лишние
  перерисовки, а сам эффект в Strict Mode выполняется дважды — кэш модуля это
  переживает.
- **`cancelled`** защищает от `setState` после размонтирования.
- **`main` вызывается в эффекте**, а не в рендере: WASM-вызов — побочный
  эффект и может быть дорогим.
- **`memory.buffer` читается заново** при каждом чтении: после `memory.grow`
  старый `ArrayBuffer` отсоединяется.

Если проект на Next.js/Nuxt и рендерит на сервере, этот компонент должен
монтироваться только на клиенте (`useEffect`/`onMounted` уже дают это), а
`WebAssembly` в SSR-сборке не вызывайте.

### 6.3. Vue и Svelte

Vue 3 (`<script setup>`):

```vue
<script setup>
import {onMounted, ref} from 'vue';
import wasmUrl from './sum.wasm?url';

const text = ref('');
let instance;

onMounted(async () => {
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  ({instance} = await WebAssembly.instantiate(bytes, {env: {print() {}}}));
  const ptr = instance.exports.main(100);
  const view = new DataView(instance.exports.memory.buffer);
  const len = view.getUint32(ptr, true);
  text.value = new TextDecoder().decode(
    new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
  );
});
</script>

<template><output>{{ text }}</output></template>
```

Svelte:

```svelte
<script>
  import {onMount} from 'svelte';
  let text = '';

  onMount(async () => {
    const bytes = await (await fetch('/sum.wasm')).arrayBuffer();
    const {instance} = await WebAssembly.instantiate(bytes, {env: {print() {}}});
    const ptr = instance.exports.main(100);
    const view = new DataView(instance.exports.memory.buffer);
    const len = view.getUint32(ptr, true);
    text = new TextDecoder().decode(
      new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
    );
  });
</script>

<output>{text}</output>
```

В обоих случаях логика та же, что в React: модуль загружается один раз на
жизнь приложения, экземпляр создаётся при монтировании, `main` вызывается в
хуке жизненного цикла.

### 6.4. Vite и Webpack: куда положить `.wasm`

**Vite, вариант `public/`** — файл не хешируется, URL стабилен:

```text
public/core.wasm
```

```js
const url = `${import.meta.env.BASE_URL}core.wasm`;
const bytes = await (await fetch(url)).arrayBuffer();
```

**Vite, вариант `?url`** — ассет проходит через сборку и получает хеш:

```js
import wasmUrl from './core.wasm?url';
```

Для TypeScript добавьте `/// <reference types="vite/client" />` (обычно уже есть
в `src/vite-env.d.ts`).

**Webpack 5** — правило `asset/resource`:

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [{test: /\.wasm$/, type: 'asset/resource'}],
  },
};
```

```js
import wasmUrl from './core.wasm';
const bytes = await (await fetch(wasmUrl)).arrayBuffer();
```

Не импортируйте `.wasm` как ES-модуль: модуль Latent — не ESM-модуль, а
бинарник для `WebAssembly.instantiate`.

Про MIME: у `WebAssembly.instantiateStreaming` строгие требования к
`Content-Type: application/wasm`, а dev-серверы часто отдают
`application/octet-stream`. Надёжнее скачать `arrayBuffer` и вызвать
`WebAssembly.instantiate(bytes, imports)` — так делает и загрузчик web IDE.

### 6.5. Web Worker

Синхронный `main` блокирует поток. Для тяжёлых вычислений или недоверенного
кода вынесите модуль в воркер:

```js
// core.worker.js
let instance;

self.onmessage = async (event) => {
  const {type, payload} = event.data;

  if (type === 'init') {
    const bytes = await (await fetch(payload.url)).arrayBuffer();
    const imports = {
      env: {
        print(ptr) {
          const view = new DataView(instance.exports.memory.buffer);
          const len = view.getUint32(ptr, true);
          const line = new TextDecoder().decode(
            new Uint8Array(instance.exports.memory.buffer, ptr + 4, len),
          );
          self.postMessage({type: 'print', line});
        },
      },
    };
    instance = await WebAssembly.instantiate(bytes, imports);
    self.postMessage({type: 'ready'});
  }

  if (type === 'run') {
    try {
      const result = instance.exports.main(payload);
      self.postMessage({type: 'result', result});
    } catch (error) {
      self.postMessage({type: 'error', message: String(error)});
    }
  }
};
```

```js
const worker = new Worker(new URL('./core.worker.js', import.meta.url), {type: 'module'});
worker.postMessage({type: 'init', payload: {url: '/core.wasm'}});

// страховка от бесконечного цикла: WASM нельзя прервать изнутри
const timer = setTimeout(() => worker.terminate(), 2000);
worker.onmessage = ({data}) => {
  if (data.type === 'result') {
    clearTimeout(timer);
    console.log('result:', data.result);
  }
};
worker.postMessage({type: 'run', payload: 1000});
```

Память у воркера своя: `SharedArrayBuffer` и разделяемая память не нужны и не
поддерживаются модулем. Результаты копируются через `postMessage`; большие
массивы лучше отдавать как `ArrayBuffer` с переносом (transferable), а не как
JS-массив.

### 6.6. Кэширование

Три уровня, которые стоит различать:

1. **HTTP-кэш** — для хешированных имён (`core.abc123.wasm`) ставьте
   `Cache-Control: public, max-age=31536000, immutable`.
2. **Cache API** — если имя файла стабильное, кэшируйте ответ вручную и меняйте
   имя кэша при обновлении (нужен secure context: HTTPS или `localhost`):

```js
async function loadWasmBytes(url, cacheName = 'latent-wasm-v1') {
  if ('caches' in window) {
    const cache = await caches.open(cacheName);
    let response = await cache.match(url);
    if (!response) {
      response = await fetch(url);
      if (response.ok) await cache.put(url, response.clone());
    }
    if (response) return response.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`wasm: HTTP ${response.status}`);
  return response.arrayBuffer();
}
```

3. **Скомпилированный `WebAssembly.Module`** — в памяти страницы:

```js
const modulePromise = WebAssembly.compile(await loadWasmBytes('/core.wasm'));
// дальше: WebAssembly.instantiate(await modulePromise, imports)
```

Компиляция дороже инстанцирования: если нужно много экземпляров, компилируйте
один модуль и инстанцируйте его повторно. Именно так поступает `wasm-loader.js`
в web IDE (там ещё и Cache API с именем `latent-compiler-v1`).

### 6.7. Производительность и память

| Что | Стоимость | Как не платить дважды |
|---|---|---|
| `fetch` + `compile` | десятки миллисекунд и больше | кэш модуля, HTTP-кэш |
| `instantiate` | ~1 МиБ памяти на экземпляр | переиспользуйте экземпляр |
| переход JS→WASM | дешёвый | не дробите одну операцию на тысячи вызовов |
| `main` с аллокациями | куча растёт, `free` нет | пересоздавайте экземпляр или кэшируйте буферы |
| `memory.grow` | отсоединяет старый `buffer` | всегда берите `memory.buffer` заново |
| `print` | аллокация строки + вызов JS на каждый аргумент | не печатайте в горячем цикле |
| конкатенация строк в цикле | O(n²) по памяти | стройте один массив/буфер |
| `push` в `[]` | не резервирует ёмкость | литерал нужного размера или `alloc` |

Правила, которые окупятся:

- Считайте в `int` (i32), если задача допускает; `float` в движке №2 хрупок.
- Держите данные в одном буфере и возвращайте указатель, а не копируйте туда-
  сюда.
- Для анимации кэшируйте буфер кадра в памяти (адрес-«почтовый ящик») и
  перезаписывайте его, а не аллоцируйте каждый кадр.
- Не вызывайте `main` чаще, чем нужно (например, из `requestAnimationFrame`
  только при реальном изменении состояния).
- Проверяйте `WebAssembly.validate(bytes)` на этапе сборки/тестов.

### 6.8. Ленивая загрузка и чанки

WASM-модуль — это **ассет**, а не точка входа. Если положить его в стартовый
бандл, пользователь скачает сотни килобайт до первого вычисления. Рабочая
схема — `dynamic import()` вокруг загрузчика и отдельный файл `.wasm`:

```js
// engine.js — ленивый загрузчик, кэширующий промис
let enginePromise = null;

export function loadEngine() {
  enginePromise ??= (async () => {
    // Vite/Rollup/webpack перепишут new URL в URL ассета с хешем.
    const wasmUrl = new URL('./core.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`wasm: HTTP ${response.status}`);
    const { instance } = await WebAssembly.instantiate(
      await response.arrayBuffer(), {env: {print() {}}});
    return instance;
  })();
  return enginePromise;
}
```

```js
// UI: модуль грузится только по действию пользователя
button.addEventListener('click', async () => {
  const { loadEngine } = await import('./engine.js');
  const instance = await loadEngine();
  console.log(instance.exports.main(100));
});
```

Как отдать `.wasm` в разных сборщиках:

| Сборщик | Приём | Комментарий |
|---|---|---|
| Vite | `import wasmUrl from './core.wasm?url'` | ассет с хешем; в dev — прямая ссылка |
| Vite / Rollup | `new URL('./core.wasm', import.meta.url)` | работает и без плагинов, и в dev |
| Rollup | `@rollup/plugin-url` или `public/core.wasm` + `BASE_URL` | без плагина — только копирование |
| Webpack 5 | `{test: /\.wasm$/, type: 'asset/resource'}` | импорт даёт URL, не ESM-модуль |

Не импортируйте `.wasm` как ES-модуль: Latent-модуль — бинарник для
`WebAssembly.instantiate`. Для `instantiateStreaming` нужен корректный
`Content-Type: application/wasm`; dev-серверы часто отдают
`application/octet-stream`, поэтому надёжнее `arrayBuffer()`.

**Как делить свой рантайм.** Ориентир — по моменту, когда код нужен:

| Чанк | Что | Когда грузится |
|---|---|---|
| entry | UI, роутинг, состояние | старт |
| core | парсер/валидаторы, нужные первому экрану | старт |
| engine | `.wasm` + загрузчик/ABI-обёртки | первое вычисление |
| examples/fixtures | демо-код, большие таблицы | клик/роут |

```js
// vite.config.js: тот же приём, что в web-ide/vite.config.js
export default {
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/engine/')) return 'engine';
          if (id.includes('/examples/')) return 'examples';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
};
```

`manualChunks` группирует модули, а `import()` задаёт **когда** чанк грузится:
без динамического импорта группа всё равно попадёт в стартовый граф, если её
кто-то импортирует статически. Проверяйте по entry-файлу: имени ленивого чанка
там быть не должно (только `import("./engine-…")`).

**Метрики.** Источники: вывод `vite build` (raw + gzip), `ls -lh dist/assets`
или `du -sh`, DevTools → Network при cold load. Практичные бюджеты для
небольшого ядра: entry < 50 kB gzip, `.wasm` < 200 kB gzip (у Latent-модуля —
единицы КБ, у компилятора — ~135 kB gzip), ленивые чанки не ограничены, но
каждый должен окупаться. Эталонные цифры и конфиг — в
[Web IDE](../tooling/web-ide.md).

## 7. Сравнение с альтернативами

| Критерий | JS/TS | Rust → WASM (`wasm-bindgen`) | AssemblyScript | Latent (движок №2) |
|---|---|---|---|---|
| Доступ к DOM | нативно | через `web-sys`/биндинги | через биндинги | **нет** |
| Экспорт функций | любой | любой, с типами | любой | только `main` |
| Импорт host-функций | любой | любой | любой | только `env.print` |
| Размер модуля | — | десятки–сотни КБ | небольшой + рантайм | ~1–3 КБ |
| Сборка мусора | есть | нет (свои правила) | есть | **нет** |
| Формат строк | UTF-16 | UTF-8 + биндинги | UTF-16 | UTF-8 вручную |
| Массивы `f64` | `Float64Array` | да | да | **нет** |
| Инструменты | всё | зрелые | средние | CLI, web IDE, плагины |
| Экосистема | огромная | большая | средняя | почти нет |
| Когда выбирать | весь UI и логика | тяжёлые ядра, ML | TS-подобный WASM | крошечное ядро без зависимостей |

Честно о месте Latent:

- **Против JS/TS** Latent не даёт скорости «из коробки»: JIT хорошо
  оптимизирует циклы, а переход в WASM добавляет копирование данных. Выигрыш —
  в предсказуемости, отсутствии GC-пауз, изоляции и маленьком модуле.
- **Против Rust→WASM** Latent проще и легче (модуль ~1 КБ против десятков КБ,
  нет `wasm-bindgen` и JS-глю), но у Rust есть произвольные экспорты, DOM через
  `web-sys`, экосистема и зрелый тулинг. Для сложного фронтенда Rust практичнее.
- **Против AssemblyScript** у Latent нет GC-рантайма и почти нет стандартной
  библиотеки; AssemblyScript ближе к TS и умеет больше, но тащит рантайм.
  Latent интересен там, где нужен минимальный детерминированный модуль.

## 8. Ограничения и что нужно для «настоящего» фронтенда

### 8.1. Что есть сейчас

- Компиляция `.lat` → валидный WASM, экспорт `main` + `memory`, импорт
  `env.print`.
- Строки `[len][utf8]`, массивы `[len][i32]`, классы/enum/замыкания — по
  указателям; layout описан в [WASM ABI](../reference/wasm-abi.md).
- Передача параметров в `main` (i32/f64/указатели) — работает, но не
  зафиксирована как ABI.
- `alloc`/`load8`/`store8`/`load32`/`store32`/`memcopy` — для ручной работы с
  памятью.
- Компилятор-в-WASM с C-ABI `latent_alloc`/`latent_compile`/`latent_free`.
- Запуск в Node.js, web IDE, VS Code, IntelliJ IDEA.

### 8.2. Чего нет

| Ограничение | Следствие для фронтенда |
|---|---|
| Нет экспорта функций кроме `main` | нельзя сделать `exports.parse()`/`exports.sort()`; один вход на модуль |
| Нет импортов кроме `print` | нет DOM, `fetch`, `console`, времени, случайных чисел |
| Нет `i64` и `f64`-массивов | эмбеддинги/векторы и точная арифметика — только в JS или fixed-point |
| Нет `free`/GC/арены | долгая жизнь страницы = рост памяти; нужен сброс экземпляра |
| Нет пакетов/менеджера зависимостей | модули (`import`/`export`) есть, но внешних пакетов и npm нет |
| Нет исключений | ошибки — коды возврата или trap |
| Нет source maps/name-секции | отладка по указателям и `console.log` |
| Нет таймаутов/fuel | бесконечный цикл вешает поток; только Worker + `terminate` |
| Нет npm-пакета, TS-типов, плагинов сборки | интеграция — вручную, как в §6 |
| `float` хрупок | невалидный WASM на смешанных выражениях; проверяйте `validate` |

### 8.3. Что нужно, чтобы Latent стал «настоящим» фронтенд-инструментом

Список направлений, а не обещаний:

1. **Экспорт произвольных функций** (`export fn parse(...)`) с параметрами и
   несколькими результатами — чтобы модуль давал API, а не один `main`.
2. **Стабильный ABI данных**: экспортируемые `alloc`/`reset`, версионированный
   заголовок строк/массивов, документированные соглашения вызова.
3. **Импорт host-функций** помимо `print`: логирование, время, случайные числа,
   возможно — чтение ресурсов; с явным списком и версией.
4. **Полноценные `f64`-массивы и `i64`** — без них ML/векторные сценарии
   остаются в JS.
5. **Пакеты и многофайловая сборка** — файловые модули уже есть
   ([guide/modules](./modules.md)), дальше — пакеты/реестр и распределение
   зависимостей.
6. **Тулинг**: npm-пакет, TypeScript-типы, плагины Vite/Webpack, `wasm-opt`,
   name-секция, source maps, трассировки trap'ов.
7. **Управление памятью для SPA**: арена/сброс, чтобы страница могла жить
   часами без роста памяти.
8. **Безопасность/изоляция**: стандартный helper для запуска в Worker с
   таймаутом и лимитом памяти.
9. **Ошибки без trap'ов**: `Result`-ориентированный ABI для границы с JS.
10. **Рецепты и тесты ABI** — как в этом разделе: примеры, которые проверяются
    компилятором и реальным запуском.

До появления этих пунктов Latent во фронтенде — это **маленькое ядро для
чистых вычислений** с ручной передачей данных. В этой роли он уже работает.

## 9. Связанные разделы

- [Latent в браузере за 5 минут](../getting-started/web-browser.md) — первый
  рабочий HTML.
- [WASM ABI](../reference/wasm-abi.md) — точный контракт модуля и
  компилятора.
- [WASM и исполнение](./wasm-and-execution.md) — Node.js, импорт `env.print`,
  различия движков.
- [Память и низкий уровень](./memory-and-low-level.md) — bump-аллокатор и
  примитивы.
- [Web IDE](../tooling/web-ide.md) ·
  [движки](../specs/engines.md) ·
  [архитектура web IDE](../specs/webide-architecture.md).
- Примеры: [калькулятор](../examples/frontend-calculator.md),
  [данные](../examples/frontend-data-processing.md),
  [строки](../examples/frontend-strings.md),
  [React](../examples/frontend-react.md),
  [canvas](../examples/frontend-canvas.md),
  [свой playground](../examples/frontend-compiler-playground.md).
