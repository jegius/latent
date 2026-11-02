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
- **Два движка**: JS-интерпретатор (исполняет) и Rust-компилятор в WASM
  (компилирует). Подробно — [движки](../specs/engines.md).
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
| Run | `Ctrl/⌘+Enter` — исполнить движком №1 |
| Run with AI | `Ctrl/⌘+Shift+Enter` — AI-режим + self-repair (до 3 попыток) + AI-инсайты |
| Check | проверить синтаксис (лексер+парсер движка №1) |
| Engine #2 | скомпилировать текущий код Rust-компилятором и показать WASM |
| Вкладка WASM | hex-дамп скомпилированного модуля (или «байткода» движка №1) |
| Вкладка AI Insights | метрики: функции, циклы, условия, сложность, строки, токены |
| Share | код в base64 в URL (`#code=...`), ссылка копируется в буфер |
| auto-run | дебаунсированный автозапуск при редактировании |
| AI Gateway | настройки провайдера/URL/модели/ключа (`AI → AI Gateway Settings`) |

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

## Два движка — что важно знать

| | Движок №1 (JS) | Движок №2 (Rust→WASM) |
|---|---|---|
| Run | ✅ исполняет | ❌ не исполняет |
| Компиляция | «байткод» = исходник | настоящий WASM |
| AI/каналы/тензоры | ✅ | ❌ ошибка host-рантайма |
| Сообщения об ошибках | английские, JS | русские, компилятора |

- **Run всегда исполняет движок №1**, даже если движок №2 загружен.
- Кнопка **Engine #2** и вкладка **WASM** лениво загружают `compiler.wasm`
  (Cache API, имя `latent-compiler-v1`).
- Если `compiler.wasm` недоступен, IDE остаётся на движке №1 (graceful
  degradation), статус-бар показывает `engine #1 (interpreter)`.
- Поставляемый `compiler.wasm` может быть старше `src/` — см.
  [bootstrap](./bootstrap.md).

## Примеры

Группы (`web-ide/examples/manifest.js`): Concurrency, Algorithms, Data,
Functional, Language, OOP, AI, Testing, Misc. Разборы — в разделе
[примеры](../examples/index.md).

- `ai_*`, `tensors`, `testing_contracts`, `channels`, `parallel_sum`,
  `select_yield` — **host-only**: запускайте через Run with AI / движок №1;
- `enum`-примеры движок №1 не исполнит (enum не поддержан) — смотрите их через
  Engine #2;
- остальные примеры исполняются движком №1 и компилируются движком №2.

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

## Ограничения

- Движок №2 не исполняет программу — проверить поведение WASM в IDE нельзя.
- Движок №1 не поддерживает `enum`, побитовые операторы, `str/int/float/sqrt`,
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
