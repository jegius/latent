// reference.mjs — агрегация справочника reference/* для get_language_reference.
//
// Единственная ответственность: по канонической теме (grammar/types/operators/
// builtins/errors/abi/all) найти страницы раздела reference и собрать их в один
// Markdown-документ. Имена файлов в документации могут отличаться от темы
// (например, тема `abi` живёт в `reference/wasm-abi.md`), поэтому поиск идёт
// по точному префиксу, затем по синонимам, затем по вхождению в метаданные.

/** Синонимы тем справочника. */
const REFERENCE_ALIASES = {
    grammar: ['grammar', 'syntax', 'синтаксис'],
    types: ['types', 'типы'],
    operators: ['operators', 'операторы'],
    builtins: ['builtins', 'builtin', 'встроенные'],
    errors: ['errors', 'error', 'diagnostics', 'ошибки', 'диагностика'],
    abi: ['wasm-abi', 'abi', 'wasm', 'aби'],
    all: [],
};

/**
 * Документы справочника для темы.
 * @param {object} index
 * @param {string} topic
 * @returns {object[]}
 */
export function findReferenceDocs(index, topic) {
    if (topic === 'all') {
        return index.docs.filter((doc) => doc.path.toLowerCase().startsWith('reference/'));
    }

    const reference = index.docs.filter((doc) => doc.path.toLowerCase().startsWith('reference/'));
    const aliases = [topic, ...(REFERENCE_ALIASES[topic] || [])].map((alias) => alias.toLowerCase());

    /** @type {object[]} */
    const found = [];
    const seen = new Set();
    const add = (doc) => {
        if (seen.has(doc.path)) return;
        seen.add(doc.path);
        found.push(doc);
    };

    // 1. Точное имя файла по канонической теме: reference/<topic>.md
    for (const doc of reference) {
        if (doc.path.toLowerCase().startsWith(`reference/${topic}`)) add(doc);
    }
    if (found.length > 0) return found;

    // 2. Синонимы: префикс пути (reference/wasm-abi...).
    for (const alias of aliases) {
        for (const doc of reference) {
            if (doc.path.toLowerCase().startsWith(`reference/${alias}`)) add(doc);
        }
    }
    if (found.length > 0) return found;

    // 3. Вхождение синонима в путь/заголовок/описание/теги.
    for (const doc of reference) {
        const haystack = `${doc.path} ${doc.title} ${doc.description} ${doc.tags.join(' ')}`.toLowerCase();
        if (aliases.some((alias) => alias.length >= 2 && haystack.includes(alias))) add(doc);
    }

    return found;
}

/**
 * Собирает агрегированный Markdown справочника.
 * @param {string} topic
 * @param {object[]} docs
 * @param {object} index
 * @returns {string}
 */
export function renderReference(topic, docs, index) {
    const header = [
        '# Справочник по языку Latent',
        '',
        `Тема: \`${topic}\`. Страниц: ${docs.length}. Источник: \`${index.root}\`.`,
        '',
        'Ниже — страницы справочника в порядке навигации. Используйте `read_doc` для полного текста отдельной страницы.',
    ];
    const parts = docs.map((doc) => `<!-- ${doc.path} -->\n\n${doc.content.trim()}`);
    return `${header.join('\n')}\n\n${parts.join('\n\n---\n\n')}\n`;
}

/**
 * Сообщение, если справочник по теме ещё не написан (документация неполная).
 * @param {object} index
 * @param {string} topic
 * @returns {string}
 */
export function missingReferenceReport(index, topic) {
    const referencePaths = index.docs
        .filter((doc) => doc.path.toLowerCase().startsWith('reference/'))
        .map((doc) => `- \`${doc.path}\` — ${doc.title}`);

    const lines = [
        '# Справочник по языку Latent',
        '',
        `Раздел «${topic}» пока не найден в документации.`,
    ];
    if (!index.exists) {
        lines.push('', `Каталог документации недоступен: ${index.error}`);
        return lines.join('\n');
    }
    if (referencePaths.length > 0) {
        lines.push('', 'Доступные страницы справочника:', '', ...referencePaths);
    } else {
        lines.push('', 'Раздел reference/ пока пуст. Используйте `search_docs` и `list_docs`.');
    }
    return lines.join('\n');
}
