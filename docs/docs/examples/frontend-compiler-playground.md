---
title: "Свой playground: компилятор Latent как WASM"
sidebar_label: "Компилятор в браузере"
sidebar_position: 15
description: "Как встроить компилятор Latent (latent_alloc/latent_compile/latent_free) в свою страницу: редактор, компиляция, запуск результата, скачивание .wasm и защита Worker'ом."
---

# Свой playground: компилятор Latent как WASM

Компилятор Latent сам собран в WebAssembly: `web-ide/compiler.wasm`
(651 473 байт) экспортирует C-ABI `latent_alloc` / `latent_compile` /
`latent_free` / `latent_version` и не требует импортов. На нём можно собрать
собственный playground: текстовое поле → компиляция в браузере → запуск
результата → скачивание `.wasm`.

Этот кейс — минимальная, но рабочая версия такой страницы. За эталонной
реализацией загрузчика и кэширования смотрите
`web-ide/compiler/wasm-loader.js` в репозитории.

## ABI компилятора

| Экспорт | Сигнатура | Назначение |
|---|---|---|
| `latent_alloc` | `(i32 size) -> i32` | выделить буфер под исходник |
| `latent_compile` | `(i32 src_ptr, i32 src_len) -> i32` | скомпилировать |
| `latent_free` | `(i32 ptr, i32 size)` | освободить буфер |
| `latent_version` | `() -> i32` | `[len][utf8]` с версией |

Формат ответа `latent_compile`:

```text
[status u32 LE][len u32 LE][payload: len байт]
status = 1 → payload это .wasm-байты
status = 0 → payload это UTF-8 сообщение об ошибке компилятора
```

Компилятор инстанцируется без импортов: `WebAssembly.instantiate(bytes, {})`.
Ошибки компиляции — обычный `status = 0` с русским текстом, а не исключение
WASM.

## Пример программы для редактора

```latent
fn main() -> int {
    let total = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        total = total + i;
    }
    print("sum 1..10 =", total);
    return total;
}
```

## Полная страница

Положите рядом `compiler.wasm` и откройте страницу через HTTP-сервер (не
`file://`).

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Latent playground</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; max-width: 900px; }
    textarea { width: 100%; height: 220px; font: 13px/1.5 ui-monospace, monospace; }
    .row { display: flex; gap: .5rem; margin: .75rem 0; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 8px; min-height: 4rem; }
    button:disabled { opacity: .5; }
  </style>
</head>
<body>
  <h1>Latent playground</h1>

  <textarea id="src" spellcheck="false">fn main() -> int {
    let total = 0;
    for (let i = 1; i <= 10; i = i + 1) {
        total = total + i;
    }
    print("sum 1..10 =", total);
    return total;
}</textarea>

  <div class="row">
    <button id="run">Скомпилировать и запустить</button>
    <button id="download" disabled>Скачать .wasm</button>
  </div>

  <pre id="out"></pre>

  <script type="module">
    const COMPILER_URL = './compiler.wasm';

    const srcEl = document.getElementById('src');
    const outEl = document.getElementById('out');
    const runBtn = document.getElementById('run');
    const downloadBtn = document.getElementById('download');

    let compilerPromise = null;
    let lastWasm = null;

    const log = (line) => { outEl.textContent += line + '\n'; };

    function loadCompiler() {
      compilerPromise ??= (async () => {
        const response = await fetch(COMPILER_URL);
        if (!response.ok) {
          throw new Error(`compiler.wasm: HTTP ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        const {instance} = await WebAssembly.instantiate(bytes, {});
        return instance.exports;
      })();
      return compilerPromise;
    }

    function compile(compiler, source) {
      const encoded = new TextEncoder().encode(source);
      const srcPtr = compiler.latent_alloc(Math.max(encoded.length, 1));
      new Uint8Array(compiler.memory.buffer).set(encoded, srcPtr);

      const resPtr = compiler.latent_compile(srcPtr, encoded.length);
      const view = new DataView(compiler.memory.buffer);
      const status = view.getUint32(resPtr, true);
      const len = view.getUint32(resPtr + 4, true);
      const payload = new Uint8Array(
        compiler.memory.buffer, resPtr + 8, len,
      ).slice();

      compiler.latent_free(srcPtr, Math.max(encoded.length, 1));
      compiler.latent_free(resPtr, 8 + len);

      if (status !== 1) {
        throw new Error(new TextDecoder().decode(payload));
      }
      return payload;
    }

    async function run(source) {
      const compiler = await loadCompiler();
      const wasm = compile(compiler, source);
      lastWasm = wasm;
      downloadBtn.disabled = false;

      let instance;
      const imports = {
        env: {
          print(ptr) {
            const memory = instance.exports.memory;
            const view = new DataView(memory.buffer);
            const len = view.getUint32(ptr, true);
            log(new TextDecoder().decode(
              new Uint8Array(memory.buffer, ptr + 4, len),
            ));
          },
        },
      };

      ({instance} = await WebAssembly.instantiate(wasm, imports));

      if (typeof instance.exports.main !== 'function') {
        log('В модуле нет экспортированной main().');
        return;
      }
      const result = instance.exports.main();
      log(`main() = ${result}`);
    }

    runBtn.addEventListener('click', async () => {
      outEl.textContent = '';
      lastWasm = null;
      downloadBtn.disabled = true;
      try {
        await run(srcEl.value);
      } catch (error) {
        log(`Ошибка: ${error.message}`);
      }
    });

    downloadBtn.addEventListener('click', () => {
      if (!lastWasm) return;
      const blob = new Blob([lastWasm], {type: 'application/wasm'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'program.wasm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  </script>
</body>
</html>
```

**Что вы увидите:** в `<pre>` появятся `sum 1..10 =` и `55` (две строки,
потому что `print` вызывает `env.print` на каждый аргумент), затем
`main() = 55`. Кнопка «Скачать .wasm» станет активной и сохранит
скомпилированный модуль — его можно открыть в
[«Latent в браузере»](../getting-started/web-browser.md).

## Кэширование компилятора

`compiler.wasm` — 465 КБ; скачивать его при каждом открытии страницы расточительно.
Загрузчик web IDE использует Cache API (`latent-compiler-v1`):

```js
async function loadCompilerBytes(url, cacheName = 'latent-compiler-v1') {
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}
```

Меняйте имя кэша при обновлении компилятора, иначе браузер продолжит отдавать
старую версию.

## Безопасность: Worker и таймаут

Скомпилированный модуль исполняется в песочнице WASM, но:

- **бесконечный цикл нельзя прервать** — `main()` синхронный, страница
  зависнет;
- **память не ограничена `max`** — программа может вырасти до лимита браузера;
- **trap** (например, `assert(false)`) убивает только вызов, но не страницу.

Для недоверенного кода компилируйте и запускайте в Web Worker, а снаружи
ставьте таймаут:

```js
const worker = new Worker(new URL('./compile-worker.js', import.meta.url), {
  type: 'module',
});
const timer = setTimeout(() => worker.terminate(), 3000);

worker.onmessage = ({data}) => {
  clearTimeout(timer);
  if (data.ok) {
    console.log('output:', data.output, 'result:', data.result);
  } else {
    console.error(data.error);
  }
};

worker.postMessage({source: 'fn main() -> int { return 1; }'});
```

```js
// compile-worker.js — компиляция и запуск в воркере.
self.onmessage = async ({data}) => {
  try {
    const compilerBytes = await (await fetch('./compiler.wasm')).arrayBuffer();
    const {instance: compiler} = await WebAssembly.instantiate(compilerBytes, {});
    // ... compile() из полного примера выше ...
    const wasm = compile(compiler, data.source);

    let instance;
    const output = [];
    const imports = {env: {print(ptr) {
      const memory = instance.exports.memory;
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      output.push(new TextDecoder().decode(
        new Uint8Array(memory.buffer, ptr + 4, len),
      ));
    }}};
    ({instance} = await WebAssembly.instantiate(wasm, imports));
    const result = instance.exports.main?.();
    self.postMessage({ok: true, output, result});
  } catch (error) {
    self.postMessage({ok: false, error: String(error)});
  }
};
```

`worker.terminate()` — единственный способ прервать `main`; после него
экземпляр (и компилятор) нужно создавать заново.

## Ограничения кейса

- **Компилятор — 465 КБ.** Для лёгкой страницы это заметно; кэшируйте или
  выносите в отдельный lazy-модуль.
- **Нет подсветки ошибок по строкам.** Компилятор возвращает текст
  (`Неожиданный символ ... на строке N:M`); парсить его для подсветки — ручная
  работа.
- **Нет `wasm-opt`, нет source maps.** Что скомпилировали, то и запускаем.
- **Компилятор и результат делят память компилятора.** Буферы исходника и
  ответа освобождаются `latent_free`; сам компилятор живёт в своей памяти и не
  пересекается с памятью скомпилированного модуля (это отдельный экземпляр).
- **`instantiateStreaming` не используйте.** Нужен `Content-Type:
  application/wasm`; надёжнее `arrayBuffer` + `instantiate`.
- **Долгий `main` подвешивает вкладку.** См. Worker выше.
- **Нет проверки, что модуль безопасен.** WASM изолирован от DOM, но не от
  CPU/памяти.

## Что попробовать

1. Добавьте подсветку строки из текста ошибки (`на строке (\d+):(\d+)`).
2. Сделайте список примеров (`<select>`) и подставляйте исходник в редактор.
3. Покажите hex-дамп WASM (как вкладка WASM в web IDE).
4. Сохраняйте исходник в `localStorage` и восстанавливайте при загрузке.
5. Сравните размер `compiler.wasm` и скомпилированной программы (~1 КБ).

## Связанные разделы

- [WASM ABI](../reference/wasm-abi.md#c-abi-компилятора-движок-2-в-браузере) —
  контракт компилятора.
- [Web IDE](../tooling/web-ide.md) — готовый playground.
- [Latent в браузере](../getting-started/web-browser.md) — запуск результата.
- [Движки](../specs/engines.md) — чем компилятор отличается от интерпретатора.
