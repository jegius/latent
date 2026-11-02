# Архитектура web IDE Latent

Статус: актуально для ветки `part10-toolchain`. Документ описывает браузерную IDE
(`web-ide/`): оба движка исполнения, слои приложения, поток выполнения программы,
принятые SOLID-решения, декомпозицию и покрытие тестами.

## 1. Назначение и границы

Web IDE — это статическое приложение без сборки: `index.html` подключает один
ES-модуль `main.js`, все остальные файлы — обычные ES-модули, которые браузер
загружает по относительным путям. Каталог целиком копируется в
`docs/static/playground/` скриптом `scripts/sync-playground.mjs` (исключая
`test/`, `README.md`, `node_modules`), поэтому любой модуль обязан оставаться
валидным ES-модулем без бандлера.

Внешние зависимости отсутствуют: только браузерные API (`canvas`, `localStorage`,
`fetch`, `WebAssembly`, `Cache API`, `btoa/atob`), а в Node-тестах — `node:test`,
`node:fs` и глобальные стабы.

## 2. Два движка

| | Движок №1 | Движок №2 |
|---|---|---|
| Что это | tree-walking интерпретатор на JS | настоящий компилятор Latent (Rust) → WebAssembly |
| Где | `compiler/` | `compiler.wasm` (копия `latent.wasm`), загрузчик — `compiler/wasm-loader.js` |
| Когда используется | всегда доступен; кнопка Run/Check, AI-режим | лениво: кнопка Engine #2, вкладка WASM, `CompilerService.ensureWasmCompiler()` |
| Результат | значение `main()` + `print`-вывод + анализ кода | байткод `.wasm` для вкладки WASM/интеграции |
| Покрытие языка | полная семантика (каналы, тензоры, AI, контракты, self-repair) | «чистое» подмножество; host-фичи дают явную ошибку |
| Отказоустойчивость | — | если `compiler.wasm` недоступен, IDE остаётся на движке №1 (graceful) |

Движок №2 грузится через Cache API (если доступен) с fallback на голый `fetch`,
инстанцируется через `WebAssembly.instantiate` и работает по ABI
`latent_alloc` / `latent_compile` / `latent_free` / `latent_version` (см.
`compiler/wasm-loader.js`). Формат ответа — `[status u32][len u32][payload]`.

## 3. Карта модулей

### 3.1 Корень `web-ide/`

| Файл | Ответственность |
|---|---|
| `index.html` | разметка: menubar, toolbar, workbench, статус-бар, скрытый `textarea` |
| `styles.css` | точка входа темы (`@import styles/index.css`) |
| `main.js` | точка входа и контроллер IDE: связывает views/services/controllers, меню, горячие клавиши |
| `compiler-loader.js` | **тонкий barrel-фасад** публичного API компилятора (25 строк, только реэкспорт) |
| `examples.js` | **тонкий barrel-фасад** асинхронного API примеров (16 строк) |
| `hot-reload.js` | дебаунсер автоперезапуска (не hot-swap, а авто-run) |

### 3.2 Слой движка `compiler/` (движок №1 + AI + движок №2)

| Зона | Модули | Ответственность |
|---|---|---|
| Лексика | `token.js`, `lexer.js` | типы токенов, ключевые/мягкие ключевые слова, токенизация |
| Разбор | `parser-core.js`, `parser-declarations.js`, `parser-statements.js`, `parser-expressions.js`, `parser-match.js`, `parser-concurrency.js`, `parser.js` | рекурсивный спуск по зонам грамматики; `Parser` собирается из миксинов, `parser.js` — только композиция |
| Runtime-примитивы | `environment.js`, `oop.js`, `value-utils.js` | окружение переменных, `ReturnSignal`, каналы, экземпляры классов, тензоры, deep-equal, форматирование, `matmul`, диспетчер методов |
| Исполнение | `interpreter.js`, `interpreter-statements.js`, `interpreter-expressions.js`, `interpreter-builtins.js`, `interpreter-ai.js` | планировщик goroutines, вызовы функций/методов, инструкции, выражения, таблица builtins, детерминированные AI-mock'и |
| AI | `ai-config.js`, `ai-gateway.js`, `repair.js`, `run.js` | конфигурация и persistent-кэш инференса, HTTP-гейтвей (ollama / openai-compatible), self-repair, pre-fetch + запуск программы |
| Анализ | `analysis.js` | метрики и оценка сложности для вкладки AI Insights |
| Модули | `modules.js`, `modules-link.js`, `modules-manifest.js`, `modules-rewrite.js`, `parser-modules.js` | канонизация путей и DFS-граф импортов, двухфазная линковка с манглингом `mN$`, манифест `LPF1` и хэш проекта, переписывание AST, грамматика `import`/`export` и `enum` |
| Движок №2 | `wasm-loader.js`, `loader.js` | ленивая загрузка/ABI WASM-компилятора (`latent_compile` и `latent_compile_files`); публичный API движка №1 (`compile`/`checkSyntax`/`getVersion`) |
| Публичный API | `index.js` | агрегатор; `compiler-loader.js` — его браузерный фасад |

### 3.3 Слой сервисов `services/` (бизнес-логика, без DOM)

| Модуль | Ответственность |
|---|---|
| `compiler-service.js` | компиляция/запуск, self-repair-цикл, форматирование результата и hex-дампа байткода, ленивая загрузка движка №2 |
| `compiler-service-project.js` | многофайловые проекты: нормализация project-input, выбор движка, линковка (движок №1) и манифест `LPF1` (движок №2), кэш по хэшу набора файлов |
| `ai-settings-service.js` | загрузка/сохранение настроек AI в `localStorage`, применение к `AIConfig`, проверка соединения |
| `workspace-service.js` | модель файлов `.lat` (создание/переименование/удаление/активный файл), персистентность |
| `share-service.js` | код в base64 URL-hash (UTF-8-безопасно) и `localStorage` |
| `formatter-service.js` | чистая функция форматирования: отступы и пробелы (строки/комментарии не трогаются) |

### 3.4 Слой отображения `views/` (только DOM)

| Модуль | Ответственность |
|---|---|
| `canvas-editor.js` | barrel-фасад канвас-редактора (4 строки) |
| `editor/index.js` | композиция подмодулей редактора, публичный класс `CanvasEditor`, синхронизация textarea ↔ модель |
| `editor/editor-theme.js` | палитра Darcula и лексические множества подсветки |
| `editor/editor-metrics.js` | позиция ↔ (line, col), максимумы скролла, автоскролл (чистые функции) |
| `editor/editor-renderer.js` | отрисовка текста, гуттера, каретки, выделения, скроллбаров |
| `editor/line-tokenizer.js` | построчная токенизация для подсветки (чистая функция) |
| `editor/editor-input.js` | скрытый `textarea`, IME/undo, автоотступ Enter, Tab, парные скобки |
| `editor/editor-pointer.js` | колесо, скроллбар (drag/track), клик и позиционирование каретки |
| `editor/editor-navigation.js` | стрелки, Backspace/Delete/Enter/Tab и ввод поверх модели `ed.code` |
| `output-view.js` | вкладки Output/WASM/AI Insights, статус-бар |
| `toolbar-view.js` | привязка кнопок тулбара |
| `menubar-view.js` | меню File/Edit/View/Run/AI/Help |
| `file-tree-view.js` | дерево файлов и папка `examples/` |
| `ai-settings-view.js` | панель настроек AI Gateway |
| `modal-view.js` | портальные модальные окна вместо `confirm/prompt/alert` |

### 3.5 Слой контроллеров `controllers/` (миксины прототипа)

| Модуль | Ответственность |
|---|---|
| `command-controller.js` | Run/Check/WASM/Share/Example/Save/Format/About |
| `file-controller.js` | дерево файлов, табы, статус-бар, создание/удаление/переименование |
| `ai-settings-controller.js` | связывание `AISettingsView` ↔ `AISettingsService`, проверка соединения |

Контроллеры — объекты-миксины, подмешиваемые в `LatentIDEController.prototype`
в `main.js`; это единственная точка, где сходятся все три слоя.

### 3.6 Вспомогательные каталоги

| Каталог | Содержимое |
|---|---|
| `examples/` | реальные `.lat`-файлы (единый источник правды), `manifest.js` (метаданные), `loader.js` (fetch в браузере / fs в Node), `index.js` |
| `styles/` | base, menubar, toolbar, panels, editor, output, statusbar, responsive, modal, ai-settings; точка входа — `index.css` |
| `scripts/` | `check-structure.mjs` — структурный аудит (см. §6) |
| `test/` | 27 файлов `node:test`, 414 тестов, покрывают все слои, кроме DOM-обвязки (см. §7) |

### 3.7 Направление зависимостей

```
main.js ──► controllers/ ──► services/ ──► compiler-loader.js ──► compiler/
   │            │                │                                    ▲
   └──────────► views/ ──────────┴──────────── examples.js ──► examples/
                  └── editor/ (чистые: theme, metrics, line-tokenizer)
```

Правила: `views/` не знают о `services/`; `services/` не знают о DOM; контроллеры
знают об обоих слоях и только они; `compiler/` не импортирует `services/` и
`views/`; циклических импортов нет (`compiler/index.js` — единственная точка
агрегации публичного API, `compiler-loader.js` — её фасад для остальных слоёв).

## 4. Поток выполнения программы

### 4.1 Запуск (движок №1), кнопка Run / `Ctrl+Enter`

1. `commandController.handleCompile(withAI)` берёт код из `editor.getCode()`.
2. `CompilerService.compileAndRun(source, withAI)`:
   - `compile()` — байткод «движка №1» (`TextEncoder`, если движок №2 не загружен);
   - `runLatent(source, withAI)`:
     - `tokenize` → `Parser.parseProgram()` → AST (`functions`/`classes`/`tests`);
     - при `withAI` и реальном провайдере — pre-fetch: `collectAIPrompts` находит
       литеральные prompt'ы `ai_infer`, ответы берутся из `persistentAICache`
       (ключ `provider::model::prompt`) или из гейтвея; ошибки сети не кэшируются;
     - `new Interpreter(program, output).run()` — вызов `main`, затем прогон
       планировщика goroutines (дедлок → ошибка), затем `test`-блоки;
   - `analyzeCode(source)` — метрики для AI Insights.
3. Контроллер выводит `logs`, `Result`, включает self-repair при ошибке
   (`compileAndRunWithRepair`, до 3 попыток), обновляет вкладки WASM/AST и статус.

### 4.2 Self-repair

`CompilerService.compileAndRunWithRepair` ловит ошибку компиляции/исполнения и
вызывает `repairCode(source, diagnostic, withAI)`:

- при реальном гейтвее — запрос модели и `extractCode` (снимает ```-ограждения);
- при mock-провайдере/ошибке гейтвея — `deterministicRepair` (вставка `;` по
  номеру строки из диагностики, добавление недостающих `}`);
- `null` — ремонт невозможен, пробрасывается исходная ошибка; исчерпание попыток —
  `Self-repair failed after N attempts`.

### 4.3 Движок №2 (WASM)

1. `CompilerService.ensureWasmCompiler()` → `loadWasmCompiler()` (один раз).
2. `loadWasmCompiler`: Cache API (`caches.open` → `match`/`put`) или `fetch`;
   `WebAssembly.instantiate`; при ABI `latent_compile` — вызов через
   `latent_alloc` и чтение `[status][len][payload]`, иначе — совместимый
   контракт `compile(source)` (строка или `alloc`+`ptr,len`).
3. Ошибка компиляции → исключение с текстом диагностики; недоступный/чужой
   модуль → `null` (IDE остаётся на движке №1). `version()` берётся из
   `latent_version`, если экспортирована.

Дополнительно `wasm-loader` определяет `supportsModules` (есть ли в сборке
`latent_compile_files`) и даёт `compileFiles(manifest)`.

### 4.4 Многофайловый проект (модули)

Точка входа — `CompilerService.compileForRunProject(files, entry)` из
`services/compiler-service-project.js`; активный файл workspace считается entry.

1. `normalizeProjectInput` приводит вход к `{files: [{name, code}], entry}` и
   валидирует, что entry есть в наборе.
2. `projectUsesModules` решает, нужен ли модульный путь: файлов больше одного
   или в каком-то файле есть `import`.
3. **Движок №2** (если ABI есть): `buildModuleManifest` сортирует файлы по
   пути, `encodeModuleManifest` собирает `LPF1`, `wasm.compileFiles(bytes)`
   отдаёт байткод; результат кэшируется по `projectHash` (пути + содержимое +
   entry, лимит 32).
4. **Движок №1**: `linkModuleProject(files, entry)` — DFS-граф, таблицы
   символов, манглинг, переписанный AST; интерпретатор исполняет уже связанную
   программу (`runLatentProject`). Кэш линковки — по хэшу набора файлов.
5. При ошибке движка №2 проект сначала проверяется JS-линкером (его
   диагностика «нет файла / символ не экспортирован» точнее), затем исполнение
   идёт движком №1 с пометкой в статус-баре.
6. `checkSyntaxProject` проверяет только линковку и синтаксис; self-repair
   правит **только entry-файл**, остальные считаются библиотечными.

## 5. SOLID-решения и что декомпозировано

- **SRP**: один модуль — одна зона ответственности. Крупные модули разбиты:
  парсер — на зоны грамматики (`parser-*`), интерпретатор — на инструкции/
  выражения/builtins/AI, редактор — на тему/метрики/рендер/ввод/указатель/
  навигацию/токенизатор, сервисы — по одному на бизнес-задачу.
- **OCP/DIP**: `compiler/index.js` и `compiler-loader.js` — стабильный
  публичный API; `services/` зависят от фасада, а не от внутренних модулей
  движка; `wasm-loader` поддерживает два ABI-контракта без изменения вызывающих.
- **LSP/ISP**: «миксины» парсера и контроллеров реализуют узкие наборы методов;
  view-модули получают только то, что им нужно (например, renderer/input
  принимают `ed`, а не весь контроллер).
- **Тонкие фасады**: `compiler-loader.js` (25 строк), `examples.js` (16),
  `views/canvas-editor.js` (4), `compiler/index.js` (27) — только реэкспорт;
  их толщина и «только-реэкспортность» проверяются скриптом.
- **Декомпозиция `views/editor/editor-input.js`** (было 376 строк → 177):
  мышь/скроллбар вынесены в `editor-pointer.js` (124), стрелки и правка модели —
  в `editor-navigation.js` (90); `editor/index.js` импортирует модули напрямую,
  публичный API `CanvasEditor` не изменился.
- **Устранено дублирование равенства**: `structuralEqual` в
  `interpreter-builtins.js` дублировал `deepEqual` из `value-utils.js`, а
  `looseEqual` в `interpreter-statements.js` был усечённой копией. Теперь
  `assert_eq(...)` (builtin) и `assert_eq`-инструкция используют один
  `deepEqual` — поведение консистентно (структурное сравнение массивов,
  объектов, `Result`/`Option`, тензоров).
- **Исправлен найденный дефект**: регэксп удаления `think`-блоков в
  `ai-gateway.js` искал ` thinking`, а не `<think>` — теперь reasoning-модели
  (qwen3 и т.п.) действительно очищаются; покрыто тестом.
- **Порог 300 строк** на `.js`-файл соблюдается во всём `web-ide/`: самый
  длинный модуль (`services/formatter-service.js`) доходит примерно до 270
  строк, остальные меньше; аудит подтверждает `OK (96 .js-файлов)`.

## 6. Структурный аудит

`web-ide/scripts/check-structure.mjs` (запуск: `pnpm run check:structure`)
проверяет: размер каждого `.js`-файла (< 300 строк), что barrel-фасады
(`compiler-loader.js`, `examples.js`, `views/canvas-editor.js`,
`compiler/index.js`) не толще 40 строк и содержат только реэкспорт, отсутствие
BOM и TODO-заглушек. Текущий результат: **OK (96 `.js`-файлов)**.

## 7. Покрытие тестами

Методика: `node --experimental-test-coverage --test "test/*.test.js" "test/*.test.mjs"`
(Node v24.21.0), покрытие считается по модулям, которые реально загружены
тестами. Всего **414 тестов, 0 падений**. Итог: **97.51% строк / 91.47% ветвей /
98.52% функций** (до модульной работы: 99.53 / 96.98 / 98.39 на 368 тестах — доля
упала, потому что добавились новые файлы модулей с неполным покрытием:
`modules-rewrite.js` — 70.95% строк).

| Файл | Line % | Branch % | Funcs % |
|---|---:|---:|---:|
| `compiler-loader.js` | 100.00 | 100.00 | 100.00 |
| `compiler/ai-config.js` | 100.00 | 100.00 | 100.00 |
| `compiler/ai-gateway.js` | 100.00 | 97.50 | 100.00 |
| `compiler/analysis.js` | 100.00 | 92.16 | 100.00 |
| `compiler/environment.js` | 100.00 | 100.00 | 100.00 |
| `compiler/host-features.js` | 100.00 | 93.33 | 100.00 |
| `compiler/index.js` | 100.00 | 100.00 | 100.00 |
| `compiler/interpreter-ai.js` | 100.00 | 100.00 | 100.00 |
| `compiler/interpreter-builtins.js` | 100.00 | 100.00 | 100.00 |
| `compiler/interpreter-expressions.js` | 99.59 | 98.13 | 100.00 |
| `compiler/interpreter-statements.js` | 98.30 | 97.44 | 100.00 |
| `compiler/interpreter.js` | 97.67 | 85.98 | 96.67 |
| `compiler/lazy-ai.js` | 95.00 | 100.00 | 80.00 |
| `compiler/lexer.js` | 100.00 | 97.78 | 100.00 |
| `compiler/loader.js` | 100.00 | 100.00 | 100.00 |
| `compiler/modules-link.js` | 96.49 | 79.31 | 100.00 |
| `compiler/modules-manifest.js` | 97.58 | 74.58 | 100.00 |
| `compiler/modules-rewrite.js` | 70.95 | 55.13 | 100.00 |
| `compiler/modules.js` | 96.85 | 82.52 | 100.00 |
| `compiler/oop.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-concurrency.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-core.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-declarations.js` | 100.00 | 97.50 | 100.00 |
| `compiler/parser-expressions.js` | 98.73 | 96.24 | 100.00 |
| `compiler/parser-match.js` | 100.00 | 100.00 | 100.00 |
| `compiler/parser-modules.js` | 95.08 | 90.32 | 100.00 |
| `compiler/parser-statements.js` | 100.00 | 98.35 | 100.00 |
| `compiler/parser.js` | 100.00 | 100.00 | 100.00 |
| `compiler/repair-core.js` | 100.00 | 89.66 | 100.00 |
| `compiler/repair.js` | 100.00 | 100.00 | 100.00 |
| `compiler/run.js` | 100.00 | 94.87 | 100.00 |
| `compiler/token.js` | 100.00 | 100.00 | 100.00 |
| `compiler/value-utils.js` | 98.26 | 98.61 | 100.00 |
| `compiler/wasm-loader.js` | 100.00 | 73.68 | 100.00 |
| `examples.js` | 100.00 | 100.00 | 100.00 |
| `examples/index.js` | 100.00 | 100.00 | 100.00 |
| `examples/loader.js` | 92.75 | 76.92 | 77.78 |
| `examples/manifest.js` | 100.00 | 100.00 | 100.00 |
| `hot-reload.js` | 100.00 | 94.44 | 91.67 |
| `services/ai-settings-service.js` | 100.00 | 100.00 | 100.00 |
| `services/compiler-service-project.js` | 92.23 | 74.70 | 95.24 |
| `services/compiler-service.js` | 98.25 | 92.19 | 100.00 |
| `services/formatter-service.js` | 100.00 | 99.26 | 100.00 |
| `services/share-service.js` | 100.00 | 100.00 | 100.00 |
| `services/workspace-service.js` | 100.00 | 98.18 | 100.00 |
| `views/editor/editor-metrics.js` | 98.73 | 95.00 | 100.00 |
| `views/editor/editor-theme.js` | 100.00 | 100.00 | 100.00 |
| `views/editor/line-tokenizer.js` | 100.00 | 100.00 | 100.00 |
| **Итого** | **97.51** | **91.47** | **98.52** |

Непокрытые строки — защитные/недостижимые ветки и редкие пути: остаток
goroutine-очереди после опустошения планировщика (`interpreter.js`), `catch`
восстановления позиции в `skipTypeArgs` (`parser-expressions.js`),
недостижимые из WASM возвраты `Uint8Array`/`ArrayBuffer` (`wasm-loader.js`),
ветки диагностики в `modules-rewrite.js` (переписывание редких видов паттернов и
декораторов), защитные проверки манифеста (`modules-manifest.js`,
`modules-link.js`), деградация `examples/loader.js` без браузерных API.

### Что добавлено в тесты

- Раньше: 11 новых файлов, 188 тестов (гейтвей, настройки AI, builtins,
  value-utils, pipeline, engine1-extra, parser-edge, services-extra,
  formatter-edge, wasm-loader-edge, editor-core). Старые 149 тестов не менялись.
- Модули (+46 тестов): `test/modules.test.js` (резолвер путей, граф, циклы,
  кэш), `test/modules-engine1.test.js` (линковка и исполнение в движке №1),
  `test/modules-manifest.test.js` (`LPF1`, `projectHash`),
  `test/modules-wasm-abi.test.js` (реальный `latent_compile_files`),
  `test/modules-service.test.js` (проектный сервис, кэш, engine #2-фолбэк),
  `test/bundling.test.mjs` (сборка/чанки).


## 8. Как запускать

```bash
cd web-ide
pnpm test                      # node --test "test/*.test.js" — 368 тестов
pnpm coverage                  # node --experimental-test-coverage --test ... + таблица покрытия
pnpm run check:structure       # структурный аудит (файлы < 300, тонкие фасады, BOM)
```

Экземпляр `node` для запуска: `node.exe` v24.21.0 (см. `latent-work/PLAN.md`);
`pnpm` запускается как `node <pnpm.mjs> ...`. Зависимостей у `web-ide` нет,
поэтому `pnpm install` не требуется.

Смежные проверки (вне `web-ide/`):

```bash
node scripts/verify-wasm.mjs web-ide/compiler.wasm   # validate + instantiate: OK
node scripts/integration.mjs                         # требует target/debug/latentc (cargo build)
```

`verify-wasm.mjs` с `--run` ожидает программу с экспортированным `main()`
(скомпилированный пользовательский `.wasm`), а не `compiler.wasm`. Скрипт
`integration.mjs` проверен: сейчас завершается с кодом 2 и сообщением
`latentc not found ... run 'cargo build --bin latentc'` — это внешняя
зависимость (Rust-сборка), а не регрессия web-ide.

## 9. Риски и известные ограничения

1. **Покрытие считается только по загруженным модулям.** `main.js`,
   `controllers/*`, `views/*` (кроме чистых `editor/theme|metrics|line-tokenizer`)
   завязаны на DOM и не импортируются в Node-тестах, поэтому в отчёт покрытия не
   входят. Для их проверки нужен jsdom/happy-dom или e2e (Playwright) — отдельная
   задача; сейчас их контракты косвенно покрыты юнит-тестами сервисов/чистых
   модулей.
2. **Недостижимые защитные ветки** (см. §7) сознательно оставлены в коде как
   defensive programming; они не влияют на acceptance (порог ≥ 90% строк).
3. **Legacy-модули CodeMirror-эпохи** — `autocomplete.js`, `syntax-highlight.js`
   (глобальный `CodeMirror`) и альтернативный `runtime.js` — не подключены в
   `index.html` и не используются; рекомендованы к удалению отдельным коммитом
   (не удалены в этой задаче, чтобы не задеть возможные внешние ссылки).
4. **`integration.mjs`** требует `target/debug/latentc` (Rust-сборка) и внешних
   сервисов не использует; в текущем окружении бинарь отсутствует.
5. **Числа покрытия** сняты на Node v24 с экспериментальным флагом; при смене
   версии Node возможны небольшие расхождения в процентах ветвей.
6. **Тесты изолированы по файлам** (node:test запускает файлы в отдельных
   процессах), глобальные стабы (`fetch`, `caches`, `localStorage`, `window`,
   `location`) восстанавливаются в `finally`.
7. **Playground в доках**: `scripts/sync-playground.mjs` копирует только
   браузерные файлы (`index.html`, `*.js`, `styles/`, `compiler/`, `views/`,
   `services/`, `examples/`, `*.wasm`), поэтому новые подмодули редактора
   попадают в playground автоматически, а `test/`, `package.json` и `scripts/`
   — нет; изменений в sync-скрипте не требуется.
