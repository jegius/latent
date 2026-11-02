# Latent IDE (web)

Браузерная IDE языка Latent в стиле IntelliJ IDEA Darcula (2026).

## Быстрый старт

```bash
# 1. Собрать движок №2 (Rust-компилятор → WASM)
./scripts/build-wasm.sh

# 2. Поднять статический сервер
cd web-ide && python3 -m http.server 8000
# открыть http://localhost:8000
```

`build-wasm.sh` сам находит rustup-тулчейн (у системного Homebrew-rustc нет
`std` для `wasm32-unknown-unknown`) и кладёт артефакт в `web-ide/compiler.wasm`.

## Production-сборка: ленивая загрузка и чанки

Сборка **опциональна**: без неё IDE работает как набор статических ES-модулей
(`python3 -m http.server` в `web-ide/`). `vite build` нужен для GitHub Pages и
для проектов, которые встраивают IDE/движок в свой бандл.

```bash
cd web-ide
pnpm install          # один раз: vite, devDependency
pnpm run build:chunks # production-сборка в dist/ с code splitting
pnpm run preview      # локальный просмотр dist/ (http://localhost:4173)
```

Что делает `vite.config.js`:

- `base: './'` — чанки и `compiler.wasm` резолвятся относительно `index.html`,
  поэтому playground работает из любого подкаталога (`/latent/playground/`);
- `outDir: 'dist'` — артефакт рядом с исходниками (в git не коммитится);
- `manualChunks` — `engine2` (`wasm-loader`), `ai` (`compiler/ai-*.js`,
  `interpreter-ai.js`, `repair*.js`), `editor` (`views/editor/**`),
  `examples` (манифест + `.lat`), `core` (лексер/парсер/интерпретатор);
- `dynamic import()` — тяжёлые части грузятся по требованию:
  `compiler/loader.js` → `wasm-loader.js` + `compiler.wasm` при первом
  использовании движка №2; `compiler/lazy-ai.js` → `ai-gateway.js`/`repair.js`
  при AI/self-repair; `examples/loader.js` → манифест и `.lat` при открытии
  примеров; форматтер — при `Format Code`.

Пример вывода `pnpm run build:chunks` (Vite 6.4.5, локальная сборка):

| Файл | Размер | gzip |
|---|---:|---:|
| `dist/assets/compiler-*.wasm` | 465.44 kB | 134.85 kB |
| `dist/assets/core-*.js` | 40.32 kB | 11.58 kB |
| `dist/assets/index-*.js` (entry) | 37.96 kB | 11.19 kB |
| `dist/assets/examples-*.js` | 32.19 kB | 9.03 kB |
| `dist/assets/editor-*.js` | 13.70 kB | 4.26 kB |
| `dist/assets/ai-*.js` | 4.76 kB | 2.24 kB |
| `dist/assets/formatter-service-*.js` | 3.46 kB | 1.37 kB |
| `dist/assets/engine2-*.js` | 1.88 kB | 0.79 kB |
| `dist/assets/index-*.css` | 12.86 kB | 3.05 kB |

Как это читать:

- `core` + `index` + `editor` + `ai` грузятся на старте (интерпретатор нужен
  сразу); `ai` мал (конфиг + mock), сетевой гейтвей внутри — за `dynamic import()`;
- `examples`, `engine2` и `formatter-service` **не входят** в стартовый граф:
  чанк подтягивается при первом клике по примеру, нажатии **Engine #2**,
  вкладке WASM или `Format Code`;
- `.wasm` — отдельный хешированный ассет: `new URL('../compiler.wasm',
  import.meta.url)` в `compiler/wasm-loader.js` (Vite эмитит его сам, `public/`
  не нужен).

### Playground на GitHub Pages: dist вместо source

`scripts/sync-playground.mjs` (зона Lead) сейчас копирует `web-ide/` целиком.
Чтобы публиковать собранные чанки, Lead'у достаточно переключить источник:

```js
// scripts/sync-playground.mjs
const DIST = join(ROOT, "web-ide", "dist");
const SRC = existsSync(DIST) ? DIST : join(ROOT, "web-ide");
```

Тогда при наличии `web-ide/dist` playground получает готовые `assets/*.js` и
`assets/compiler-*.wasm` (base `./` уже учитывает `/latent/playground/`), а без
сборки — прежние исходники. `pnpm-lock.yaml` и `node_modules/` исключать не
нужно: `dist` их не содержит, а `sync` копирует только его.

Проверка после сборки:

```bash
node scripts/sync-playground.mjs
node scripts/sync-playground.mjs --check
# в docs/static/playground/ должны появиться assets/ и index.html
```


## Два движка

| Движок | Что это | Где |
|--------|---------|-----|
| **№1** | Tree-walking интерпретатор на JS. Полная семантика языка: классы/OOP, pattern matching, async/await, каналы, goroutines, select/yield, тензоры, AI-примитивы, тесты и контракты, self-repair. | `compiler/` |
| **№2** | Настоящий компилятор Latent (Rust) → WebAssembly. Загружается лениво, кэшируется через Cache API. | `compiler.wasm` |

### Поддержка фич по движкам

| Фича | Движок №1 (JS) | Движок №2 (Rust→WASM) |
|------|:---:|:---:|
| `let`, `if/else`, `while`, `for`, `for-in`, `return`, `print` | ✅ | ✅ |
| функции, рекурсия, лямбды `fn(x) => …`, замыкания | ✅ | ✅ (частично: лямбды) |
| массивы, индексация, `push`/`pop`/`length`, `len` | ✅ | ✅ |
| `class` / `new` / `this` (поля, `init`, методы) | ✅ | ✅ (структуры) |
| `match`/`case`/`default` (литералы, `_`, связки, `Ok`/`Err`) | ✅ | ✅ |
| `async`/`await` (Promise) | ✅ | ✅ (await — passthrough) |
| `channel`, `spawn`, `<-` (send/recv), `select`, `yield` | ✅ | ⚠️ только суррогаты; `channel`/`<-` — host-ошибка |
| `tensor`, `semantic`, `matmul`, `cosine_similarity` | ✅ | ⚠️ host-фича (понятная ошибка) |
| `test`, `assert`, `assert_eq`, `@forall`, `snapshot`, контракты | ✅ (test-результаты в консоли) | ✅ (`assert`/`assert_eq`); остальное — host |

**Итого движок №1 реализует все конструкции языка.** Движок №2 — компилятор
«чистого» подмножества (числа, массивы, управление, функции, классы, `match`,
`async`, `assert`); host-зависимые фичи (каналы, тензоры, AI, контракты) он
сознательно не компилирует и даёт явную ошибку «требует host-рантайма».

**Playground автоматически выбирает движок.** Обычный Run всегда исполняет
движок №1 (полный host-рантайм). Если движок №2 уже загружен:
- чистые программы дополнительно компилируются им для вкладки WASM;
- host-программы (каналы, `select`/`spawn`, AI, тензоры, контракты) сразу
  исполняются в №1;
- любая ошибка №2 (включая «требует host-рантайма») приводит к авто-фолбэку
  на №1 — пользователь не видит её как финальную ошибку Run;
- статус-бар показывает `engine #1 (host runtime)`.

При явном выборе **Engine #2** host-программа получает объяснение и кнопку
**Run in engine #1**. AI-примеры в обычном Run используют mock (без сети);
реальный гейтвей и self-repair — через **Run with AI**.

IDE автоматически подгружает движок №2 при первой компиляции (кнопка
**Engine #2** или вкладка **WASM**). Если `compiler.wasm` недоступен —
работает движок №1. Индикатор движка — в правой части статус-бара.

## Возможности

- **Редактор**: canvas-рендер с номерами строк, подсветкой текущей строки,
  скроллом, выделением; ввод через скрытый `textarea` (IME/кириллица/undo).
  Автоотступ на Enter, автозакрытие скобок/кавычек, Tab-отступ (Shift+Tab —
  обратный), корректная установка каретки по клику в любое место строки.
- **Форматирование**: `Edit → Format Code` (`Ctrl/⌘+Alt+L`) выравнивает
  отступы по фигурным скобкам и нормализует пробелы (строки и комментарии не
  трогаются); тот же алгоритм — `services/formatter-service.js`.
- **Модальные окна**: собственный portal-based слой (`views/modal-view.js`,
  `styles/modal.css`) вместо браузерных `confirm`/`prompt`/`alert` —
  с оверлеем, анимацией, фокус-ловушкой и клавиатурой (Enter/Escape).
- **Дерево файлов** (project tool window): создание (`＋`), переименование,
  удаление `.lat`-файлов; всё персистится в `localStorage`.
- **Табы редактора** и **статус-бар** (Ln/Col, активный движок, файл).
  Средняя кнопка мыши по табу закрывает файл (с подтверждением).
- **Примеры** — папка `examples/` прямо в дереве проекта (сгруппирована по
  темам) и меню `File → Examples`; клик загружает пример как новый файл.
  Исходный код примеров — реальные `.lat`-файлы в `examples/` (единый источник
  правды, читаются и IDE, и тестами):
  Language (переменные/типы, операторы, функции, встроенные функции и методы),
  Algorithms, Data, Functional, Concurrency, AI (inference, embeddings, agents,
  streaming), Misc. Метаданные — `examples/manifest.js`, загрузка — `examples/loader.js`.
- **Run / Run with AI / Check** — компиляция и запуск; AI-режим включает
  self-repair (до 3 попыток) и AI-инсайты.
- **Share** — код в base64 прямо в URL.
- **auto-run** — дебаунсированный автозапуск при редактировании.
- Горячие клавиши: `Ctrl/⌘+Enter` — Run, `Ctrl/⌘+Shift+Enter` — Run with AI,
  `Ctrl/⌘+S` — сохранить.

## Тесты и покрытие

```bash
cd web-ide
node --test "test/*.test.js" "test/*.test.mjs"      # 368 тестов
node --experimental-test-coverage --test "test/*.test.js" "test/*.test.mjs"   # покрытие
# либо через npm/pnpm-скрипты:
pnpm test          # node --test (JS + bundling .mjs)
pnpm coverage      # node --experimental-test-coverage
pnpm run check:structure   # аудит SOLID/декомпозиции (файлы < 300 строк, тонкие фасады)
```

Текущее покрытие (node v24, `--experimental-test-coverage`): **99.53% строк,
96.92% ветвей, 98.39% функций** (модули движка/сервисов; подробная таблица —
`docs/docs/specs/webide-architecture.md`).

Покрытие: лексер/парсер/интерпретатор движка №1 (включая `assert_eq` со
структурным равенством, for-in по тензорам/Result/экземплярам, select-выражения,
вложенные объявления, rethrow), AI-гейтвей и pre-fetch с persistent-кэшем,
self-repair, планировщик goroutines и дедлоки, рабочие пространства, шаринг,
настройки AI, загрузчик и ABI движка №2 (на реальном `compiler.wasm` и на
синтетических WASM-модулях), форматтер, а также чистые модули canvas-редактора
(подсветка строки, геометрия курсора/скролла).

## Архитектура

```
web-ide/
├── index.html            разметка (menubar, toolbar, workbench, statusbar)
├── styles.css            точка входа темы (@import styles/index.css)
├── main.js               контроллер (связывает views ↔ services, меню)
├── hotkeys.js            глобальные горячие клавиши (Ctrl/⌘+Enter и т.п.)
├── vite.config.js        production-сборка: base './', dist, manualChunks
├── compiler-loader.js    barrel-фасад движка №1 + AI + движка №2
├── compiler/             движок №1 по зонам ответственности
│   ├── token.js · lexer.js · parser-core.js · parser-declarations.js
│   ├── parser-statements.js · parser-expressions.js · parser-match.js
│   ├── parser-concurrency.js · parser.js
│   ├── environment.js · oop.js · value-utils.js
│   ├── interpreter.js · interpreter-statements.js
│   ├── interpreter-expressions.js · interpreter-builtins.js · interpreter-ai.js
│   ├── ai-config.js · ai-gateway.js · host-features.js
│   ├── analysis.js · repair.js · repair-core.js
│   ├── lazy-ai.js        dynamic import AI: гейтвей/repair — по требованию
│   ├── wasm-loader.js · loader.js (dynamic import wasm) · run.js
│   └── index.js          агрегатор публичного API
├── examples/            каталог примеров: *.lat (код), manifest.js
│                         (метаданные), loader.js (lazy: glob ?raw / fetch / fs),
│                         index.js
├── examples.js           barrel-фасад примеров (async API)
├── hot-reload.js         дебаунсер автоперезапуска
├── controllers/          file-, command-, ai-settings-controller
├── views/                canvas-editor (barrel), output-view, toolbar-view,
│   │                     ai-settings-view, file-tree-view, menubar-view
│   └── editor/           theme, metrics, renderer, input (ввод/textarea),
│                         pointer (мышь/скролл), navigation (стрелки/правка),
│                         line-tokenizer
├── services/             compiler-service, ai-settings-service,
│                         workspace-service, share-service
├── test/                 node:test (*.test.js + bundling.test.mjs — без запуска vite)
├── scripts/              check-structure.mjs (аудит SRP/декомпозиции)
└── styles/               base, menubar, toolbar, panels, editor,
                          output, statusbar, responsive + index.css
```

Файлы, превышавшие 300 строк, декомпозированы; ни один `.js`-файл в `web-ide/`
не превышает 300 строк (`pnpm run check:structure` проверяет это автоматически).
Каждый модуль отвечает за одну зону (SRP/SOLID), а корневые `compiler-loader.js`,
`examples.js`, `styles.css` и `views/canvas-editor.js` сохранены как тонкие
barrel-фасады для совместимости. Повторявшиеся реализации структурного
равенства (assert/assert_eq) сведены к одному `deepEqual` в
`compiler/value-utils.js`.