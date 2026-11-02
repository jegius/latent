# Документация Latent (Docusaurus)

Сайт документации языка Latent. Публикуется на GitHub Pages:
**https://jegius.github.io/latent/**, web IDE (playground):
**https://jegius.github.io/latent/playground/**.

## Структура

```
docs/
├── docs/                 Markdown/MDX-контент
│   ├── index.mdx         главная
│   ├── intro/            зачем, философия, сравнение
│   ├── getting-started/  установка, hello world, CLI, web IDE
│   ├── tutorial/         пошаговый туториал (10 глав)
│   ├── guide/            гид по языку (16 разделов)
│   ├── reference/        справочник: грамматика, типы, операторы, builtins, ошибки, ABI
│   ├── specs/            спецификации: selfhost, паритет, движки, кодоген
│   ├── tooling/          IDE/плагины, MCP, bootstrap, contributing
│   └── examples/         разборы примеров
├── scripts/              build-llms.mjs, validate-examples.mjs
├── static/                картинки, llms.txt (генерируется), playground/ (генерируется)
├── src/                  стили и компонент Playground
├── docusaurus.config.js
├── sidebars.js
└── package.json
```

## Локальный запуск

```bash
# из корня репозитория: скопировать web IDE в статику сайта
node scripts/sync-playground.mjs

cd docs
pnpm install            # или npm install
pnpm start              # dev-сервер: http://localhost:3000/latent/
pnpm run build          # статическая сборка в docs/build/
pnpm run validate:examples   # проверка всех ```latent блоков компилятором
```

`pnpm run build` сначала генерирует `static/llms.txt` и `static/llms-full.txt`
(индекс и полный текст документации для LLM, формат llmstxt.org), затем
собирает сайт.

## Деплой

Публикация автоматическая: workflow
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) собирает сайт
(`node scripts/sync-playground.mjs` → `pnpm run build`) и деплоит
`docs/build` на GitHub Pages при push в `main` / `part10-toolchain`.

Требование в настройках репозитория: **Settings → Pages → Source = GitHub Actions**.

## Для нейросетей

- `https://jegius.github.io/latent/llms.txt` — индекс документации;
- `https://jegius.github.io/latent/llms-full.txt` — весь текст документации;
- MCP-сервер документации — [`mcp/docs-mcp`](../mcp/docs-mcp/README.md)
  (stdio и HTTP; tools: `list_docs`, `search_docs`, `read_doc`,
  `get_language_reference`, `get_example`, `check_code`).
