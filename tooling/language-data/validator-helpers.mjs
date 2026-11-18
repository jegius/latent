// tooling/language-data/validator-helpers.mjs — общие константы и проверки
// валидатора language.json (значения engine, пути документации, форматы).

/** Допустимые значения поля `engine`. */
export const ENGINES = ['rust', 'js', 'both', 'host'];

/** Известные разделы сайта документации (docs/docs/*). */
export const DOC_SECTIONS = [
    'intro',
    'getting-started',
    'tutorial',
    'guide',
    'reference',
    'specs',
    'tooling',
    'examples',
];

/** Путь к странице документации: раздел/страница[#якорь]. */
export const DOC_PATH_RE = /^(intro|getting-started|tutorial|guide|reference|specs|tooling|examples)\/[a-z0-9-]+(#[a-z0-9_-]+)?$/;

/** Код диагностики: LEX_*, PARSE_*, TYPE_*, GEN_*. */
export const CODE_RE = /^(LEX|PARSE|TYPE|GEN)_[A-Z0-9_]+$/;

/** Версия файла данных. */
export const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Проверяет поле engine.
 * @param {string} where
 * @param {any} entry
 * @param {(message: string) => void} onError
 */
export function checkEngine(where, entry, onError) {
    if (!ENGINES.includes(entry.engine)) {
        onError(`${where} (${entry.name || entry.op || entry.code}).engine: ожидается ${ENGINES.join('|')}`);
    }
}

/**
 * Проверяет путь к документации.
 * @param {string} where
 * @param {any} entry
 * @param {(message: string) => void} onError
 */
export function checkDocs(where, entry, onError) {
    if (typeof entry.docs !== 'string' || !DOC_PATH_RE.test(entry.docs)) {
        onError(`${where} (${entry.name || entry.op || entry.code}).docs: ожидается путь вида reference/builtins`);
    }
}

/**
 * @param {any} value
 * @param {number} min
 * @returns {boolean}
 */
export function isNonEmptyString(value, min = 1) {
    return typeof value === 'string' && value.length >= min;
}
