// prompts.mjs — MCP-промпты для работы с языком Latent.
//
// Единственная ответственность: отдать список шаблонов prompts/list и собрать
// конкретный prompt по аргументам prompts/get. Шаблоны не статичны: в них
// подставляются выдержки из реальной документации (поиск по индексу) и
// подсказки, какие tools/resources использовать.

import { searchDocs } from './search.mjs';

/** Максимальная длина одной выдержки из документа. */
const EXCERPT_CHARS = 1400;

/** Максимальный суммарный объём выдержек в одном prompt. */
const EXCERPTS_TOTAL = 4200;

/** Описания промптов для prompts/list. */
export function buildPromptList() {
    return {
        prompts: [
            {
                name: 'explain_syntax',
                title: 'Объяснить синтаксис Latent',
                description: 'Объясняет конструкцию или тему языка Latent с опорой на документацию и примерами кода.',
                arguments: [
                    {
                        name: 'topic',
                        description: 'Что объяснить: например «каналы и spawn», «match», «типы массивов», «замыкания».',
                        required: true,
                    },
                ],
            },
            {
                name: 'write_program',
                title: 'Написать программу на Latent',
                description: 'Пишет программу на Latent под задачу пользователя, используя документацию и готовые примеры.',
                arguments: [
                    {
                        name: 'task',
                        description: 'Что должна делать программа (входные данные, результат).',
                        required: true,
                    },
                    {
                        name: 'constraints',
                        description: 'Ограничения: движок (№1/№2), стиль, запрещённые конструкции.',
                        required: false,
                    },
                ],
            },
            {
                name: 'debug_program',
                title: 'Отладить программу на Latent',
                description: 'Ищет причину ошибки в коде Latent, опираясь на сообщения компилятора и документацию.',
                arguments: [
                    {
                        name: 'code',
                        description: 'Исходный код Latent, который не компилируется или работает неверно.',
                        required: true,
                    },
                    {
                        name: 'error',
                        description: 'Текст ошибки/поведение (если есть).',
                        required: false,
                    },
                ],
            },
        ],
    };
}

/**
 * Возвращает имя первого документа справочника по префиксу пути.
 * @param {object} index
 * @param {string} prefix например 'reference/errors'
 * @returns {object|undefined}
 */
function findReferenceDoc(index, prefix) {
    return index.docs.find((doc) => doc.path.toLowerCase().startsWith(prefix));
}

/**
 * Достаёт выдержки из документов, релевантных запросу.
 * @param {object} index
 * @param {string} query
 * @param {{limit?: number, perDoc?: number, total?: number}} [options]
 * @returns {string}
 */
function relevantExcerpts(index, query, options = {}) {
    const limit = options.limit || 3;
    const perDoc = options.perDoc || EXCERPT_CHARS;
    const total = options.total || EXCERPTS_TOTAL;
    const results = searchDocs(index, query, { limit });

    /** @type {string[]} */
    const blocks = [];
    let used = 0;

    for (const result of results) {
        const doc = index.find(result.path);
        if (!doc) continue;
        let body = doc.content.trim();
        if (body.length > perDoc) body = `${body.slice(0, perDoc).trimEnd()}\n…`;
        const block = `### ${doc.title} (\`${doc.path}\`)\n\n${body}`;
        if (used + block.length > total) break;
        blocks.push(block);
        used += block.length;
    }

    if (blocks.length === 0) {
        return 'Релевантных страниц в документации не найдено — используйте `list_docs` или `search_docs`.';
    }
    return blocks.join('\n\n');
}

/**
 * Краткое перечисление доступных разделов документации.
 * @param {object} index
 * @returns {string}
 */
function docsOverview(index) {
    if (!index.exists) return `Документация недоступна: ${index.error}`;
    if (index.docs.length === 0) return 'Документация пока пуста.';
    const sections = index.sections.map((section) => `${section.title} (${section.count})`).join(', ');
    return `Всего страниц: ${index.docs.length}. Разделы: ${sections}.`;
}

/**
 * Список примеров для подсказки (id + title).
 * @param {object[]} examples
 * @returns {string}
 */
function examplesHint(examples) {
    if (!Array.isArray(examples) || examples.length === 0) return '';
    const items = examples.slice(0, 12).map((item) => `- \`${item.id}\` — ${item.title}`);
    return `\n\n## Готовые примеры\n\nВыберите подходящий и запросите код инструментом \`get_example\`:\n\n${items.join('\n')}`;
}

/**
 * Собирает prompt по имени и аргументам.
 * @param {{index: object, examples?: object}} ctx
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<{description: string, messages: object[]}|null>} null — неизвестный prompt
 */
export async function getPrompt(ctx, name, args = {}) {
    const index = ctx.index;
    const argumentsObject = args && typeof args === 'object' ? args : {};

    switch (name) {
        case 'explain_syntax': {
            const topic = String(argumentsObject.topic || '').trim();
            const excerpts = relevantExcerpts(index, topic, { limit: 3 });
            const text = [
                'Ты — эксперт по языку программирования Latent (AI-native язык со статической типизацией, компилируемый в WebAssembly).',
                '',
                `Задача: подробно и точно объяснить конструкцию/тему «${topic}».`,
                '',
                '## Как отвечать',
                '1. Дай краткое определение в 1–2 предложениях.',
                '2. Покажи синтаксис (EBNF или краткая форма) и минимальный рабочий пример на Latent.',
                '3. Разбери семантику: типы, правила вывода типов, ограничения, отличия движков №1 (JS-интерпретатор) и №2 (Rust→WASM), если они есть.',
                '4. Перечисли типичные ошибки и способы их избежать.',
                '5. В конце — ссылки на страницы документации вида `latent-docs://<path>`.',
                '',
                'Не выдумывай конструкции, которых нет в выдержках ниже. Если информации не хватает — честно скажи и предложи вызвать `get_language_reference` / `search_docs`.',
                '',
                '## Выдержки из документации',
                '',
                excerpts,
                '',
                '## Доступные инструменты',
                '- `get_language_reference { topic }` — агрегированный справочник (grammar/types/operators/builtins/errors/abi).',
                '- `get_example { id }` — полный код примера.',
                '- `search_docs { query }` — найти нужные страницы.',
                '- `read_doc { path }` — прочитать страницу целиком.',
                '',
                docsOverview(index),
            ].join('\n');

            return {
                description: `Объяснение конструкции Latent: ${topic}`,
                messages: [{ role: 'user', content: { type: 'text', text } }],
            };
        }

        case 'write_program': {
            const task = String(argumentsObject.task || '').trim();
            const constraints = String(argumentsObject.constraints || '').trim();
            const examples = ctx.examples ? await ctx.examples.list() : [];
            const excerpts = relevantExcerpts(index, `${task} примеры типы функции`, { limit: 3 });
            const reference = findReferenceDoc(index, 'reference/');
            const text = [
                'Ты — инженер по языку Latent (AI-native язык со статической типизацией, компилируемый в WebAssembly).',
                '',
                `Задача пользователя: ${task}`,
                constraints ? `\nОграничения: ${constraints}` : '',
                '',
                '## Требования к ответу',
                '1. Сначала коротко опиши план решения (2–4 пункта).',
                '2. Затем — полный компилируемый файл на Latent в одном блоке ```latent.',
                '3. Используй только конструкции, подтверждённые выдержками ниже; не изобретай API.',
                '4. Предусмотри `fn main() -> int { ... }`, если программа исполняемая.',
                '5. В конце перечисли, что проверено и как запустить (CLI или playground).',
                '',
                'Проверить синтаксис можно инструментом `check_code { code }` — он компилирует исходник Rust-компилятором (WASM) и возвращает ошибки со строкой и колонкой.',
                '',
                '## Выдержки из документации',
                '',
                excerpts,
                '',
                reference ? `## Справочник\n\nНачните с \`${reference.path}\` (\`read_doc\`), при необходимости — \`get_language_reference { topic: "all" }\`.` : '',
                examplesHint(examples),
                '',
                docsOverview(index),
            ]
                .filter((line) => line !== '')
                .join('\n');

            return {
                description: `Программа на Latent: ${task}`,
                messages: [{ role: 'user', content: { type: 'text', text } }],
            };
        }

        case 'debug_program': {
            const code = String(argumentsObject.code || '').slice(0, 8000);
            const error = String(argumentsObject.error || '').trim();
            const searchQuery = error ? `ошибки компилятор ${error}` : 'ошибки компилятор диагностика';
            const excerpts = relevantExcerpts(index, searchQuery, { limit: 2 });
            const errorsDoc = findReferenceDoc(index, 'reference/errors');
            const text = [
                'Ты — эксперт по отладке программ на языке Latent.',
                '',
                '## Код',
                '```latent',
                code,
                '```',
                '',
                error ? `## Сообщение об ошибке / наблюдаемое поведение\n\n\`\`\`\n${error}\n\`\`\`` : '## Сообщение об ошибке\n\nНе указано — предложи, как его получить.',
                '',
                '## Как отвечать',
                '1. Сначала определи класс проблемы (лексика, парсинг, типизация, кодогенерация, рантайм, ограничение движка).',
                '2. Укажи точное место: строка и колонка, если они есть в сообщении.',
                '3. Объясни причину и дай исправленный фрагмент кода.',
                '4. Предупреди о различиях движка №1 (JS-интерпретатор, поддерживает всё) и движка №2 (Rust→WASM, только чистое подмножество), если ошибка может быть из-за этого.',
                '5. Если нужен повторный анализ — попроси вызвать `check_code` с исправленным кодом.',
                '',
                errorsDoc ? `Полный список диагностик: страница \`${errorsDoc.path}\` (прочитайте через \`read_doc\`).` : '',
                '',
                '## Выдержки из документации по ошибкам',
                '',
                excerpts,
            ]
                .filter((line) => line !== '')
                .join('\n');

            return {
                description: 'Разбор ошибки в программе на Latent',
                messages: [{ role: 'user', content: { type: 'text', text } }],
            };
        }

        default:
            return null;
    }
}

/**
 * Обязательные аргументы промпта.
 * @param {string} name
 * @returns {string[]}
 */
export function requiredArguments(name) {
    switch (name) {
        case 'explain_syntax':
            return ['topic'];
        case 'write_program':
            return ['task'];
        case 'debug_program':
            return ['code'];
        default:
            return [];
    }
}
