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
- Поставляемый `web-ide/compiler.wasm` может быть старше `src/` (см.
  [bootstrap](../tooling/bootstrap.md)); это влияет на то, что примет
  Engine #2.

## Проверка кода примеров

Все блоки `latent` в этом разделе проверены компилятором
(`docs/scripts/validate-examples.mjs`); блоки host-only помечены первой строкой
`// Не компилируется движком №2: ...`. Если вы меняете пример в
`web-ide/examples/`, обновите и разбор.

## Связанные разделы

- [Web IDE](../tooling/web-ide.md) — как открыть playground.
- [Справочник](../reference/index.md) — детали синтаксиса/типов.
- [Движки](../specs/engines.md) — почему поведение различается.
