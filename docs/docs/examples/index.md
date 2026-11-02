---
title: "Разборы примеров"
description: "Навигация по разборам примеров языка Latent: основы, алгоритмы, конкурентность, AI, ООП, функциональный стиль. Код из web-ide/examples со значениями вывода в web IDE."
sidebar_position: 1
---

# Разборы примеров

Примеры этого раздела — реальные файлы из `web-ide/examples/` (единый источник
правды для web IDE, тестов и документации). Для каждого примера: код,
объяснение, что вы увидите в консоли web IDE при **Run** (движок №1), и
отличия при компиляции/запуске движком №2.

| Разбор | Примеры из `web-ide/examples/` |
|---|---|
| [Основы](./basics.md) | `variables_types.lat`, `operators.lat`, `control_flow.lat`, `functions.lat`, `builtins_methods.lat`, `arrays.lat`, `strings.lat` |
| [Алгоритмы](./algorithms.md) | `recursion.lat`, `sorting.lat` |
| [Конкурентность](./concurrency.md) | `channels.lat`, `parallel_sum.lat`, `select_yield.lat` |
| [AI и тензоры](./ai.md) | `ai_infer.lat`, `ai_embed.lat`, `ai_streaming.lat`, `ai_pipeline.lat`, `tensors.lat`, `testing_contracts.lat` |
| [ООП](./oop.md) | `classes.lat` |
| [Функциональный стиль](./functional.md) | `fp_patterns.lat`, `lambdas.lat` |
| [Модули](./modules.md) | многофайловый проект `math.lat` + `model.lat` + `main.lat` |

## Веб и фронтенд

Отдельная серия самодостаточных кейсов — Latent как WASM-ядро в браузере
(каждый содержит `.lat`, JS-обвязку и разбор того, что видно на странице):

| Кейс | Чему учит |
|---|---|
| [Калькулятор](./frontend-calculator.md) | парсер выражений на Latent; константа в исходнике и компиляция на лету через `compiler.wasm` |
| [Данные и массивы](./frontend-data-processing.md) | передача `[len][i32...]` через память, сортировка/агрегация, чтение результата |
| [Строки и UTF-8](./frontend-strings.md) | `[len][utf8]`, байтовая длина и индексация, `load8` |
| [React](./frontend-react.md) | компонент на TypeScript, `useEffect` + `ref`, Vite |
| [Canvas](./frontend-canvas.md) | WASM считает кадр/шаг сортировки, canvas рисует |
| [Компилятор в браузере](./frontend-compiler-playground.md) | `latent_alloc`/`latent_compile`/`latent_free`, свой playground |
| [Интерактивные демо](./frontend-showcase.md) | восемь демо в браузере: горутины и каналы, AI-примитивы, self-host, песочница, модули, бенчмарк, фильтры изображений и физика |

## Демо и killer-фичи

Пять новых самодостаточных демо запускают настоящий Latent-код прямо на странице,
а старые показывают реальную нагрузку:

| Демо | Что показывает |
|---|---|
| <a href="/latent/demos/concurrency/">Горутины и каналы</a> | `spawn`, `channel`, `select`, `yield`: трасса планировщика, fan-in, worker pool, 1000 горутин, дедлок |
| <a href="/latent/demos/ai/">AI-native</a> | `ai_embed`/`cosine_similarity`/`ai_infer`/`ai_stream`/`tensor`/`matmul`, heatmap и стриминг |
| <a href="/latent/demos/selfhost/">Self-host</a> | `seed.wasm` компилирует `shc.lat`: стадии, sha256, FIXED POINT, запуск sample |
| <a href="/latent/demos/sandbox/">Песочница</a> | недоверенный код в Worker с одним импортом: таймаут, OOB-trap, memory.grow |
| <a href="/latent/demos/modules/">Модули</a> | 4 `.lat`, граф импортов, двухфазная линковка, мангленные имена, циклы |
| <a href="/latent/demos/bench/">Бенчмарк</a> | JS против Latent→WASM на пяти алгоритмах |
| <a href="/latent/demos/image/">Изображения</a> | фильтры над `ImageData` и слайдер сравнения |
| <a href="/latent/demos/physics/">Физика</a> | до 30 000 частиц, FPS-график, parity с JS |

Рядом с каждым — исходник `.lat`, живые метрики и честные ограничения.
Подробный разбор — в [«Восемь интерактивных демо»](./frontend-showcase.md).

Общая теория — в [«Latent во фронтенде»](../guide/web-and-frontend.md) и
[«Latent в браузере за 5 минут»](../getting-started/web-browser.md).

## Как запускать

1. Откройте [Web IDE](../tooling/web-ide.md) — playground собирается из
   `web-ide/`.
2. `File → Examples → <группа> → <пример>` или папка `examples/` в дереве
   проекта.
3. **Run** (`Ctrl/⌘+Enter`) — исполнить движком №1; **Run with AI** — с
   AI-функциями и self-repair.
4. Чтобы проверить компиляцию движком №2 — **Engine #2** или вкладка **WASM**
   (программа не исполняется).

## Что важно помнить

- **Run исполняет движок №1**, а не WASM. Поведение в консоли — это семантика
  JS-интерпретатора.
- Движок №1 не поддерживает побитовые операторы, `str/int/float/sqrt`,
  блочные комментарии — часть примеров будет работать только в движке №2
  (компиляция) или только в №1 (исполнение). `enum` и файловые модули движок №1
  поддерживает.
- Host-only примеры (AI, тензоры, каналы, контракты) помечены в разборах:
  движок №2 на них выдаёт ошибку «требует host-рантайма» — это ожидаемо.
- Поставляемый `web-ide/compiler.wasm` актуален — собран из текущего `src/` и
  включает memory-builtins (см. [bootstrap](../tooling/bootstrap.md)); Engine #2
  принимает то же, что описано в этом разделе.

## Проверка кода примеров

Все блоки `latent` в этом разделе проверены компилятором
(`docs/scripts/validate-examples.mjs`); блоки host-only помечены первой строкой
`// Не компилируется движком №2: ...`. Многофайловые примеры (разбор
[«Модули»](./modules.md)) помечены `// module-part <файл>`: по отдельности они
не компилируются, валидатор их пропускает и считает отдельно. Если вы меняете
пример в `web-ide/examples/`, обновите и разбор.

## Связанные разделы

- [Web IDE](../tooling/web-ide.md) — как открыть playground.
- [Справочник](../reference/index.md) — детали синтаксиса/типов.
- [Движки](../specs/engines.md) — почему поведение различается.
