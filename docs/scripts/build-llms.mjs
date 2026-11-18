#!/usr/bin/env node
// build-llms.mjs — генерация llms.txt / llms-full.txt для документации Latent.
//
// Формат llms.txt — стандарт llmstxt.org: H1 с названием проекта, цитата с
// кратким описанием, затем секции H2 со списком ссылок `- [Заголовок](URL):
// описание`. Ссылки абсолютные (https://jegius.github.io/latent/...), потому
// что сайт публикуется как project pages с baseUrl '/latent/'.
//
// Локализация:
//   * ru (defaultLocale)  → docs/static/llms.txt, llms-full.txt
//   * en (i18n-переводы)  → docs/static/llms-en.txt, llms-en-full.txt,
//     ссылки https://jegius.github.io/latent/en/<path>.
//   Английские файлы генерируются, только если в
//   docs/i18n/en/docusaurus-plugin-content-docs/current/ есть хотя бы один
//   переведённый .md/.mdx. Если переводов нет — печатается пометка, а в
//   llms.txt добавляется строка о том, что английская версия в процессе.
//
// Запускается из docs/package.json перед docusaurus build:
//   "build": "node scripts/build-llms.mjs && docusaurus build"
//
// Использование:
//   node docs/scripts/build-llms.mjs [--root <repo>] [--verbose]
//
// Результат: docs/static/llms.txt, llms-full.txt,
//            docs/static/llms-en.txt, llms-en-full.txt (когда есть переводы).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = __dirname;

const argv = process.argv.slice(2);
let repoRoot = resolve(SCRIPT_DIR, '..', '..');
let verbose = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && argv[i + 1]) repoRoot = resolve(argv[++i]);
  else if (argv[i] === '--verbose' || argv[i] === '-v') verbose = true;
  else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log('usage: node docs/scripts/build-llms.mjs [--root <repo>] [--verbose]');
    process.exit(0);
  }
}

const docsRoot = join(repoRoot, 'docs', 'docs');
const enDocsRoot = join(
  repoRoot,
  'docs',
  'i18n',
  'en',
  'docusaurus-plugin-content-docs',
  'current',
);
const staticDir = join(repoRoot, 'docs', 'static');

// Сайт публикуется как project pages: https://jegius.github.io/latent/
// Ссылки в llms.txt должны быть абсолютными, поэтому baseUrl учитывается.
const SITE_URL = process.env.DOCS_SITE_URL || 'https://jegius.github.io';
const BASE_URL = process.env.DOCS_BASE_URL || '/latent/';

/**
 * Относительный путь документа → абсолютный URL сайта.
 * @param {string} pathname — путь вида '/guide/functions' или '/'
 * @param {'ru'|'en'} [locale='ru']
 */
function absoluteUrl(pathname, locale = 'ru') {
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const prefix = locale === 'en' ? 'en/' : '';
  if (pathname === '/' || pathname === '') {
    return `${SITE_URL.replace(/\/+$/, '')}${base}${prefix}`;
  }
  const rel = pathname.replace(/^\/+/, '');
  return `${SITE_URL.replace(/\/+$/, '')}${base}${prefix}${rel}`;
}

/** Порядок и подписи разделов (ru по умолчанию, en — для llms-en). */
function sections(locale) {
  return locale === 'en'
    ? [
        ['intro', 'Introduction'],
        ['getting-started', 'Getting Started'],
        ['tutorial', 'Tutorial'],
        ['guide', 'Language Guide'],
        ['reference', 'Reference'],
        ['specs', 'Specifications'],
        ['tooling', 'Tooling'],
        ['examples', 'Examples'],
      ]
    : [
        ['intro', 'Введение'],
        ['getting-started', 'Начало работы'],
        ['tutorial', 'Туториал'],
        ['guide', 'Руководство по языку'],
        ['reference', 'Справочник'],
        ['specs', 'Спецификации'],
        ['tooling', 'Инструменты'],
        ['examples', 'Примеры'],
      ];
}

// ---------------------------------------------------------------------------
// Markdown-файлы и front matter
// ---------------------------------------------------------------------------

/** @param {string} dir @returns {string[]} */
function walkMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full));
    else if (/\.mdx?$/i.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Простейший разбор YAML front matter (плоские скалярные значения).
 * @param {string} text
 */
function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return {meta: {}, body: text};
  const meta = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[kv[1]] = value;
  }
  return {meta, body: text.slice(m[0].length)};
}

/** Первый заголовок H1 в markdown-тексте (вне code fence). */
function firstH1(body) {
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) return m[1].trim();
    }
  }
  return null;
}

/**
 * URL документа: путь относительно каталога контента без расширения;
 * `index` превращается в каталог. trailingSlash: false — без завершающего
 * слэша (кроме корня).
 * @param {string} relPath
 */
function docUrl(relPath) {
  const noExt = relPath.replace(/\.mdx?$/i, '');
  const parts = noExt.split(/[\\/]/);
  if (parts[parts.length - 1] === 'index') parts.pop();
  return parts.length ? '/' + parts.join('/') : '/';
}

/**
 * @typedef {Object} Doc
 * @property {string} file
 * @property {string} rel
 * @property {string} section
 * @property {string} title
 * @property {string} body
 * @property {number} position
 * @property {string} url
 * @property {string} description
 */

/**
 * Собирает документы каталога (рекурсивно) в отсортированный список.
 * @param {string} root — каталог контента
 * @param {'ru'|'en'} locale
 * @returns {Doc[]}
 */
function collectDocs(root, locale) {
  /** @type {Doc[]} */
  const docs = [];
  for (const file of walkMarkdown(root)) {
    const rel = relative(root, file);
    const raw = readFileSync(file, 'utf8');
    const {meta, body} = splitFrontMatter(raw);
    const parts = rel.split(/[\\/]/);
    const section = parts.length > 1 ? parts[0] : '';
    const title =
      meta.title || meta.sidebar_label || firstH1(body) || rel.replace(/\.mdx?$/i, '');
    const position = Number.parseInt(meta.sidebar_position ?? '999', 10) || 999;
    docs.push({
      file,
      rel,
      section,
      title,
      body: body.trim(),
      position,
      url: docUrl(rel),
      description: meta.description || '',
    });
  }

  const rank = new Map(sections(locale).map(([dir], i) => [dir, i]));
  docs.sort((a, b) => {
    const ra = rank.has(a.section) ? rank.get(a.section) : 100;
    const rb = rank.has(b.section) ? rank.get(b.section) : 100;
    if (ra !== rb) return ra - rb;
    if (a.position !== b.position) return a.position - b.position;
    return a.rel.localeCompare(b.rel);
  });
  return docs;
}

// ---------------------------------------------------------------------------
// Генерация llms.txt / llms-full.txt
// ---------------------------------------------------------------------------

/**
 * @param {Doc[]} docs
 * @param {Object} opts
 * @param {'ru'|'en'} opts.locale
 * @param {string} opts.summary
 * @param {string} opts.details
 * @param {string} [opts.missingNote] — пометка о неполном переводе
 */
function renderIndex(docs, {locale, summary, details, missingNote}) {
  const lines = ['# Latent', '', `> ${summary}`, '', details, ''];
  if (missingNote) {
    lines.push(missingNote, '');
  }

  // Документы в корне (сейчас это index.mdx) — отдельной секцией.
  const rootDocs = docs.filter((d) => !d.section);
  if (rootDocs.length > 0) {
    lines.push(locale === 'en' ? '## Overview' : '## Обзор', '');
    for (const doc of rootDocs) {
      const desc = doc.description ? `: ${doc.description}` : '';
      lines.push(`- [${doc.title}](${absoluteUrl(doc.url, locale)})${desc}`);
    }
    lines.push('');
  }

  for (const [dir, label] of sections(locale)) {
    const items = docs.filter((d) => d.section === dir);
    if (items.length === 0) continue;
    lines.push(`## ${label}`, '');
    for (const doc of items) {
      const desc = doc.description ? `: ${doc.description}` : '';
      lines.push(`- [${doc.title}](${absoluteUrl(doc.url, locale)})${desc}`);
    }
    lines.push('');
  }

  // Разделы, которых нет в стандартном списке (на случай новых каталогов).
  const knownDirs = new Set(sections(locale).map(([dir]) => dir));
  const extraDirs = [...new Set(docs.map((d) => d.section))].filter(
    (d) => d && !knownDirs.has(d),
  );
  for (const dir of extraDirs) {
    lines.push(`## ${dir}`, '');
    for (const doc of docs.filter((d) => d.section === dir)) {
      const desc = doc.description ? `: ${doc.description}` : '';
      lines.push(`- [${doc.title}](${absoluteUrl(doc.url, locale)})${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * @param {Doc[]} docs
 * @param {Object} opts
 * @param {'ru'|'en'} opts.locale
 * @param {string} opts.summary
 * @param {string} opts.source
 */
function renderFull(docs, {locale, summary, source}) {
  const title =
    locale === 'en' ? 'Latent — full documentation' : 'Latent — полная документация';
  const parts = [`# ${title}`, '', `> ${summary}`, '', source, ''];
  for (const doc of docs) {
    parts.push('='.repeat(78));
    parts.push(`## ${doc.title}`);
    parts.push(`Файл: ${doc.rel.replace(/\\/g, '/')}`);
    parts.push(`URL: ${absoluteUrl(doc.url, locale)}`);
    parts.push('');
    parts.push(doc.body);
    parts.push('');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// ru (defaultLocale)
// ---------------------------------------------------------------------------

const ruDocs = collectDocs(docsRoot, 'ru');
const enDocs = collectDocs(enDocsRoot, 'en');

const RU_SUMMARY =
  'Документация языка программирования Latent — AI-native языка, ' +
  'компилируемого в WebAssembly. Два движка: интерпретатор на JavaScript ' +
  '(движок №1) и компилятор на Rust → WASM (движок №2).';

let ruDetails =
  'Язык: Latent (репозиторий https://github.com/jegius/latent, ветка ' +
  'part10-toolchain). Документация на русском языке; playground: ' +
  absoluteUrl('/playground/') +
  '. Каждый ```latent-пример в документации проверяется компилятором; ' +
  'блоки с пометкой «не компилируется» описывают фичи, требующие ' +
  'host-рантайма движка №1.';

let missingNote = '';
if (enDocs.length === 0) {
  missingNote =
    'Английская версия (i18n, /latent/en/) в процессе перевода: ' +
    absoluteUrl('/', 'en') +
    ' — непереведённые страницы отдаются из русской локали (fallback).';
} else {
  ruDetails +=
    ' Английская версия: ' +
    absoluteUrl('/', 'en') +
    ' (llms-en.txt / llms-en-full.txt).';
}

const ruIndex = renderIndex(ruDocs, {
  locale: 'ru',
  summary: RU_SUMMARY,
  details: ruDetails,
  missingNote,
});
const ruFull = renderFull(ruDocs, {
  locale: 'ru',
  summary: RU_SUMMARY,
  source: `Источник: https://github.com/jegius/latent (docs/docs). Всего документов: ${ruDocs.length}.`,
});

// ---------------------------------------------------------------------------
// en (i18n-переводы; только если они есть)
// ---------------------------------------------------------------------------

const EN_SUMMARY =
  'Documentation of Latent, an AI-native programming language compiled to ' +
  'WebAssembly. Two engines: a JavaScript interpreter (engine #1) and a ' +
  'Rust → WASM compiler (engine #2).';

/** @type {Array<{name: string, content: string}>} */
const staticFiles = [
  {name: 'llms.txt', content: ruIndex},
  {name: 'llms-full.txt', content: ruFull},
];

if (enDocs.length > 0) {
  const enDetails =
    'Language: Latent (https://github.com/jegius/latent, branch ' +
    'part10-toolchain). Documentation in English (translated from Russian; ' +
    'untranslated pages fall back to the Russian locale). Playground: ' +
    absoluteUrl('/playground/') +
    '. Every ```latent example is checked by the compiler; blocks marked as ' +
    'non-compiling describe host-runtime features of engine #1.';

  const enIndex = renderIndex(enDocs, {
    locale: 'en',
    summary: EN_SUMMARY,
    details: enDetails,
    missingNote: '',
  });
  const enFull = renderFull(enDocs, {
    locale: 'en',
    summary: EN_SUMMARY,
    source:
      'Source: https://github.com/jegius/latent (docs/i18n/en). ' +
      `Translated documents: ${enDocs.length}.`,
  });
  staticFiles.push({name: 'llms-en.txt', content: enIndex});
  staticFiles.push({name: 'llms-en-full.txt', content: enFull});
} else {
  // Убираем устаревшие en-файлы, если переводы удалили/ещё не готовы.
  for (const name of ['llms-en.txt', 'llms-en-full.txt']) {
    const stale = join(staticDir, name);
    if (existsSync(stale)) rmSync(stale);
  }
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

mkdirSync(staticDir, {recursive: true});
for (const {name, content} of staticFiles) {
  writeFileSync(join(staticDir, name), content, 'utf8');
}

if (verbose) {
  for (const doc of ruDocs) console.log(`  ru ${doc.url}  ${doc.title}`);
  for (const doc of enDocs) console.log(`  en ${doc.url}  ${doc.title}`);
}

const sizes = staticFiles
  .map((f) => `${f.name}: ${f.content.length} байт`)
  .join('; ');
console.log(
  `llms: ru ${ruDocs.length} док., en ${enDocs.length} док. → ` +
    `${relative(repoRoot, staticDir)} (${sizes})`,
);
if (enDocs.length === 0) {
  console.log(
    'llms-en.txt/llms-en-full.txt не сгенерированы: переводов в ' +
      'docs/i18n/en/docusaurus-plugin-content-docs/current пока нет ' +
      '(fallback на ru).',
  );
}
