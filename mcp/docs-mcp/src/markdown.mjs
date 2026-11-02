// markdown.mjs — минимальный разбор Markdown без внешних зависимостей.
//
// Единственная ответственность: превратить исходник страницы в структурированные
// поля (front matter, заголовки, «плоский» текст) для индекса и поиска.
// Поддерживается подмножество YAML, которое реально встречается в docs/docs:
// скаляры в кавычках и без, списки, многострочные значения `|` и `>`.

/** Убирает BOM и приводит переводы строк к `\n`. */
export function normalizeText(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/**
 * Разбирает YAML-подобный блок front matter.
 * @param {string[]} lines строки между разделителями `---`
 * @returns {Record<string, unknown>}
 */
function parseYamlLike(lines) {
    /** @type {Record<string, unknown>} */
    const data = {};
    let currentKey = null;
    let blockMode = false;

    for (const rawLine of lines) {
        const line = rawLine.replace(/\t/g, '  ');
        if (!line.trim() || line.trim().startsWith('#')) continue;

        // Элемент списка: `- значение`.
        const listItem = line.match(/^\s*-\s+(.+)$/);
        if (listItem && currentKey) {
            const value = parseScalar(listItem[1]);
            if (!Array.isArray(data[currentKey])) {
                data[currentKey] = data[currentKey] ? [data[currentKey]] : [];
            }
            /** @type {unknown[]} */ (data[currentKey]).push(value);
            blockMode = false;
            continue;
        }

        const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (keyValue) {
            currentKey = keyValue[1].toLowerCase();
            const rest = keyValue[2].trim();
            if (rest === '') {
                // Может оказаться списком или многострочным текстом — решим по следующим строкам.
                data[currentKey] = [];
                blockMode = true;
            } else if (rest === '|' || rest === '>') {
                data[currentKey] = '';
                blockMode = true;
            } else {
                data[currentKey] = parseScalar(rest);
                blockMode = false;
            }
            continue;
        }

        // Продолжение многострочного значения с отступом.
        if (currentKey && blockMode) {
            const piece = line.trim();
            if (typeof data[currentKey] === 'string') {
                data[currentKey] = data[currentKey] ? `${data[currentKey]}\n${piece}` : piece;
            } else if (Array.isArray(data[currentKey]) && data[currentKey].length === 0) {
                data[currentKey] = piece;
            }
        }
    }

    return data;
}

/**
 * Разбирает скалярное значение YAML: строка, число, boolean, null, список.
 * @param {string} raw
 * @returns {unknown}
 */
function parseScalar(raw) {
    const value = raw.trim();

    if (value === '') return '';
    if (value === 'null' || value === '~') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        try {
            return JSON.parse(value);
        } catch {
            return value.slice(1, -1).replace(/\\"/g, '"');
        }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(',').map((part) => parseScalar(part));
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
}

/**
 * Отделяет front matter от тела страницы.
 * @param {string} raw исходный Markdown
 * @returns {{data: Record<string, unknown>, content: string}}
 */
export function parseFrontMatter(raw) {
    const source = normalizeText(raw);
    if (!source.startsWith('---')) return { data: {}, content: source };

    const lines = source.split('\n');
    if (lines[0].trim() !== '---') return { data: {}, content: source };

    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (trimmed === '---' || trimmed === '...') {
            end = i;
            break;
        }
    }
    if (end === -1) return { data: {}, content: source };

    const data = parseYamlLike(lines.slice(1, end));
    const content = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
    return { data, content };
}

/**
 * Убирает инлайновую Markdown-разметку из строки (для заголовков).
 * @param {string} text
 * @returns {string}
 */
export function stripInline(text) {
    return String(text)
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Извлекает заголовки Markdown, пропуская содержимое fenced-блоков кода.
 * @param {string} markdown тело страницы (без front matter)
 * @returns {{level: number, text: string, line: number}[]}
 */
export function extractHeadings(markdown) {
    const headings = [];
    let fence = null;
    const lines = normalizeText(markdown).split('\n');

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const fenceMatch = line.match(/^\s*(```+|~~~+)/);
        if (fenceMatch) {
            if (fence === null) fence = fenceMatch[1][0];
            else if (fenceMatch[1][0] === fence) fence = null;
            continue;
        }
        if (fence !== null) continue;

        const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (heading) {
            const text = stripInline(heading[2]);
            if (text) headings.push({ level: heading[1].length, text, line: i + 1 });
        }
    }
    return headings;
}

/**
 * Превращает Markdown в плоский текст для поиска и сниппетов.
 * @param {string} markdown
 * @returns {string}
 */
export function stripMarkdown(markdown) {
    let text = normalizeText(markdown);

    // Убираем маркеры fenced-блоков, оставляя содержимое.
    text = text.replace(/^\s*(```+|~~~+).*$/gm, ' ');
    text = text.replace(/^\s*(?:>\s?)+/gm, ' ');
    text = text.replace(/^\s*#{1,6}\s+/gm, ' ');
    text = text.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ');
    text = text.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, ' ');
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/`([^`]*)`/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\|/g, ' ');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{2,}/g, '\n');
    return text.trim();
}

/**
 * Возвращает первый содержательный абзац — запасной источник для `description`.
 * @param {string} markdown тело страницы
 * @param {number} [maxLength] максимальная длина результата
 * @returns {string}
 */
export function firstParagraph(markdown, maxLength = 200) {
    const lines = normalizeText(markdown).split('\n');
    const paragraph = [];
    let started = false;
    let fence = false;

    for (const line of lines) {
        if (/^\s*(```+|~~~+)/.test(line)) {
            if (!fence) {
                if (started && paragraph.length) break;
                fence = true;
                continue;
            }
            fence = false;
            continue;
        }
        if (fence) continue;

        const trimmed = line.trim();
        if (!started) {
            if (!trimmed) continue;
            if (/^(#{1,6})\s/.test(trimmed)) continue;
            if (/^(\||<|!\[|```)/.test(trimmed)) continue;
            if (/^(:{2,}|import\s|export\s)/.test(trimmed)) continue;
            started = true;
        }
        if (!trimmed) break;
        paragraph.push(trimmed);
    }

    const text = stripMarkdown(paragraph.join(' '));
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
