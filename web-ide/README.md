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
| `channel`, `spawn`, `<-` (send/recv), `select`, `yield` | ✅ | ⚠️ host-фича (понятная ошибка) |
| `tensor`, `semantic`, `matmul`, `cosine_similarity` | ✅ | ⚠️ host-фича (понятная ошибка) |
| `test`, `assert`, `assert_eq`, `@forall`, `snapshot`, контракты | ✅ | ✅ (`assert`/`assert_eq`); остальное — host |

**Итого движок №1 реализует все конструкции языка.** Движок №2 — компилятор
«чистого» подмножества (числа, массивы, управление, функции, классы, `match`,
`async`, `assert`); host-зависимые фичи (каналы, тензоры, AI, контракты) он
сознательно не исполняет и **даёт явную ошибку «требует host-рантайма»**, а не
молчаливый отказ.

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

## Тесты

```bash
cd web-ide && node --test test/*.test.js
```

Покрытие: лексер/парсер/интерпретатор движка №1, планировщик goroutines и
дедлоки, AI и self-repair, рабочие пространства, шаринг, загрузчик и ABI
движка №2 (на реальном `compiler.wasm`), компиляция примеров, а также
продвинутые фичи языка (классы, `match`, `async/await`, `select`/`yield`,
тензоры, тесты/контракты, лямбды) — `test/features.test.js`.

## Архитектура

```
web-ide/
├── index.html            разметка (menubar, toolbar, workbench, statusbar)
├── styles.css            точка входа темы (@import styles/index.css)
├── main.js               контроллер (связывает views ↔ services, меню)
├── compiler-loader.js    barrel-фасад движка №1 + AI + движка №2
├── compiler/             движок №1 по зонам ответственности
│   ├── token.js · lexer.js · parser-core.js · parser-declarations.js
│   ├── parser-statements.js · parser-expressions.js · parser-match.js
│   ├── parser-concurrency.js · parser.js
│   ├── environment.js · oop.js · value-utils.js
│   ├── interpreter.js · interpreter-statements.js
│   ├── interpreter-expressions.js · interpreter-builtins.js · interpreter-ai.js
│   ├── ai-config.js · ai-gateway.js · ai-* 
│   ├── analysis.js · repair.js · wasm-loader.js · loader.js · run.js
│   └── index.js          агрегатор публичного API
├── examples/            каталог примеров: *.lat (код), manifest.js
│                         (метаданные), loader.js (fetch/fs), index.js
├── examples.js           barrel-фасад примеров (async API)
├── hot-reload.js         дебаунсер автоперезапуска
├── controllers/          file-, command-, ai-settings-controller
├── views/                canvas-editor (barrel), output-view, toolbar-view,
│   │                     ai-settings-view, file-tree-view, menubar-view
│   └── editor/           theme, metrics, renderer, input, line-tokenizer
├── services/             compiler-service, ai-settings-service,
│                         workspace-service, share-service
└── styles/               base, menubar, toolbar, panels, editor,
                          output, statusbar, responsive + index.css
```

Файлы, превышавшие 300 строк, декомпозированы; ни один файл в `web-ide/` не
превышает 300 строк. Каждый модуль отвечает за одну зону (SRP/SOLID), а
корневые `compiler-loader.js`, `examples.js`, `styles.css` и
`views/canvas-editor.js` сохранены как тонкие barrel-фасады для совместимости.