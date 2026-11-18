// tooling/latent-lsp/src/docs.mjs — рендеринг markdown-документации для hover и
// completion из записей language.json и символов документа.
//
// Модуль не ходит в файловую систему: все данные уже загружены в LanguageData.
// Единственная ответственность — единый формат markdown для всех видов записей.

/** Человекочитаемые названия kind'ов builtins. */
const BUILTIN_KIND_LABELS = {
    function: 'встроенная функция',
    method: 'метод',
    property: 'свойство',
    constructor: 'конструктор',
    'host-function': 'host-функция',
    macro: 'макрос',
};

/** Названия kind'ов символов документа. */
export const SYMBOL_KIND_LABELS = {
    fn: 'функция',
    method: 'метод',
    class: 'класс',
    enum: 'enum',
    let: 'переменная',
    variable: 'локальная переменная',
    field: 'поле',
    test: 'тест',
};

/**
 * Ссылка на страницу документации.
 * @param {string|undefined} docsPath
 * @returns {string}
 */
export function docsLink(docsPath) {
    return docsPath ? `[Документация](docs/${docsPath})` : '';
}

/**
 * Markdown для ключевого слова.
 * @param {any} entry — запись из language.json.keywords
 * @returns {string}
 */
export function formatKeywordMarkdown(entry) {
    const soft = entry.soft ? ' · мягкое ключевое слово' : '';
    const lines = [
        `**${entry.name}** — ключевое слово${soft}`,
        '',
        entry.summary,
        '',
        '```latent',
        entry.syntax,
        '```',
        '',
        `Движок: \`${entry.engine}\`${docsLink(entry.docs) ? ' · ' + docsLink(entry.docs) : ''}`,
    ];
    return lines.join('\n');
}

/**
 * Markdown для встроенной функции/метода/конструктора.
 * @param {any} entry — запись из language.json.builtins
 * @param {import('./language-data.mjs').LanguageData} [languageData]
 * @returns {string}
 */
export function formatBuiltinMarkdown(entry, languageData) {
    const kindLabel = BUILTIN_KIND_LABELS[entry.kind] || entry.kind;
    const signatures = (entry.signatures || []).map((s) => `\`${s}\``).join(' · ');
    const hostOnly = entry.engine === 'host' || languageData?.hostOnly?.has(entry.name);
    const lines = [
        `**${entry.name}** — ${kindLabel}`,
        '',
        signatures,
        '',
        entry.summary,
        '',
        '```latent',
        entry.example,
        '```',
    ];
    if (hostOnly) {
        lines.push('', '> Требует host-рантайма движка №1; в движке №2 — ошибка компиляции.');
    }
    lines.push('', `Движок: \`${entry.engine}\`${docsLink(entry.docs) ? ' · ' + docsLink(entry.docs) : ''}`);
    return lines.join('\n');
}

/**
 * Markdown для типа.
 * @param {any} entry — запись из language.json.types
 * @returns {string}
 */
export function formatTypeMarkdown(entry) {
    return [
        `**${entry.name}** — тип (${entry.category})`,
        '',
        `WASM: \`${entry.wasm}\``,
        '',
        entry.summary,
        '',
        '```latent',
        entry.syntax,
        '```',
        '',
        `Движок: \`${entry.engine}\`${docsLink(entry.docs) ? ' · ' + docsLink(entry.docs) : ''}`,
    ].join('\n');
}

/**
 * Markdown для оператора.
 * @param {any} entry — запись из language.json.operators
 * @returns {string}
 */
export function formatOperatorMarkdown(entry) {
    const meta = [entry.kind];
    if (entry.precedence !== undefined) meta.push(`приоритет ${entry.precedence}`);
    if (entry.assoc) meta.push(`ассоциативность ${entry.assoc}`);
    return [
        `**${entry.op}** — ${meta.join(', ')}`,
        '',
        entry.summary,
        '',
        '```latent',
        entry.example,
        '```',
        '',
        `Движок: \`${entry.engine}\`${docsLink(entry.docs) ? ' · ' + docsLink(entry.docs) : ''}`,
    ].join('\n');
}

/**
 * Markdown для символа текущего документа.
 * @param {any} symbol — DocSymbol из analyzer.mjs
 * @param {string} [uri]
 * @returns {string}
 */
export function formatSymbolMarkdown(symbol, uri) {
    const label = SYMBOL_KIND_LABELS[symbol.kind] || symbol.kind;
    const lines = [
        `**${symbol.name}** — ${label} (объявлено в этом файле, строка ${symbol.line + 1})`,
        '',
        '```latent',
        symbol.detail || symbol.name,
        '```',
    ];
    if (uri) lines.push('', `\`${uri}\``);
    return lines.join('\n');
}

/**
 * Текст detail для completion-элемента символа.
 * @param {any} symbol
 * @returns {string}
 */
export function symbolDetail(symbol) {
    const label = SYMBOL_KIND_LABELS[symbol.kind] || symbol.kind;
    return `${label} · ${symbol.detail || symbol.name}`;
}
