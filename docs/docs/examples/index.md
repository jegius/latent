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
| [Интерактивные демо](./frontend-showcase.md) | бенчмарк JS против WASM, фильтры изображений и физика частиц; живые метрики в браузере |

## Демо и производительность

Три самодостаточных демо запускаются прямо на странице и показывают Latent на
реальной нагрузке: [бенчмарк против JS, фильтры canvas и физика частиц](./frontend-showcase.md).
Рядом с каждым — исходник `.lat`, живые миллисекунды и честное сравнение.

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
- Движок №1 не поддерживает `enum`, побитовые операторы, `str/int/float/sqrt`,
  блочные комментарии — часть примеров будет работать только в движке №2
  (компиляция) или только в №1 (исполнение).
- Host-only примеры (AI, тензоры, каналы, контракты) помечены в разборах:
  движок №2 на них выдаёт ошибку «требует host-рантайма» — это ожидаемо.
- Поставляемый `web-ide/compiler.wasm` актуален — собран из текущего `src/` и
  включает memory-builtins (см. [bootstrap](../tooling/bootstrap.md)); Engine #2
  принимает то же, что описано в этом разделе.

## Проверка кода примеров

Все блоки `latent` в этом разделе проверены компилятором
(`docs/scripts/validate-examples.mjs`); блоки host-only помечены первой строкой
`// Не компилируется движком №2: ...`. Если вы меняете пример в
`web-ide/examples/`, обновите и разбор.

## Связанные разделы

- [Web IDE](../tooling/web-ide.md) — как открыть playground.
- [Справочник](../reference/index.md) — детали синтаксиса/типов.
- [Движки](../specs/engines.md) — почему поведение различается.
