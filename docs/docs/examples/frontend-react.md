---
title: "React-компонент с Latent-ядром"
sidebar_label: "React"
sidebar_position: 14
description: "Готовый React-компонент на TypeScript: загрузка .wasm через Vite, вызов main в useEffect, чтение строки из памяти, сборка и типичные ошибки."
---

# React-компонент с Latent-ядром

Кейс: React-приложение загружает `sum.wasm`, при движении ползунка вызывает
`main(n)` и показывает строку, которую вернуло Latent-ядро. Компонент написан
на TypeScript и собирается Vite; тот же код переносится в CRA/Next.js с
минимальными правками.

## Ядро

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

- `main(n: int)` принимает число — экспорт получает сигнатуру `(i32) -> i32`.
- `str(n)` превращает число в строку, `+` конкатенирует.
- Возвращается указатель на `[len][utf8]`; React читает его через `DataView`.

## Компонент

```tsx
// src/SumPanel.tsx
import {useEffect, useRef, useState} from 'react';
import wasmUrl from './sum.wasm?url'; // Vite: файл лежит в src/sum.wasm

// Модуль компилируется один раз на жизнь приложения.
let modulePromise: Promise<WebAssembly.Module> | null = null;

function loadModule(): Promise<WebAssembly.Module> {
  modulePromise ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`sum.wasm: HTTP ${response.status}`);
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  return modulePromise;
}

function readString(memory: WebAssembly.Memory, ptr: number): string {
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
                  console.log(
                    '[latent]',
                    readString(inst.exports.memory as WebAssembly.Memory, ptr),
                  );
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

    return () => {
      cancelled = true;
    };
  }, [n]);

  return (
    <section>
      <label>
        n = {n}
        <input
          type="range"
          min={1}
          max={1000}
          value={n}
          onChange={(event) => setN(Number(event.target.value))}
        />
      </label>
      <output>{text}</output>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

## Сборка Vite

```bash
npm create vite@latest latent-react -- --template react-ts
cd latent-react
npm install
```

Скомпилируйте ядро (из корня репозитория Latent) и положите `.wasm` в `src/` —
импорт идёт как `./sum.wasm?url`:

```bash
# в отдельном терминале, из корня репозитория latent
./target/debug/latentc compile sum.lat sum.wasm
cp sum.wasm latent-react/src/sum.wasm
```

Если проект уже создан и вы находитесь в его каталоге, путь будет
`cp ../sum.wasm src/sum.wasm`.

`src/main.tsx`:

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {SumPanel} from './SumPanel';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SumPanel initial={100} />
  </StrictMode>,
);
```

Если файл должен лежать в `public/`, импорт `?url` не нужен:

```ts
const response = await fetch(`${import.meta.env.BASE_URL}sum.wasm`);
```

Тогда `sum.wasm` копируется в `public/sum.wasm`, но не хешируется при сборке.
Подробнее про оба варианта — в
[гайде, §6.4](../guide/web-and-frontend.md#64-vite-и-webpack-куда-положить-wasm).

Запуск и сборка:

```bash
npm run dev      # http://localhost:5173
npm run build    # dist/ с хешированным sum.<hash>.wasm
npm run preview
```

## Что вы увидите

Ползунок от 1 до 1000 и строку `sum 1..100 = 5050`. При движении ползунка
строка обновляется: `main(n)` вызывается заново, память модуля при этом
переиспользуется (каждый вызов аллоцирует строку, куча растёт — для демо это
нормально).

Если в ядре вызвать `print(...)`, строки появятся в консоли браузера с
префиксом `[latent]`; здесь `print` не используется.

## Подводные камни

- **StrictMode в dev вызывает эффект дважды.** `modulePromise` кэширует
  компиляцию, `instanceRef` — экземпляр; повторный запуск не ломает
  компонент. Без кэша вы увидите два `fetch` и две компиляции.
- **`cancelled` обязателен.** Иначе после размонтирования (или быстрого
  переключения ползунка) придёт `setState` на мёртвый компонент.
- **Не создавайте экземпляр в рендере.** `new WebAssembly.Instance` в теле
  компонента выполнится на каждой перерисовке; только `useEffect`/`ref`.
- **`memory.buffer` отсоединяется после `memory.grow`.** `readString` берёт
  `memory.buffer` в момент чтения, а не кэширует `Uint8Array`.
- **Тип результата `main` не выводится.** В TypeScript придётся привести
  `instance.exports.main` к функции нужной сигнатуры; контракт (`number` или
  указатель) фиксируйте вручную.
- **SSR.** В Next.js/Nuxt компонент должен выполняться только на клиенте;
  `useEffect`/`onMounted` это обеспечивают, но `import wasmUrl` и `fetch`
  не должны попадать в серверный бандл без динамического импорта.
- **`?url` и типы.** Без `vite/client` TypeScript не знает про `*.wasm?url` —
  добавьте `/// <reference types="vite/client" />` в `src/vite-env.d.ts`.
- **CORS и base path.** При деплое на подпуть используйте
  `import.meta.env.BASE_URL`, иначе `fetch('/sum.wasm')` уйдёт в корень домена.

## Что попробовать

1. Замените ядро на `main(n: int) -> [int]` с массивом квадратов и нарисуйте
   столбики (чтение массива — в [кейсе данных](./frontend-data-processing.md)).
2. Добавьте кнопку «Сбросить», которая пересоздаёт экземпляр.
3. Вынесите вычисление в Web Worker, чтобы ползунок не подтормаживал на
   больших `n`.
4. Сравните `?url` и `public/`: посмотрите, какие имена файлов попадают в
   `dist/`.

## Связанные разделы

- [Latent во фронтенде](../guide/web-and-frontend.md) — ABI и интеграция.
- [Строки](./frontend-strings.md) — чтение `[len][utf8]`.
- [Данные и массивы](./frontend-data-processing.md) — массивы в памяти.
- [Свой playground](./frontend-compiler-playground.md) — компилятор в браузере.
