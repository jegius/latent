// examples.mjs — каталог примеров языка для инструмента `get_example`.
//
// Единственная ответственность: собрать примеры из двух источников:
//   1) `web-ide/examples/*.lat` + метаданные `manifest.js` (id/title/description);
//   2) `docs/docs/examples/**/*.md` — первый блок ```latent каждой страницы.
//
// Загрузка ленивая и не падает, если метаданные или каталоги отсутствуют:
// тогда id и заголовок выводятся из имени файла.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Человекочитаемое имя из имени файла.
 * @param {string} name
 * @returns {string}
 */
function humanize(name) {
    return name
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}

/**
 * Читает метаданные примеров из web-ide/examples/manifest.js.
 * @param {string} examplesDir
 * @returns {Promise<{meta: object[], order: Map<string, number>}>}
 */
async function loadManifest(examplesDir) {
    const manifestPath = path.join(examplesDir, 'manifest.js');
    const meta = [];
    const order = new Map();

    if (!fs.existsSync(manifestPath)) return { meta, order };

    try {
        const module = await import(pathToFileURL(manifestPath).href);
        const list = Array.isArray(module.EXAMPLE_META) ? module.EXAMPLE_META : [];
        for (let index = 0; index < list.length; index += 1) {
            const item = list[index];
            if (!item || typeof item !== 'object' || !item.file) continue;
            meta.push({
                id: typeof item.id === 'string' && item.id ? item.id : item.file.replace(/\.lat$/, ''),
                file: item.file,
                title: typeof item.title === 'string' ? item.title : '',
                description: typeof item.description === 'string' ? item.description : '',
                group: typeof item.group === 'string' ? item.group : '',
            });
            order.set(item.file, index);
        }
    } catch {
        // manifest.js недоступен или сломан — работаем без метаданных.
    }
    return { meta, order };
}

/**
 * Собирает примеры из web-ide/examples.
 * @param {string} examplesDir
 * @returns {Promise<object[]>}
 */
async function loadWebIdeExamples(examplesDir) {
    let entries;
    try {
        entries = fs.readdirSync(examplesDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const { meta, order } = await loadManifest(examplesDir);
    const metaByFile = new Map(meta.map((item) => [item.file, item]));
    const examples = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.lat')) continue;
        let code = '';
        try {
            code = fs.readFileSync(path.join(examplesDir, entry.name), 'utf8');
        } catch {
            continue;
        }
        const info = metaByFile.get(entry.name);
        examples.push({
            id: info ? info.id : entry.name.replace(/\.lat$/, '').replace(/_/g, '-'),
            file: entry.name,
            title: info && info.title ? info.title : humanize(entry.name.replace(/\.lat$/, '')),
            description: info && info.description ? info.description : '',
            group: info && info.group ? info.group : 'Examples',
            source: 'web-ide/examples',
            code,
            order: order.has(entry.name) ? order.get(entry.name) : Number.MAX_SAFE_INTEGER,
        });
    }

    examples.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return examples;
}

/**
 * Извлекает первый fenced-блок ```latent из Markdown.
 * @param {string} markdown
 * @returns {string}
 */
function extractLatentBlock(markdown) {
    const match = String(markdown).match(/```(?:latent|lat)\s*\n([\s\S]*?)```/i);
    return match ? match[1].replace(/\s+$/, '') : '';
}

/**
 * Извлекает заголовок из front matter или первого H1/H2 страницы.
 * @param {string} markdown
 * @param {string} fallback
 * @returns {string}
 */
function extractTitle(markdown, fallback) {
    const front = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (front) {
        const title = front[1].match(/^title:\s*(.+)$/m);
        if (title) {
            const value = title[1].trim().replace(/^["']|["']$/g, '');
            if (value) return value;
        }
    }
    const heading = String(markdown).match(/^#{1,2}\s+(.+)$/m);
    if (heading) return heading[1].replace(/[#*_`]/g, '').trim();
    return fallback;
}

/**
 * Собирает примеры из docs/docs/examples (по первому ```latent-блоку).
 * @param {string} docsRoot
 * @returns {object[]}
 */
function loadDocsExamples(docsRoot) {
    const examplesDir = path.join(docsRoot, 'examples');
    let entries;
    try {
        entries = fs.readdirSync(examplesDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const found = [];
    for (const entry of entries) {
        if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
        let markdown = '';
        try {
            markdown = fs.readFileSync(path.join(examplesDir, entry.name), 'utf8');
        } catch {
            continue;
        }
        const code = extractLatentBlock(markdown);
        if (!code) continue;
        const id = entry.name.replace(/\.mdx?$/i, '').replace(/_/g, '-').toLowerCase();
        found.push({
            id,
            file: entry.name,
            title: extractTitle(markdown, humanize(entry.name.replace(/\.mdx?$/i, ''))),
            description: '',
            group: 'docs/examples',
            source: `docs/examples/${entry.name}`,
            code,
            order: Number.MAX_SAFE_INTEGER,
        });
    }

    found.sort((a, b) => a.id.localeCompare(b.id));
    return found;
}

/**
 * Создаёт ленивый провайдер примеров.
 * @param {{repoRoot: string, docsRoot: string}} options
 * @returns {{load: () => Promise<object[]>, list: () => Promise<object[]>, get: (id: string) => Promise<object|null>}}
 */
export function createExamplesProvider({ repoRoot, docsRoot }) {
    /** @type {Promise<object[]>|null} */
    let pending = null;

    /** @returns {Promise<object[]>} */
    function load() {
        if (!pending) {
            const examplesDir = path.join(repoRoot, 'web-ide', 'examples');
            pending = loadWebIdeExamples(examplesDir)
                .then((webIde) => {
                    const docs = loadDocsExamples(docsRoot);
                    const seen = new Set(webIde.map((item) => item.id.toLowerCase()));
                    const merged = [...webIde];
                    for (const item of docs) {
                        if (seen.has(item.id.toLowerCase())) continue;
                        seen.add(item.id.toLowerCase());
                        merged.push(item);
                    }
                    return merged;
                })
                .catch(() => []);
        }
        return pending;
    }

    /**
     * Ищет пример по id, имени файла или заголовку (без учёта регистра).
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async function get(id) {
        const all = await load();
        const needle = String(id || '').trim().toLowerCase().replace(/\.lat$/, '');
        if (!needle) return null;
        return (
            all.find((item) => item.id.toLowerCase() === needle)
            || all.find((item) => item.file.toLowerCase() === `${needle}.lat` || item.file.toLowerCase() === needle)
            || all.find((item) => item.title.toLowerCase() === needle)
            || all.find((item) => item.title.toLowerCase().includes(needle))
            || null
        );
    }

    async function list() {
        return load();
    }

    return { load, list, get };
}
