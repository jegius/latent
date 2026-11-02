---
title: "Web IDE (playground)"
description: "Полное описание браузерной IDE Latent: два движка, возможности, горячие клавиши, встраивание через iframe, публикация на GitHub Pages и локальный запуск."
sidebar_position: 1
---

import {PlaygroundFrame, PlaygroundLink} from '@site/src/components/Playground';

# Web IDE (playground)

Latent playground — полноценная браузерная IDE в стиле IntelliJ IDEA Darcula
(тёмная тема, canvas-редактор, дерево проекта, консоль, AI-режим). Она собрана
из `web-ide/` и публикуется как статический каталог сайта документации:
**<PlaygroundLink>открыть playground</PlaygroundLink>**
(`https://jegius.github.io/latent/playground/`).

<PlaygroundFrame height="640px" title="Latent playground" />

## Что это

- **Статическое приложение** без бэкенда: HTML + ES-модули + `compiler.wasm`.
- **Два движка**: JS-интерпретатор (исполняет полный язык) и Rust-компилятор
  в WASM (компилирует host-free подмножество). Playground сам выбирает движок
  и автоматически откатывается на №1 — подробно в разделе
  [движки](../specs/engines.md).
- **Единый источник примеров**: `web-ide/examples/*.lat` (их же читают тесты и
  этот раздел документации).
- Все данные (файлы, настройки AI) хранятся в `localStorage`; код можно
  расшарить ссылкой.

## Возможности

| Возможность | Как пользоваться |
|---|---|
| Редактор | canvas-рендер: номера строк, подсветка текущей строки, скролл, выделение; ввод через скрытый `textarea` (IME, кириллица, undo) |
| Автоотступ/скобки | Enter — автоотступ; автозакрытие `()[]{}` и кавычек; Tab/Shift+Tab |
| Форматирование | `Edit → Format Code` (`Ctrl/⌘+Alt+L`) — выравнивание по `{}` и нормализация пробелов; строки/комментарии не трогаются |
| Дерево файлов | `＋` — создать `.lat`; переименование/удаление; всё сохраняется в браузере |
| Табы и статус-бар | Ln/Col, активный движок, имя файла; средняя кнопка мыши по табу закрывает файл |
| Примеры | папка `examples/` в дереве проекта + меню `File → Examples` (по группам) |
| Run | `Ctrl/⌘+Enter` — исполнить движком №1; host-фичи работают, при загруженном №2 — авто-фолбэк |
| Run with AI | `Ctrl/⌘+Shift+Enter` — AI-режим + self-repair (до 3 попыток) + AI-инсайты |
| Check | проверить синтаксис (лексер+парсер движка №1) |
| Engine #2 | явно скомпилировать «чистое» подмножество; для host-программы — объяснение и кнопка «Run in engine #1» |
| Вкладка WASM | hex-дамп скомпилированного модуля (или «байткода» движка №1) |
| Вкладка AI Insights | метрики: функции, циклы, условия, сложность, строки, токены |
| Share | код в base64 в URL (`#code=...`), ссылка копируется в буфер |
| auto-run | дебаунсированный автозапуск при редактировании |
| AI Gateway | настройки провайдера/URL/модели/ключа (`AI → AI Gateway Settings`) |

## Модули и многофайловые проекты

Дерево файлов — это полноценный проект: **активный файл является entry**, а
остальные `.lat`-файлы подключаются через `import`. Поддерживаются top-level
`fn`, `class` и `enum`:

```text
// math.lat
export fn square(x: int) -> int { return x * x; }
export enum Shape { Circle(int), Rect(int, int) }

// main.lat
import { square, Shape } from "./math.lat";
import { square as sq } from "./math.lat";

fn main() -> int {
    let s = Circle(2);
    return match s { case Circle(r): { return square(r) + sq(r); } default: 0 };
}
```

- `import { name, name as alias } from "./path.lat";` и
  `import "./path.lat";`; путь только относительный, расширение `.lat`
  обязательно, выход за корень workspace запрещён.
- Циклы импорта разрешены (двухфазная линковка), файл загружается один раз по
  каноническому пути. Ошибки (нет файла, символ не экспортирован, дубликат
  имени, import/export не на top-level, абсолютный путь) показываются с путём
  и строкой: `main.lat:3: ...`.
- **Run / Run with AI / Check** работают с проектом: Check проверяет не только
  синтаксис активного файла, но и линковку импортов; Run исполняет все модули,
  включая host-фичи. **Format** форматирует активный файл.
- **Движок №1** линкует модули нативно (JS-резолвер `compiler/modules.js`,
  линковщик `compiler/modules-*.js`), кэширует разобранные модули по хэшу
  содержимого и поддерживает `enum` с несколькими полями варианта.
- **Движок №2** получает все `.lat`-файлы workspace одним манифестом `LPF1` в
  C-ABI `latent_compile_files`; результат кэшируется по хэшу набора файлов.
  Поставляемый `compiler.wasm` экспортирует этот ABI, поэтому **Engine #2**
  компилирует проект целиком (проверка — `supportsModules`). Если загружена
  старая сборка без ABI, кнопка показывает «engine #2 пока без модулей» и
  предлагает запуск в engine #1; однофайловый `latent_compile` работает как
  раньше.
- **CLI и selfhost**: тот же проект собирается `latentc compile/check`, а для
  self-hosted компилятора хост делает `latentc bundle` → плоский исходник.
  Полный синтаксис, семантика линковки и ограничения v1 —
  [файловые модули](../guide/modules.md).

## Горячие клавиши

| Комбинация | Действие |
|---|---|
| `Ctrl/⌘+Enter` | Run |
| `Ctrl/⌘+Shift+Enter` | Run with AI |
| `Ctrl/⌘+S` | Save (файл и так автосохраняется) |
| `Ctrl/⌘+Alt+L` | Format Code |
| `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z` | Undo / Redo |
| `Ctrl/⌘+A` | Select All |
| Средняя кнопка по табу | закрыть файл (с подтверждением) |

Пока открыто модальное окно, глобальные комбинации не перехватываются.

## Полноценное исполнение host-фич в браузере

Playground исполняет **любую** программу языка, включая host-фичи: каналы
(`channel()`, `ch <- v`, `<-ch`, `ch.send`/`ch.recv`), `select`, `spawn`,
`yield`, AI-примитивы (`ai_infer`, `ai_embed`, `ai_stream`, `tensor`, `matmul`,
`cosine_similarity`), контракты и `test`-блоки. Их реализует движок №1
(tree-walking JS с host-рантаймом); движок №2 — только WASM-компилятор
host-free подмножества. Переключение автоматическое, ошибки №2 не становятся
финальными для Run.

## Два движка — что важно знать

| | Движок №1 (JS) | Движок №2 (Rust→WASM) |
|---|---|---|
| Run | ✅ исполняет полный язык | ❌ не исполняет, только компилирует |
| Компиляция | «байткод» = исходник | настоящий WASM для host-free подмножества |
| AI/каналы/тензоры/контракты | ✅ полная семантика | ❌ ошибка «требует host-рантайма» |
| Сообщения об ошибках | английские, JS | русские, компилятора |
| Выбор в playground | всегда исполнение | bytecode для чистых программ; при ошибке — авто-фолбэк |

- **Run всегда исполняет движок №1** — полный host-рантайм языка. Даже если
  движок №2 уже загружен, host-программа не отправляется в него.
- Чистые программы (без host-фич) при загруженном №2 по-прежнему компилируются
  им для вкладки WASM. Host-фичи определяются автоматически (каналы, `spawn`,
  `select`, `yield`, AI, тензоры, `test`/контракты); для них bytecode даёт №1.
- Если движок №2 всё же вернул ошибку «требует host-рантайма» (или любую
  ошибку компиляции), Run **не показывает её как финальную**: выполнение
  автоматически идёт в №1, а статус-бар показывает `engine #1 (host runtime)`.
- Кнопка **Engine #2** — явный выбор: для host-программы компилятор объясняет
  ограничение и предлагает кнопку **Run in engine #1**.
- Кнопка **Engine #2** и вкладка **WASM** лениво загружают `compiler.wasm`
  (Cache API, имя `latent-compiler-v1`).
- Если `compiler.wasm` недоступен, IDE остаётся на движке №1 (graceful
  degradation), статус-бар показывает `engine #1 (host runtime)`.
- Поставляемый `compiler.wasm` актуален: собран из текущего `src/` (630 340
  байт), memory-builtins и модульный ABI (`latent_compile_files`,
  `latent_bundle_files`) в нём есть — см. [bootstrap](./bootstrap.md).
- **AI-примеры в обычном Run** включают mock автоматически (сеть не нужна).
  Реальный гейтвей и self-repair — по-прежнему через **Run with AI**.

## Примеры

Группы (`web-ide/examples/manifest.js`): Concurrency, Algorithms, Data,
Functional, Language, OOP, AI, Testing, Misc. Разборы — в разделе
[примеры](../examples/index.md).

- **Все примеры запускаются обычным Run** — в том числе `channels`,
  `select_yield`, `parallel_sum`, `tensors`, `testing_contracts` и `ai_*`:
  host-фичи исполняет движок №1, AI-примеры автоматически получают mock.
- Для AI-примеров обычный Run не ходит в сеть; чтобы использовать настроенный
  гейтвей, нажмите **Run with AI** (или `Ctrl/⌘+Shift+Enter`).
- Примеры без host-фич дополнительно компилируются движком №2 для вкладки WASM.

## Встраивание на страницу

Компоненты из `docs/src/components/Playground.jsx` (используются на этой
странице):

```jsx
import {PlaygroundFrame, PlaygroundLink} from '@site/src/components/Playground';

<PlaygroundLink>Открыть Web IDE</PlaygroundLink>
<PlaygroundFrame height="640px" title="Latent playground" />
```

`PlaygroundFrame` строит iframe с `src`, учитывающим `baseUrl`, поэтому при
публикации на GitHub Pages (`baseUrl: '/latent/'`) ссылка автоматически
становится `/latent/playground/`. Прямая ссылка на playground в продакшене:
`https://jegius.github.io/latent/playground/`.

## Локальный запуск

Playground — статические файлы, но **не** работает по `file://` (ES-модули и
`fetch`): нужен HTTP-сервер.

```bash
# вариант 1: напрямую из web-ide/
cd web-ide
python3 -m http.server 8000        # или: npx serve .
# открыть http://localhost:8000
```

```bash
# вариант 2: локальный Docusaurus (docs-guide)
cd docs && pnpm install && pnpm start
# playground: http://localhost:3000/latent/playground/
```

Вариант 2 требует, чтобы `docs/static/playground/` был наполнен — это делает
`node scripts/sync-playground.mjs` (копирует `web-ide/`; см.
[bootstrap](./bootstrap.md)).

## Сборка движка №2 для playground

```bash
bash scripts/build-wasm.sh          # macOS-специфичный скрипт
# либо вручную:
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/latent.wasm web-ide/compiler.wasm
```

Скрипт `scripts/build-wasm.sh` жёстко ищет macOS/arm-toolchain — на
Windows/Linux используйте ручную сборку (см. [bootstrap](./bootstrap.md)).
Файлы `web-ide/compiler.wasm` и `web-ide/latent.wasm` — копии одного артефакта.

## Ленивая загрузка и чанки

У playground два режима, и оба поддерживаются из одного исходника:

| Режим | Как запустить | Что грузится |
|---|---|---|
| **Без сборки** (dev) | `cd web-ide && python3 -m http.server 8000` | статические ES-модули; `.wasm` и `.lat` — по `fetch` при первом использовании |
| **Production** | `pnpm install && pnpm run build:chunks && pnpm run preview` | `dist/`: entry + чанки, `.wasm` отдельным ассетом |

`vite build` — **опция**, а не требование: `index.html` → `main.js` и
относительные импорты работают в браузере напрямую. Сборка нужна для GitHub
Pages, кэширования по хешу и уменьшения стартового payload.

### Стратегия

- **`base: './'`** — все URL (чанки, CSS, `compiler.wasm`) резолвятся от
  `index.html`. Playground можно публиковать в любом подкаталоге:
  `/latent/playground/`, `/playground/`, локально — без правки конфига.
- **`outDir: 'dist'`** — артефакт лежит рядом с `web-ide/` и не коммитится.
- **`manualChunks`** в `web-ide/vite.config.js`:

  | Чанк | Что внутри | Когда грузится |
  |---|---|---|
  | `core` | лексер, парсер, интерпретатор, environment, value-utils, run | старт |
  | `ai` | `compiler/ai-*.js`, `interpreter-ai.js`, `repair*.js` | старт (конфиг+mock); сеть — позже |
  | `editor` | `views/editor/**` | старт |
  | `examples` | `examples/manifest.js` + все `.lat` (`?raw`) | первый клик по примеру |
  | `engine2` | `compiler/wasm-loader.js` | **Engine #2** / вкладка WASM |
  | `formatter-service` | `services/formatter-service.js` | `Format Code` |
  | `vendor` | `node_modules/**` (если появятся) | по мере надобности |

- **`dynamic import()`** — границы ленивости зафиксированы в коде, а не только
  в конфиге:
  - `compiler/loader.js` → `import('./wasm-loader.js')` при первом
    `loadWasmCompiler()`; сам `.wasm` — `new URL('../compiler.wasm',
    import.meta.url)` (Vite эмитит хешированный ассет, `public/` не нужен);
  - `compiler/lazy-ai.js` → `import('./ai-gateway.js')` и
    `import('./repair.js')` только при AI-запросе/self-repair;
  - `examples/loader.js` → `import('./manifest.js')` и `import.meta.glob('?raw')`
    для `.lat`; стартует IDE с метаданными каталога и одним стартовым примером;
  - форматтер — `import('../services/formatter-service.js')` в `handleFormat`.

### Размеры чанков

`pnpm run build:chunks` печатает таблицу сам (Vite 6.4.5, локальная сборка):

| Файл | Размер | gzip |
|---|---:|---:|
| `compiler-*.wasm` | 630.34 kB | — |
| `core-*.js` | 40.32 kB | 11.58 kB |
| `index-*.js` (entry) | 37.96 kB | 11.19 kB |
| `examples-*.js` | 32.19 kB | 9.03 kB |
| `editor-*.js` | 13.70 kB | 4.26 kB |
| `ai-*.js` | 4.76 kB | 2.24 kB |
| `formatter-service-*.js` | 3.46 kB | 1.37 kB |
| `engine2-*.js` | 1.88 kB | 0.79 kB |
| `index-*.css` | 12.86 kB | 3.05 kB |

Размер `.wasm` обновлён под текущий `web-ide/compiler.wasm` (630 340 байт); gzip
для него не указан — пересчитайте своим `vite build`. Остальные строки — с
локальной сборки и могут отличаться на несколько килобайт.

Стартовый JS (< 100 kB gzip вместе с CSS) не содержит ни `.wasm`, ни кода
примеров: это и есть выигрыш от `dynamic import()` + `manualChunks`. Чтобы
убедиться, что чанк действительно ленивый, ищите его имя в entry-файле:

```bash
grep -o 'examples-[A-Za-z0-9_-]*\.js' web-ide/dist/assets/index-*.js
# нет вывода → examples не в стартовом графе; import("./examples-…") — есть
```

### Публикация playground из `dist`

`scripts/sync-playground.mjs` — зона Lead; сейчас он копирует `web-ide/`
целиком. Чтобы отдавать собранные чанки, источник переключается на `dist`,
если он существует:

```js
// scripts/sync-playground.mjs (предложение для Lead)
const DIST = join(ROOT, "web-ide", "dist");
const SRC = existsSync(DIST) ? DIST : join(ROOT, "web-ide");
```

Тогда GitHub Pages получает `playground/index.html` + `playground/assets/*`,
а при отсутствии сборки — прежние исходники. `base: './'` уже учитывает
`/latent/playground/`, менять `baseUrl` Docusaurus не нужно.

### Встроить Latent-WASM в свой бандл

Подробные примеры (React/Vue/Svelte, Worker, кэш) — в
[гайде «Latent во фронтенде»](../guide/web-and-frontend.md). Коротко про
ассет-пайплайны:

```js
// Vite: ?url — хешированный ассет, работает и в dev, и в build
import coreUrl from './core.wasm?url';
const bytes = await (await fetch(coreUrl)).arrayBuffer();

// Vite/Rollup: new URL относительно модуля (тот же приём, что в wasm-loader.js)
const url = new URL('./core.wasm', import.meta.url);
```

```js
// Rollup: без плагина — скопировать .wasm в public/ и брать стабильный URL
// public/core.wasm → fetch(`${import.meta.env.BASE_URL}core.wasm`)

// Webpack 5: asset/resource
// module.rules: [{ test: /\.wasm$/, type: 'asset/resource' }]
import coreUrl from './core.wasm';
```

Собственный рантайм делите по тому же принципу: **entry** — UI и роутинг;
**core** — то, что нужно на первом экране; **wasm/engine** — `import()` в
момент, когда пользователь запускает вычисление; **examples/fixtures** — по
клику. Ориентир: entry < 50 kB gzip, ленивые чанки — сколько угодно, `.wasm` —
отдельным файлом с `Cache-Control: immutable`. Метрики берите из вывода
`vite build` (размер + gzip) и из DevTools → Network при холодной загрузке.

## Ограничения

- Движок №2 не исполняет программу — проверить поведение WASM в IDE нельзя;
  его вкладка WASM показывает только результат компиляции подмножества.
- Движок №2 не поддерживает host-фичи (каналы, AI, тензоры, контракты) — это
  не ошибка playground: Run автоматически исполняет их в движке №1.
- Движок №1 не поддерживает побитовые операторы, `str/int/float/sqrt`,
  блочные комментарии — в IDE это проявится как ошибка/недоступность.
- Форматирование — не AST-принтер: только отступы/пробелы.
- AI-ключ хранится в `localStorage` открытым текстом; запросы идут напрямую из
  браузера (нужен CORS на гейтвее).
- Ошибки self-repair не всегда исправимы: детерминированный ремонт знает только
  пропущенную `;` и несбалансированные `{}`.

## Связанные разделы

- [Движки](../specs/engines.md) · [AI-рантайм](../specs/ai-runtime.md) ·
  [Примеры](../examples/index.md)
- [VS Code](./vscode.md) · [IntelliJ IDEA](./idea.md) · [MCP](./mcp.md)
- [Bootstrap и пересборка](./bootstrap.md)
