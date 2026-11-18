// search.mjs — поиск по индексу документации.
//
// Единственная ответственность: по запросу пользователя отранжировать документы
// и вернуть сниппеты с контекстом. Токенизация регистронезависимая и работает
// с кириллицей; для учёта словоформ используется усечение основы токена и
// поиск по префиксу слова в тексте.
//
// Веса полей: заголовок > description > теги > заголовки разделов > тело.

const STOPWORDS = new Set([
    'и', 'в', 'во', 'на', 'с', 'со', 'по', 'для', 'как', 'что', 'это', 'или',
    'не', 'из', 'к', 'ко', 'о', 'об', 'от', 'до', 'за', 'при', 'а', 'но',
    'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
    'how', 'what', 'with', 'by', 'at', 'it', 'this', 'that',
]);

const FIELD_WEIGHTS = {
    title: 6,
    description: 4,
    tags: 3,
    headings: 2,
    body: 1,
};

/**
 * Разбивает текст на токены: нижний регистр, буквы/цифры/подчёркивание,
 * отбрасывает стоп-слова и односимвольные токены.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
    if (typeof text !== 'string' || !text) return [];
    /** @type {string[]} */
    const tokens = [];
    for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) {
        const token = match[0];
        if (token.length < 2 && !/\d/.test(token)) continue;
        if (STOPWORDS.has(token)) continue;
        tokens.push(token);
    }
    return tokens;
}

/**
 * Уникальные токены запроса и их «основы» для префиксного сравнения.
 * @param {string} query
 * @returns {{terms: {raw: string, stem: string}[]}}
 */
export function queryTerms(query) {
    const seen = new Set();
    const terms = [];
    for (const raw of tokenize(query)) {
        if (seen.has(raw)) continue;
        seen.add(raw);
        terms.push({ raw, stem: stemOf(raw) });
    }
    return { terms };
}

/**
 * Грубая основа слова: у длинных токенов отрезаем 1–2 символа окончания,
 * чтобы «переменная» находила «переменных», «массивы» — «массив».
 * @param {string} token
 * @returns {string}
 */
function stemOf(token) {
    if (token.length <= 4) return token;
    const target = Math.max(4, token.length - 2);
    return token.slice(0, target);
}

/**
 * Считает вхождения подстроки в строку (с ограничением).
 * @param {string} haystack уже в нижнем регистре
 * @param {string} needle уже в нижнем регистре
 * @param {number} cap
 * @returns {number}
 */
function countOccurrences(haystack, needle, cap) {
    if (!needle) return 0;
    let count = 0;
    let position = haystack.indexOf(needle);
    while (position !== -1 && count < cap) {
        count += 1;
        position = haystack.indexOf(needle, position + needle.length);
    }
    return count;
}

/** @param {object} doc @param {'title'|'description'|'tags'|'headings'|'body'} field @param {string} needle */
function fieldIncludes(doc, field, needle) {
    if (!needle) return false;
    if (field === 'tags') return doc.search.tags.some((tag) => tag.includes(needle));
    if (field === 'headings') return doc.search.headings.some((heading) => heading.includes(needle));
    if (field === 'title') return doc.search.title.includes(needle);
    if (field === 'description') return doc.search.description.includes(needle);
    return doc.search.body.includes(needle);
}

/**
 * Вычисляет релевантность документа запросу.
 * @param {object} doc
 * @param {string} phrase нормализованная строка запроса
 * @param {{raw: string, stem: string}[]} terms
 * @returns {number}
 */
function scoreDoc(doc, phrase, terms) {
    let score = 0;

    if (phrase) {
        if (doc.search.title.includes(phrase)) score += 30;
        if (doc.search.description.includes(phrase)) score += 12;
        if (doc.search.headings.some((heading) => heading.includes(phrase))) score += 8;
        if (doc.search.body.includes(phrase)) score += 6;
    }

    for (const term of terms) {
        if (fieldIncludes(doc, 'title', term.stem)) score += FIELD_WEIGHTS.title;
        if (fieldIncludes(doc, 'description', term.stem)) score += FIELD_WEIGHTS.description;
        if (fieldIncludes(doc, 'tags', term.stem)) score += FIELD_WEIGHTS.tags;
        if (fieldIncludes(doc, 'headings', term.stem)) score += FIELD_WEIGHTS.headings;

        const bodyHits = countOccurrences(doc.search.body, term.stem, 5);
        score += bodyHits * FIELD_WEIGHTS.body;
    }

    return score;
}

/**
 * Выбирает место для сниппета и подсвечивает найденные термины `**`.
 * @param {object} doc
 * @param {{raw: string, stem: string}[]} terms
 * @param {number} width
 * @returns {string}
 */
export function buildSnippet(doc, terms, width = 220) {
    const source = doc.content || doc.text;
    const lower = source.toLowerCase();

    let position = -1;
    let matched = '';

    for (const term of terms) {
        for (const candidate of [term.raw, term.stem]) {
            const found = lower.indexOf(candidate);
            if (found !== -1 && (position === -1 || found < position)) {
                position = found;
                matched = candidate;
            }
        }
        if (position !== -1) break;
    }

    const start = position === -1 ? 0 : Math.max(0, position - Math.floor(width / 3));
    const end = Math.min(source.length, start + width);
    let snippet = source.slice(start, end);

    snippet = snippet
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[#>*`|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!matched) {
        return `${start > 0 ? '…' : ''}${snippet}${end < source.length ? '…' : ''}`;
    }

    const marker = matched.slice(0, Math.max(4, matched.length - 2));
    snippet = highlight(snippet, marker);
    return `${start > 0 ? '…' : ''}${snippet}${end < source.length ? '…' : ''}`;
}

/**
 * Подсвечивает первое вхождение термина (регистронезависимо).
 * @param {string} text
 * @param {string} term
 * @returns {string}
 */
function highlight(text, term) {
    if (!term) return text;
    const lower = text.toLowerCase();
    const found = lower.indexOf(term);
    if (found === -1) return text;
    return `${text.slice(0, found)}**${text.slice(found, found + term.length)}**${text.slice(found + term.length)}`;
}

/**
 * Ищет документы по запросу.
 * @param {object} index
 * @param {string} query
 * @param {{limit?: number}} [options]
 * @returns {{path: string, title: string, score: number, snippet: string}[]}
 */
export function searchDocs(index, query, options = {}) {
    const limit = clampLimit(options.limit);
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed || !index.exists || index.docs.length === 0) return [];

    const phrase = trimmed.toLowerCase().replace(/\s+/g, ' ');
    const { terms } = queryTerms(trimmed);

    const scored = [];
    for (const doc of index.docs) {
        const score = scoreDoc(doc, phrase, terms);
        if (score <= 0) continue;
        scored.push({ doc, score });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.doc.path.localeCompare(b.doc.path);
    });

    return scored.slice(0, limit).map(({ doc, score }) => ({
        path: doc.path,
        title: doc.title,
        score: Math.round(score * 100) / 100,
        snippet: buildSnippet(doc, terms),
    }));
}

/**
 * Приводит limit к безопасному диапазону.
 * @param {unknown} value
 * @returns {number}
 */
export function clampLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(50, Math.max(1, Math.trunc(parsed)));
}
