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
├── i18n/                 переводы локалей (en: theme + content-docs)
├── scripts/              build-llms.mjs, build-site.mjs, validate-examples.mjs
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

## Локализация (i18n)

Сайт собирается в двух локалях: **ru** (defaultLocale, исходный контент в
`docs/docs/`) и **en** (`/latent/en/`). Переключатель языков — в navbar
(`localeDropdown`).

```
docs/i18n/en/
├── code.json                                  строки темы (генерируется)
├── docusaurus-theme-classic/
│   ├── navbar.json                            метки navbar
│   └── footer.json                            заголовки/метки футера
└── docusaurus-plugin-content-docs/
    ├── current.json                           подписи категорий sidebar и версии
    └── current/                               переводы контента (та же структура, что docs/)
        ├── index.mdx
        ├── guide/functions.md
        └── ...
```

**Fallback.** Непереведённые страницы не ломают сборку: Docusaurus-плагин
контента автоматически отдаёт контент defaultLocale (ru) по маршруту
`/latent/en/...`. Это встроенный механизм fallback на локаль по умолчанию
(специальные опции вроде `showDefaultLocale` для этого не нужны) — поэтому
`/latent/en/guide/functions` существует даже без перевода и содержит русский
текст, пока перевод не добавлен.

**Добавить перевод страницы:**

1. Создайте файл с тем же относительным путём в
   `docs/i18n/en/docusaurus-plugin-content-docs/current/`
   (например, `guide/functions.md` для `docs/docs/guide/functions.md`).
2. Переведите текст и front matter (`title`, `description`, `sidebar_label`).
   `id`/`slug` не меняйте, `slug` лучше не задавать вовсе.
3. Для новых строк интерфейса/категорий обновите JSON-файлы:

```bash
cd docs
pnpm run write-translations:en    # скелеты/обновление i18n/en/** (--locale en)
# или вручную: docusaurus write-translations --locale en
```

4. Проверьте сборку и наличие страниц:

```bash
cd docs
pnpm run build
# ru: docs/build/index.html, docs/build/guide/...
# en: docs/build/en/index.html, docs/build/en/guide/...
```

Ключи в `current.json` для категорий sidebar имеют вид
`sidebar.docs.category.<Исходная метка>`; в `footer.json` —
`link.title.<Исходный заголовок>` и `link.item.label.<Исходная метка>`.

**Проверка примеров в переводах.** `validate-examples.mjs` по умолчанию
проверяет `docs/docs/`; для en-переводов:

```bash
cd docs
LATENT_DOCS_DIR=i18n/en/docusaurus-plugin-content-docs/current \
  node scripts/validate-examples.mjs
```

**Строгость ссылок.** Пока переводы неполные, относительные markdown-ссылки в
переведённых файлах могут указывать на ещё не переведённые страницы — на это
время `onBrokenLinks`/`onBrokenMarkdownLinks` автоматически становятся
`warn` (иначе сборка падает). Когда переведены все страницы — снова `throw`.
Принудительно: `DOCS_STRICT_LINKS=1` (throw) или `DOCS_STRICT_LINKS=0` (warn).

**llms.txt для двух локалей.** `scripts/build-llms.mjs` генерирует
`static/llms.txt`/`llms-full.txt` для ru и, если в
`i18n/en/.../current/` есть хотя бы один переведённый markdown-файл,
`static/llms-en.txt`/`llms-en-full.txt` для en (ссылки
`https://jegius.github.io/latent/en/...`). Пока переводов нет — en-файлы не
создаются, а в ru-индексе появляется пометка, что английская версия в
процессе.

## Для нейросетей

- `https://jegius.github.io/latent/llms.txt` — индекс документации (ru);
- `https://jegius.github.io/latent/llms-full.txt` — весь текст документации (ru);
- `https://jegius.github.io/latent/llms-en.txt` и `.../llms-en-full.txt` —
  то же для en (когда появится хотя бы один перевод);
- MCP-сервер документации — [`mcp/docs-mcp`](../mcp/docs-mcp/README.md)
  (stdio и HTTP; tools: `list_docs`, `search_docs`, `read_doc`,
  `get_language_reference`, `get_example`, `check_code`).
