---
title: "Участие в разработке"
description: "Структура репозитория, стиль, тесты, чек-лист добавления языковой фичи (от лексера до selfhost, language-data и документации), git-процесс."
sidebar_position: 6
---

# Участие в разработке

Репозиторий: `github.com/jegius/latent`, рабочая ветка проекта —
`part10-toolchain`. Компилятор — Rust (`src/`), web IDE — ванильный JS
(`web-ide/`), self-hosted компилятор — на самом Latent (`selfhost/`).

## Структура репозитория

```text
Cargo.toml               пакет latent (lib + bin latentc)
src/                     Rust-компилятор Latent → WASM
  lexer/ ast/ parser/ typechecker/ codegen/ runtime/ ai/ fp/
  syntax.rs types.rs     «витринные» модели (в пайплайне не используются)
  lib.rs                 compile_source + C-ABI (latent_alloc/compile/...)
  bin/latentc.rs         CLI
web-ide/                 браузерная IDE (ES-модули, без сборки)
  compiler/              движок №1 (JS) + загрузчик движка №2
  examples/              примеры *.lat (единый источник правды)
  compiler.wasm          движок №2 (Rust→WASM), генерируемый артефакт
selfhost/                компилятор на Latent: src/*.lat, shc.lat, bootstrap
scripts/                 sync-playground.mjs, build-wasm.sh
docs/                    Docusaurus-сайт документации
mcp/docs-mcp/            MCP-сервер документации
tooling/language-data/   machine-readable данные о языке (JSON)
tooling/latent-lsp/      LSP-сервер (Node, stdio)
editors/vscode/          расширение VS Code
editors/idea/            плагин IntelliJ IDEA
.github/workflows/       CI (docs.yml и др.)
```

## Стиль

- Комментарии и документация — **русский**; идентификаторы — английский.
- UTF-8 без BOM; LF; отступ 4 пробела (JS/Rust) — как в существующих файлах.
- Никаких внешних зависимостей в `web-ide/`, `mcp/`, `tooling/`, `editors/`
  без крайней необходимости: проекты zero-deps (кроме Docusaurus в `docs/` и
  Gradle в `editors/idea/`).
- `src/` декомпозирован по зонам ответственности (SRP); новые фичи —
  отдельными функциями/модулями, а не «ещё одним if».
- В `selfhost/src/*.lat`: язык без модулей, поэтому части —
  ответственностно-разделённые файлы, склеиваемые `build.mjs`.

## Инварианты, которые нельзя ломать

1. `cargo test` — зелёный.
2. `node --test "selfhost/test/*.test.mjs"` — зелёный.
3. `node --test "web-ide/test/*.test.js"` — зелёный.
4. `node selfhost/bootstrap.mjs` — `FIXED POINT: stage2 === stage3`.
5. `docs/scripts/validate-examples.mjs` — все блоки ```latent соответствуют
   ожиданиям.
6. Публичная семантика документируется: если поведение меняется, обновите
   `docs/docs/reference/**` и `tooling/language-data/language.json`.

Изменения тестов вместе с фичей допустимы, но причина фиксируется в коммите.

## Как добавить языковую фичу: чек-лист

На примере новой конструкции (скажем, `break`):

1. **Лексер** — `src/lexer/keywords.rs` (+ `token.rs`, если нужен новый токен),
   тесты в `src/lexer/tests/`.
2. **AST** — `src/ast/expr.rs` или `src/ast/stmt.rs` (+ `ast/mod.rs` реэкспорт).
3. **Парсер** — `src/parser/declarations.rs` / `statements.rs` /
   `expressions/` (+ `type_parser.rs`, если синтаксис в аннотациях).
4. **Тайпчекер** — `src/typechecker/infer/expr.rs` / `stmt.rs` (+ `types/mod.rs`,
   если нужен новый тип); решите, что именно проверяется.
5. **Кодоген** — `src/codegen/emit_expr.rs` / `emit_stmt.rs` /
   `emit_call.rs` / `module_builder.rs`; проверьте, что WASM валиден
   (`WebAssembly.validate`).
6. **Selfhost** — `selfhost/src/*.lat` (лексер/парсер/эмиссия) + пересборка
   `node selfhost/build.mjs`; сохраните фиксированную точку.
7. **Дифференциальные тесты** — `selfhost/test/features.test.mjs` (oracle vs
   stage1 vs stage2), `web-ide/test/*`, `src/codegen/tests/*`.
8. **language-data** — `tooling/language-data/language.json` (keywords/
   operators/types/builtins/diagnostics) и `latent-language.schema.json`.
9. **Документация** — `docs/docs/{guide,reference,specs,examples}/**`:
   грамматика, типы, операторы, builtins, диагностики, паритетная матрица.
   Все блоки ```latent должны компилироваться или быть помечены.
10. **Движок №1 (если применимо)** — `web-ide/compiler/*` (lexer/parser/
    interpreter) + тесты; не забывайте, что он может не поддерживать фичу —
    тогда документируйте это явно.

Для исправления дефекта кодогена (например float-контекста) добавьте
regression-тест, который проверяет `WebAssembly.validate`, а не только
`status=1`.

## Тесты

- Rust: `cargo test` (`src/lexer/tests`, `src/parser/tests`,
  `src/typechecker/tests`, `src/codegen/tests`, `src/runtime/tests`,
  `src/ai/tests`, `src/fp/tests`).
- web IDE: `node --test "web-ide/test/*.test.js"` — лексер/парсер/
  интерпретатор, планировщик, AI, workspace, загрузчик движка №2, компиляция
  примеров, продвинутые фичи.
- selfhost: `node --test "selfhost/test/*.test.mjs"` — bootstrap, lexer,
  scoping, differential features, детерминизм сборки.
- docs: `node docs/scripts/validate-examples.mjs`.
- mcp/lsp/vscode — см. [bootstrap](./bootstrap.md#5-полный-набор-проверок).

## Git-процесс

- Коммиты делает владелец ветки (Lead); агенты/контрибьюторы не коммитят
  самостоятельно без указания.
- Ветка — `part10-toolchain`; сообщения коммитов — по-русски, кратко, с
  указанием затронутых зон.
- Перед коммитом: полный набор проверок (см. выше), `git status` без мусора
  (артефакты сборки — в `.gitignore`).
- Сгенерированные артефакты (`selfhost/shc.lat`, `web-ide/compiler.wasm`,
  `docs/static/playground/`) коммитятся только по необходимости и с
  пояснением, как пересобраны.

## Границы владения (в командной работе над доками)

| Зона | Владелец |
|---|---|
| `docs/package.json`, `docusaurus.config.js`, `sidebars.js`, `docs/src/**`, `docs/static/**`, `docs/scripts/**`, `docs/docs/{intro,getting-started,tutorial,guide}/**` | docs-guide |
| `docs/docs/{reference,specs,tooling,examples}/**` | docs-reference |
| `tooling/language-data/**`, `tooling/latent-lsp/**` | language-lsp |
| `mcp/docs-mcp/**` | docs-mcp |
| `editors/vscode/**` / `editors/idea/**` | vscode / idea |
| `selfhost/**` (+ `src/codegen/emit_call.rs` при необходимости) | selfhost |
| `README.md`, `.gitignore`, `scripts/sync-playground.mjs`, git-коммиты | Lead |

## Документация: правила примеров

- Каждый блок ```latent **обязан** компилироваться `web-ide/compiler.wasm`
  (иначе сборка проверок падает).
- Host-only и заведомо невалидные примеры помечаются первой строкой
  `// ошибка: ...` / `// Не компилируется движком №2: ...` либо info-string
  `latent expected-error`.
- Сигнатуры, грамматику и псевдокод давайте в ```text.
- Ссылки на другие страницы — относительные `.md` (Docusaurus
  `onBrokenLinks: throw`).
- Web IDE упоминайте через компоненты `PlaygroundFrame`/`PlaygroundLink`
  (`docs/src/components/Playground.jsx`), а не хардкодом URL.

## Связанные разделы

- [Bootstrap](./bootstrap.md) — сборка и проверки.
- [Справочник](../reference/index.md) — что документировать.
- [Паритетная матрица](../specs/parity-matrix.md) — где расходятся движки.
