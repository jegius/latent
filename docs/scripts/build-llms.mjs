#!/usr/bin/env node
// build-llms.mjs — генерация llms.txt и llms-full.txt для документации Latent.
//
// Формат llms.txt — стандарт llmstxt.org: H1 с названием проекта, цитата с
// кратким описанием, затем секции H2 со списком ссылок `- [Заголовок](URL):
// описание`. Ссылки абсолютные (https://jegius.github.io/latent/...), потому
// что сайт публикуется как project pages с baseUrl '/latent/'.
// llms-full.txt — полный текст всех документов (front matter отброшен),
// чтобы LLM мог прочитать документацию одним запросом.
//
// Запускается из docs/package.json перед docusaurus build:
//   "build": "node scripts/build-llms.mjs && docusaurus build"
//
// Использование:
//   node docs/scripts/build-llms.mjs [--root <repo>] [--verbose]
//
// Результат: docs/static/llms.txt, docs/static/llms-full.txt

import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
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
const staticDir = join(repoRoot, 'docs', 'static');

// Сайт публикуется как project pages: https://jegius.github.io/latent/
// Ссылки в llms.txt должны быть абсолютными, поэтому baseUrl учитывается.
const SITE_URL = process.env.DOCS_SITE_URL || 'https://jegius.github.io';
const BASE_URL = process.env.DOCS_BASE_URL || '/latent/';

/** Относительный путь документа к абсолютному URL сайта. */
function absoluteUrl(pathname) {
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const rel = pathname.replace(/^\/+/, '');
  return `${SITE_URL.replace(/\/+$/, '')}${base}${rel}`;
}

const TITLE = 'Latent';
const SUMMARY =
  'Документация языка программирования Latent — AI-native языка, ' +
  'компилируемого в WebAssembly. Два движка: интерпретатор на JavaScript ' +
  '(движок №1) и компилятор на Rust → WASM (движок №2).';

const DETAILS =
  'Язык: Latent (репозиторий https://github.com/jegius/latent, ветка ' +
  'part10-toolchain). Документация на русском языке; playground: ' +
  absoluteUrl('/playground/') +
  '. Каждый ```latent-пример в документации проверяется компилятором; ' +
  'блоки с пометкой «не компилируется» описывают фичи, требующие ' +
  'host-рантайма движка №1.';

/** Порядок и подписи разделов. */
const SECTIONS = [
  ['intro', 'Введение'],
  ['getting-started', 'Начало работы'],
  ['tutorial', 'Туториал'],
  ['guide', 'Руководство по языку'],
  ['reference', 'Справочник'],
  ['specs', 'Спецификации'],
  ['tooling', 'Инструменты'],
  ['examples', 'Примеры'],
];

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
 * URL документа: путь относительно docs/docs без расширения; `index`
 * превращается в каталог. trailingSlash: false — без завершающего слэша
 * (кроме корня).
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

/** @type {Doc[]} */
const docs = [];
for (const file of walkMarkdown(docsRoot)) {
  const rel = relative(docsRoot, file);
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

const sectionRank = new Map(SECTIONS.map(([dir], i) => [dir, i]));
docs.sort((a, b) => {
  const ra = sectionRank.has(a.section) ? sectionRank.get(a.section) : 100;
  const rb = sectionRank.has(b.section) ? sectionRank.get(b.section) : 100;
  if (ra !== rb) return ra - rb;
  if (a.position !== b.position) return a.position - b.position;
  return a.rel.localeCompare(b.rel);
});

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

const lines = [`# ${TITLE}`, '', `> ${SUMMARY}`, '', DETAILS, ''];

// Документы в корне docs/docs (сейчас это index.mdx) — отдельной секцией.
const rootDocs = docs.filter((d) => !d.section);
if (rootDocs.length > 0) {
  lines.push('## Обзор', '');
  for (const doc of rootDocs) {
    const desc = doc.description ? `: ${doc.description}` : '';
    lines.push(`- [${doc.title}](${absoluteUrl(doc.url)})${desc}`);
  }
  lines.push('');
}

for (const [dir, label] of SECTIONS) {
  const items = docs.filter((d) => d.section === dir);
  if (items.length === 0) continue;
  lines.push(`## ${label}`, '');
  for (const doc of items) {
    const desc = doc.description ? `: ${doc.description}` : '';
    lines.push(`- [${doc.title}](${absoluteUrl(doc.url)})${desc}`);
  }
  lines.push('');
}
// Разделы, которых нет в SECTIONS (на случай новых каталогов).
const knownDirs = new Set(SECTIONS.map(([dir]) => dir));
const extraDirs = [...new Set(docs.map((d) => d.section))].filter(
  (d) => d && !knownDirs.has(d),
);
for (const dir of extraDirs) {
  lines.push(`## ${dir}`, '');
  for (const doc of docs.filter((d) => d.section === dir)) {
    const desc = doc.description ? `: ${doc.description}` : '';
    lines.push(`- [${doc.title}](${absoluteUrl(doc.url)})${desc}`);
  }
  lines.push('');
}

const llmsTxt = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

// ---------------------------------------------------------------------------
// llms-full.txt
// ---------------------------------------------------------------------------

const fullParts = [
  `# ${TITLE} — полная документация`,
  '',
  `> ${SUMMARY}`,
  '',
  `Источник: https://github.com/jegius/latent (docs/docs). Всего документов: ${docs.length}.`,
  '',
];

for (const doc of docs) {
  fullParts.push('='.repeat(78));
  fullParts.push(`## ${doc.title}`);
  fullParts.push(`Файл: docs/docs/${doc.rel.replace(/\\/g, '/')}`);
  fullParts.push(`URL: ${absoluteUrl(doc.url)}`);
  fullParts.push('');
  fullParts.push(doc.body);
  fullParts.push('');
}

const llmsFull = fullParts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

mkdirSync(staticDir, {recursive: true});
writeFileSync(join(staticDir, 'llms.txt'), llmsTxt, 'utf8');
writeFileSync(join(staticDir, 'llms-full.txt'), llmsFull, 'utf8');

if (verbose) {
  for (const doc of docs) {
    console.log(`  ${doc.url}  ${doc.title}`);
  }
}
console.log(
  `llms.txt: ${docs.length} документов, ${llmsTxt.length} байт; ` +
    `llms-full.txt: ${llmsFull.length} байт → ${relative(repoRoot, staticDir)}`,
);
