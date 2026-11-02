---
title: "Latent в браузере за 5 минут"
sidebar_label: "Latent в браузере"
sidebar_position: 5
description: "Компиляция .lat в .wasm, загрузка модуля через fetch и WebAssembly.instantiate, импорт env.print, чтение main() и готовый HTML-файл."
---

# Latent в браузере за 5 минут

Скомпилированный модуль Latent — это обычный WebAssembly-модуль с одним
импортом (`env.print`) и двумя экспортами (`memory` и `main`). Его можно
загрузить на любую страницу: без бандлера, без `wasm-bindgen` и без отдельной
библиотеки-рантайма.

За пять минут мы пройдём путь: `.lat` → `.wasm` → `fetch` →
`WebAssembly.instantiate` → вызов `main()` → вывод в `pre`.

## Что понадобится

| Что | Зачем |
|---|---|
| Скомпилированный `hello.wasm` | результат работы `latentc compile` (шаг 1) |
| Любой HTTP-сервер | по `file://` браузер не отдаст `.wasm` через `fetch` |
| Современный браузер | `WebAssembly`, `TextDecoder`, ES-модули |

## Шаг 1. Скомпилируйте `.lat` в `.wasm`

Создайте `hello.lat`:

```latent
fn main() -> int {
    print("Hello from Latent!");
    print("2 + 2 =", 2 + 2);
    return 42;
}
```

Скомпилируйте его CLI-компилятором (сборка — в разделе
[CLI latentc](./cli.md)):

```bash
cargo build --bin latentc
./target/debug/latentc compile hello.lat hello.wasm
# hello.lat -> hello.wasm (NNN bytes)
```

На Windows:

```pwsh
cargo build --bin latentc
.\target\debug\latentc.exe compile hello.lat hello.wasm
```

Положите `hello.wasm` рядом с HTML-страницей.

:::note Web IDE не сохраняет `.wasm` файлом
В [playground](https://jegius.github.io/latent/playground/) кнопка **Engine #2**
и вкладка **WASM** компилируют программу и показывают hex-дамп байтов, но кнопки
«скачать `.wasm`» там нет. Для файла используйте `latentc`; если нужен именно
браузерный компилятор с сохранением результата, см.
[«Свой playground»](../examples/frontend-compiler-playground.md).
:::

## Шаг 2. Загрузите модуль в браузере

Сохраните рядом с `hello.wasm` файл `index.html`:

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Latent в браузере</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Latent в браузере</h1>
  <pre id="out"></pre>

  <script type="module">
    const out = document.getElementById('out');
    const log = (line) => { out.textContent += line + '\n'; };

    // Строка Latent в памяти: [len u32 LE][байты UTF-8]; указатель — на len.
    function readString(memory, ptr) {
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
      return new TextDecoder().decode(bytes);
    }

    let instance; // нужен внутри env.print
    const imports = {
      env: {
        print(ptr) {
          log(readString(instance.exports.memory, ptr));
        },
      },
    };

    try {
      const response = await fetch('./hello.wasm');
      if (!response.ok) {
        throw new Error(`не удалось загрузить hello.wasm: HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      ({instance} = await WebAssembly.instantiate(bytes, imports));

      const result = instance.exports.main();
      log(`main() = ${result}`);
    } catch (error) {
      log(`Ошибка: ${error.message}`);
    }
  </script>
</body>
</html>
```

Запустите статический сервер из каталога с файлами — например:

```bash
npx serve .
# или: python3 -m http.server 8000
```

и откройте страницу.

## Что вы увидите

```
Hello from Latent!
2 + 2 =
4
main() = 42
```

Обратите внимание: `print("2 + 2 =", 2 + 2)` в движке №2 вызывает `env.print`
**на каждый аргумент**, поэтому строка и число печатаются отдельными строками.
Так же ведёт себя модуль, запущенный в Node.js
([WASM и исполнение](../guide/wasm-and-execution.md)).

## Как это работает

- **Один импорт.** Модуль всегда импортирует `env.print(i32)` — даже если
  `print` в программе не вызывается. Если не передать этот импорт,
  `WebAssembly.instantiate` бросит `Import #0 "env": module is not an object or
  function`.
- **Два экспорта.** `memory` и `main` (последний — только если `fn main`
  объявлена). Ни `alloc`, ни `free`, ни рантайм-хелперы модуль не
  экспортирует, и start-секции в нём нет.
- **`print` получает указатель.** Аргумент — адрес строки `[len u32 LE][utf8]`
  в линейной памяти. Хост читает `len`, затем `len` байт UTF-8. Поэтому
  `readString` каждый раз берёт **актуальный** `memory.buffer`.
- **`main()` вызывается вручную.** В модуле нет start-секции: пока JS не
  вызовет `exports.main()`, программа не выполнится. Результат — `i32`
  (`number`), `f64` (`number`) или `undefined`, если `main` ничего не
  возвращает.

## Ограничения за пять минут

- Экспортируется только `main`; отдельных функций, классов и структур снаружи
  нет. Всё общение — через `main` и линейную память.
- Host-API DOM/`fetch`/`localStorage` из Latent недоступен: импорт ровно один.
- Входных аргументов у `main` в этом примере нет; как передать данные, см.
  [«Latent во фронтенде»](../guide/web-and-frontend.md).
- Начальная память — 16 страниц (1 МиБ), верхнего лимита нет; аллокатор
  bump-овый, без `free` и GC.
- `float` в движке №2 поддерживается частично и легко даёт невалидный WASM;
  проверяйте `WebAssembly.validate`.
- Модуль синхронный: долгий `main` блокирует поток — для тяжёлых вычислений
  используйте Web Worker.

## Куда дальше

- [Latent во фронтенде](../guide/web-and-frontend.md) — ABI, строки и массивы,
  React/Vue/Svelte, Worker, кэширование, паттерны и ограничения.
- [Примеры: калькулятор](../examples/frontend-calculator.md),
  [данные](../examples/frontend-data-processing.md),
  [строки](../examples/frontend-strings.md),
  [React](../examples/frontend-react.md),
  [canvas](../examples/frontend-canvas.md),
  [свой playground](../examples/frontend-compiler-playground.md).
- [WASM и исполнение](../guide/wasm-and-execution.md) — запуск в Node.js и
  различия движков.
- [WASM ABI](../reference/wasm-abi.md) — точный контракт модуля.

Открыть playground: [jegius.github.io/latent/playground](https://jegius.github.io/latent/playground/).
