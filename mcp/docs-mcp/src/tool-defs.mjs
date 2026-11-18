// tool-defs.mjs — описания MCP-инструментов (tools/list).
//
// Единственная ответственность: декларации инструментов с JSON-схемами входа
// и аннотациями (read-only, локальность). Реализация — в tools.mjs.
// Имена и параметры зафиксированы контрактом PLAN.md.

/** Допустимые темы для get_language_reference. */
export const REFERENCE_TOPICS = ['grammar', 'types', 'operators', 'builtins', 'errors', 'abi', 'all'];

const annotationsReadOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};

/** Массив деклараций tools для MCP. */
export const TOOLS = [
    {
        name: 'list_docs',
        title: 'Список документов документации',
        description:
            'Возвращает оглавление документации языка Latent: путь, заголовок, описание и раздел каждой страницы. '
            + 'Используйте как первую команду, чтобы понять, что есть в документации.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        annotations: { title: 'Список документов', ...annotationsReadOnly },
    },
    {
        name: 'search_docs',
        title: 'Поиск по документации',
        description:
            'Полнотекстовый поиск по документации Latent с ранжированием (заголовок важнее описания, затем теги, '
            + 'заголовки разделов и текст) и сниппетами. Регистронезависимый, учитывает словоформы.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Поисковый запрос, например «массивы push pop» или «обработка ошибок».' },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                    description: 'Сколько результатов вернуть (по умолчанию 10).',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
        annotations: { title: 'Поиск по документации', ...annotationsReadOnly },
    },
    {
        name: 'read_doc',
        title: 'Прочитать страницу документации',
        description: 'Возвращает полный Markdown страницы документации по её относительному пути (например guide/variables.md).',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Относительный путь страницы из list_docs, например reference/grammar.md.',
                },
            },
            required: ['path'],
            additionalProperties: false,
        },
        annotations: { title: 'Чтение страницы документации', ...annotationsReadOnly },
    },
    {
        name: 'get_language_reference',
        title: 'Справочник по языку',
        description:
            'Возвращает агрегированный Markdown-справочник из раздела reference/: грамматика, типы, операторы, '
            + 'встроенные функции, ошибки, ABI. Без topic (или topic="all") — весь справочник.',
        inputSchema: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    enum: REFERENCE_TOPICS,
                    description: 'Раздел справочника; по умолчанию all.',
                },
            },
            additionalProperties: false,
        },
        annotations: { title: 'Справочник по языку Latent', ...annotationsReadOnly },
    },
    {
        name: 'get_example',
        title: 'Пример программы на Latent',
        description:
            'Возвращает полный исходник примера языка Latent по id (например parallel-sum, match, classes). '
            + 'Без id — список доступных примеров с названиями.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Идентификатор примера из списка (необязательно).' },
            },
            additionalProperties: false,
        },
        annotations: { title: 'Пример программы', ...annotationsReadOnly },
    },
    {
        name: 'check_code',
        title: 'Проверить код Latent',
        description:
            'Компилирует исходник настоящим Rust-компилятором Latent (WASM) и возвращает диагностику с номерами '
            + 'строк и колонок. Код не исполняется — только проверка компиляции.',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'Исходный код на языке Latent.' },
            },
            required: ['code'],
            additionalProperties: false,
        },
        annotations: {
            title: 'Проверка кода',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
];
