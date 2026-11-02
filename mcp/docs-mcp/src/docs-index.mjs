// docs-index.mjs — индекс Markdown-документации Latent.
//
// Единственная ответственность: обойти `docs/docs/**/*.md`, разобрать front
// matter (title/description/sidebar_position/tags), сгруппировать страницы по
// разделам (вложенные папки = разделы) и сложить всё в структуру, удобную для
// tools/resources. Индекс строится синхронно при старте сервера; отсутствие
// каталога документации — не падение, а пустой индекс с диагностикой.

import fs from 'node:fs';
import path from 'node:path';

import {
    parseFrontMatter,
    extractHeadings,
    stripMarkdown,
    firstParagraph,
    normalizeText,
} from './markdown.mjs';

/** Порядок известных разделов сайта; незнакомые идут после по алфавиту. */
const SECTION_ORDER = [
    'root',
    'intro',
    'getting-started',
    'tutorial',
    'guide',
    'reference',
    'specs',
    'tooling',
    'examples',
];

/**
 * Рекурсивно собирает относительные пути всех Markdown-файлов каталога.
 * @param {string} root абсолютный путь к каталогу документации
 * @returns {string[]} пути относительно `root` с прямыми слэшами
 */
export function walkMarkdown(root) {
    /** @type {string[]} */
    const files = [];

    /** @param {string} dir */
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                walk(absolute);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!/\.mdx?$/i.test(entry.name)) continue;
            files.push(path.relative(root, absolute).split(path.sep).join('/'));
        }
    }

    walk(root);
    files.sort((a, b) => a.localeCompare(b));
    return files;
}

/**
 * Превращает имя файла в человекочитаемый заголовок (запасной вариант).
 * @param {string} relativePath
 * @returns {string}
 */
function titleFromPath(relativePath) {
    const base = relativePath.split('/').pop().replace(/\.mdx?$/i, '');
    if (base === 'index') {
        const parent = relativePath.split('/').slice(-2)[0];
        return parent ? humanize(parent) : 'Документация';
    }
    return humanize(base);
}

/** @param {string} name */
function humanize(name) {
    return name
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (ch) => ch.toUpperCase());
}

/**
 * Строит запись документа из файла.
 * @param {string} root
 * @param {string} relativePath
 * @returns {object}
 */
function buildDoc(root, relativePath) {
    const absolute = path.join(root, relativePath);
    let raw = '';
    try {
        raw = fs.readFileSync(absolute, 'utf8');
    } catch (error) {
        raw = '';
    }

    const { data, content } = parseFrontMatter(raw);
    const headings = extractHeadings(content);
    const firstHeading = headings.find((heading) => heading.level === 1) || headings[0];
    const folder = path.posix.dirname(relativePath);
    const section = folder === '.' ? 'root' : folder.split('/')[0];

    const title = firstString(data.title, firstString(data.sidebar_label, firstHeading && firstHeading.text, titleFromPath(relativePath)));
    const description = firstString(data.description, firstParagraph(content, 220));
    const tags = normalizeTags(data.tags, data.keywords);
    const sidebarPosition = numberOr(Number(data.sidebar_position), Number.MAX_SAFE_INTEGER);
    const text = stripMarkdown(content);

    return {
        path: relativePath,
        title,
        description,
        section,
        folder: folder === '.' ? '' : folder,
        sidebarPosition,
        sidebarLabel: firstString(data.sidebar_label, ''),
        slug: firstString(data.slug, ''),
        tags,
        headings,
        content,
        text,
        chars: content.length,
        search: {
            title: title.toLowerCase(),
            description: description.toLowerCase(),
            section: section.toLowerCase(),
            tags: tags.map((tag) => tag.toLowerCase()),
            headings: headings.map((heading) => heading.text.toLowerCase()),
            body: text.toLowerCase(),
        },
    };
}

/** @param {...unknown} values */
function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

/** @param {number} value @param {number} fallback */
function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Нормализует теги/ключевые слова из front matter в массив строк.
 * @param {unknown} tags
 * @param {unknown} keywords
 * @returns {string[]}
 */
function normalizeTags(tags, keywords) {
    const result = [];
    for (const source of [tags, keywords]) {
        if (Array.isArray(source)) {
            for (const item of source) {
                if (typeof item === 'string' && item.trim()) result.push(item.trim());
            }
        } else if (typeof source === 'string' && source.trim()) {
            for (const item of source.split(/[,;]/)) {
                if (item.trim()) result.push(item.trim());
            }
        }
    }
    return result;
}

/**
 * Порядковый номер раздела для стабильной сортировки.
 * @param {string} section
 * @returns {number}
 */
function sectionRank(section) {
    const index = SECTION_ORDER.indexOf(section);
    return index === -1 ? SECTION_ORDER.length : index;
}

/**
 * Строит индекс документации.
 * @param {{docsRoot: string}} options
 * @returns {object} индекс
 */
export function buildDocsIndex({ docsRoot }) {
    const root = path.resolve(docsRoot);
    let rootExists = false;
    try {
        rootExists = fs.statSync(root).isDirectory();
    } catch {
        rootExists = false;
    }

    /** @type {object[]} */
    const docs = [];
    const error = rootExists ? '' : `Каталог документации не найден: ${root}`;

    if (rootExists) {
        for (const relativePath of walkMarkdown(root)) {
            docs.push(buildDoc(root, relativePath));
        }
    }

    docs.sort((a, b) => {
        const rank = sectionRank(a.section) - sectionRank(b.section);
        if (rank !== 0) return rank;
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        if (a.sidebarPosition !== b.sidebarPosition) return a.sidebarPosition - b.sidebarPosition;
        return a.path.localeCompare(b.path);
    });

    /** @type {Map<string, object>} */
    const byPath = new Map();
    for (const doc of docs) {
        byPath.set(doc.path.toLowerCase(), doc);
    }

    /** @type {{name: string, title: string, count: number}[]} */
    const sections = [];
    for (const doc of docs) {
        let section = sections.find((item) => item.name === doc.section);
        if (!section) {
            section = { name: doc.section, title: doc.section === 'root' ? 'Корень' : humanize(doc.section), count: 0 };
            sections.push(section);
        }
        section.count += 1;
    }

    return {
        root,
        exists: rootExists,
        error,
        docs,
        byPath,
        sections,
        totalChars: docs.reduce((sum, doc) => sum + doc.chars, 0),
        /** @param {string} input @returns {object|undefined} */
        find(input) {
            return findDoc(this, input);
        },
        /** @returns {string} */
        renderIndex() {
            return renderIndexMarkdown(this);
        },
    };
}

/**
 * Ищет документ по относительному пути: нормализует слэши, `./`, проценты,
 * игнорирует регистр. Защищает от выхода за пределы каталога документации.
 * @param {object} index
 * @param {string} input
 * @returns {object|undefined}
 */
export function findDoc(index, input) {
    if (typeof input !== 'string' || !input.trim()) return undefined;

    let candidate = input.trim().replace(/\\/g, '/');
    if (candidate.startsWith('latent-docs://')) candidate = candidate.slice('latent-docs://'.length);
    try {
        candidate = decodeURIComponent(candidate);
    } catch {
        // Некорректный процент-энкодинг — оставляем как есть.
    }
    candidate = candidate.replace(/^\.?\//, '').replace(/\/+/g, '/');

    const segments = candidate.split('/');
    if (segments.some((segment) => segment === '..' || segment === '')) return undefined;

    const direct = index.byPath.get(candidate.toLowerCase());
    if (direct) return direct;

    if (/\.mdx?$/i.test(candidate)) return undefined;
    return index.byPath.get(`${candidate.toLowerCase()}.md`);
}

/**
 * Рендерит ресурс `latent-docs://index` — оглавление в Markdown.
 * @param {object} index
 * @returns {string}
 */
export function renderIndexMarkdown(index) {
    const lines = ['# Индекс документации Latent', ''];

    if (!index.exists) {
        lines.push(`Документация недоступна: ${index.error}`);
        return lines.join('\n');
    }
    if (index.docs.length === 0) {
        lines.push('Документация пока пуста: в каталоге нет Markdown-файлов.');
        return lines.join('\n');
    }

    lines.push(`Всего документов: ${index.docs.length}. Корень: \`${index.root}\`.`, '');

    for (const section of index.sections) {
        lines.push(`## ${section.title} (${section.name})`, '');
        for (const doc of index.docs) {
            if (doc.section !== section.name) continue;
            const description = doc.description ? ` — ${doc.description}` : '';
            lines.push(`- [${doc.title}](latent-docs://${doc.path})${description}`);
        }
        lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
}
