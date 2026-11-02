// tools.mjs — реализация MCP-инструментов документации.
//
// Единственная ответственность: валидировать аргументы и выполнять операции
// над уже построенным индексом, компилятором и каталогом примеров. Возвращает
// пару {text, structured} — транспорт сам решает, как упаковать её в MCP-ответ.
//
// Ошибки двух видов:
//   * RpcError(-32602) — неверные аргументы вызова (вина клиента);
//   * ToolError — ошибка выполнения инструмента (показывается как isError).

import { invalidParams } from './jsonrpc.mjs';
import { searchDocs } from './search.mjs';
import { REFERENCE_TOPICS } from './tool-defs.mjs';
import { findReferenceDocs, missingReferenceReport, renderReference } from './reference.mjs';

export { TOOLS } from './tool-defs.mjs';

/** Ошибка выполнения инструмента (MCP: result.isError = true). */
export class ToolError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolError';
    }
}

/**
 * Проверяет, что аргументы — объект (или отсутствуют).
 * @param {unknown} args
 * @returns {Record<string, unknown>}
 */
function ensureObject(args) {
    if (args === undefined || args === null) return {};
    if (typeof args !== 'object' || Array.isArray(args)) {
        throw invalidParams('Аргументы инструмента должны быть JSON-объектом');
    }
    return /** @type {Record<string, unknown>} */ (args);
}

/**
 * Требует непустую строку в аргументах.
 * @param {Record<string, unknown>} args
 * @param {string} name
 * @returns {string}
 */
function requireString(args, name) {
    const value = args[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw invalidParams(`Параметр «${name}» обязателен и должен быть непустой строкой`);
    }
    return value;
}

/**
 * Необязательная строка.
 * @param {Record<string, unknown>} args
 * @param {string} name
 * @returns {string}
 */
function optionalString(args, name) {
    const value = args[name];
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw invalidParams(`Параметр «${name}» должен быть строкой`);
    return value;
}

/**
 * Необязательный limit в диапазоне 1..50.
 * @param {Record<string, unknown>} args
 * @returns {number}
 */
function optionalLimit(args) {
    const value = args.limit;
    if (value === undefined || value === null) return 10;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
        throw invalidParams('Параметр «limit» должен быть целым числом от 1 до 50');
    }
    return value;
}

/**
 * Человекочитаемый JSON — для content[].text.
 * @param {unknown} value
 * @returns {string}
 */
function json(value) {
    return JSON.stringify(value, null, 2);
}

/**
 * Создаёт обработчики инструментов для конкретного сервера.
 * @param {{index: object, examples: object, compiler: object}} ctx
 * @returns {{call: (name: string, args: unknown) => Promise<{text: string, structured: object}>, names: string[]}}
 */
export function createToolHandlers(ctx) {
    const { index, examples, compiler } = ctx;

    /** @type {Record<string, (args: Record<string, unknown>) => Promise<{text: string, structured: object}>|{text: string, structured: object}>} */
    const handlers = {
        /** @param {Record<string, unknown>} args */
        async list_docs() {
            const docs = index.docs.map((doc) => ({
                path: doc.path,
                title: doc.title,
                description: doc.description,
                section: doc.section,
            }));
            const text = docs.length === 0
                ? `Документация пуста или недоступна. ${index.error || `Каталог: ${index.root}`}`
                : json({ docs });
            return { text, structured: { docs } };
        },

        /** @param {Record<string, unknown>} args */
        async search_docs(args) {
            const query = requireString(args, 'query');
            const limit = optionalLimit(args);
            const results = searchDocs(index, query, { limit });
            const lines = results.length === 0
                ? [`По запросу «${query}» ничего не найдено. Попробуйте другие слова или вызовите list_docs.`]
                : [
                    `Найдено результатов: ${results.length} (запрос «${query}»).`,
                    '',
                    ...results.map((result, position) => (
                        `${position + 1}. **${result.title}** — \`${result.path}\` (score ${result.score})\n   ${result.snippet}`
                    )),
                ];
            return { text: lines.join('\n'), structured: { results } };
        },

        /** @param {Record<string, unknown>} args */
        async read_doc(args) {
            const requested = requireString(args, 'path');
            const doc = index.find(requested);
            if (!doc) {
                const suggestions = searchDocs(index, requested.replace(/\.mdx?$/i, ''), { limit: 3 })
                    .map((item) => item.path);
                const hint = suggestions.length > 0
                    ? ` Возможно, вы имели в виду: ${suggestions.map((path) => `\`${path}\``).join(', ')}.`
                    : ' Список всех страниц: list_docs.';
                throw new ToolError(`Документ не найден: ${requested}.${hint}`);
            }
            return {
                text: doc.content,
                structured: { path: doc.path, title: doc.title, content: doc.content },
            };
        },

        /** @param {Record<string, unknown>} args */
        async get_language_reference(args) {
            const topic = (optionalString(args, 'topic') || 'all').trim().toLowerCase();
            if (!REFERENCE_TOPICS.includes(topic)) {
                throw invalidParams(`Неизвестная тема «${topic}». Допустимо: ${REFERENCE_TOPICS.join(', ')}`);
            }

            const matches = findReferenceDocs(index, topic);
            if (matches.length === 0) {
                const content = missingReferenceReport(index, topic);
                return { text: content, structured: { topic, content } };
            }

            const content = renderReference(topic, matches, index);
            return { text: content, structured: { topic, content } };
        },

        /** @param {Record<string, unknown>} args */
        async get_example(args) {
            const id = optionalString(args, 'id').trim();
            const all = await examples.list();

            if (!id) {
                if (all.length === 0) {
                    throw new ToolError('Примеры не найдены: каталог web-ide/examples недоступен.');
                }
                const lines = ['# Примеры языка Latent', '', ...all.map((item) => (
                    `- \`${item.id}\` — ${item.title}${item.description ? `: ${item.description}` : ''} (${item.group})`
                )), '', 'Вызовите `get_example { id }`, чтобы получить полный код.'];
                return {
                    text: lines.join('\n'),
                    structured: {
                        examples: all.map((item) => ({
                            id: item.id,
                            title: item.title,
                            description: item.description,
                            group: item.group,
                        })),
                    },
                };
            }

            const example = await examples.get(id);
            if (!example) {
                const available = all.slice(0, 30).map((item) => item.id).join(', ');
                throw new ToolError(`Пример «${id}» не найден. Доступные id: ${available || '(нет)'}.`);
            }

            return {
                text: `# ${example.title}\n\nid: \`${example.id}\`\n\n\`\`\`latent\n${example.code}\n\`\`\`\n`,
                structured: { id: example.id, title: example.title, code: example.code },
            };
        },

        /** @param {Record<string, unknown>} args */
        async check_code(args) {
            const code = requireString(args, 'code');
            let result;
            try {
                result = await compiler.check(code);
            } catch (error) {
                throw new ToolError(error && error.message ? error.message : String(error));
            }

            if (result.ok) {
                return {
                    text: 'Компиляция успешна: ошибок нет.',
                    structured: { ok: true, errors: [] },
                };
            }

            const lines = [
                `Компиляция не удалась: ошибок ${result.errors.length}.`,
                '',
                ...result.errors.map((item, position) => {
                    const where = item.line === null ? 'без локации' : `строка ${item.line}:${item.column}`;
                    return `${position + 1}. [${where}] ${item.message}`;
                }),
            ];
            return {
                text: lines.join('\n'),
                structured: { ok: false, errors: result.errors },
            };
        },
    };

    const names = Object.keys(handlers);

    /**
     * Вызывает инструмент по имени.
     * @param {string} name
     * @param {unknown} rawArgs
     * @returns {Promise<{text: string, structured: object}>}
     */
    async function call(name, rawArgs) {
        if (typeof name !== 'string' || !name) {
            throw invalidParams('Поле «name» инструмента обязательно');
        }
        const handler = handlers[name];
        if (!handler) {
            throw invalidParams(`Неизвестный инструмент «${name}». Доступно: ${names.join(', ')}`, {
                tools: names,
            });
        }
        const args = ensureObject(rawArgs);
        return handler(args);
    }

    return { call, names };
}
