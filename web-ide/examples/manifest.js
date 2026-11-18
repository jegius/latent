// examples/manifest.js — метаданные примеров языка Latent.
//
// Единственная ответственность: перечислить примеры (id, файл, название,
// описание, группа, флаги) БЕЗ исходного кода. Сам код лежит в .lat-файлах
// рядом (examples/*.lat) и загружается через examples/loader.js — единый
// источник правды. Порядок групп задан EXAMPLE_GROUPS.

/**
 * @typedef {Object} ExampleMeta
 * @property {string} id — машинный идентификатор
 * @property {string} file — имя файла .lat в каталоге examples/
 * @property {string} title — название в списке
 * @property {string} description — краткое описание фичи
 * @property {string} group — группа для меню File → Examples
 * @property {boolean} [needsAI] — требуется ли «Run with AI»
 */

export const EXAMPLE_GROUPS = ['Concurrency', 'Algorithms', 'Data', 'Functional', 'Language', 'OOP', 'AI', 'Testing', 'Misc'];

/** @type {ExampleMeta[]} */
export const EXAMPLE_META = [
    {
        id: 'parallel-sum',
        file: 'parallel_sum.lat',
        title: '⚡ Parallel Map-Reduce (spawn + channel)',
        description: 'Параллельная сумма квадратов через 4 горутины и канал',
        group: 'Concurrency',
    },
    {
        id: 'channels',
        file: 'channels.lat',
        title: '📡 Channels & Goroutines (producer/consumer)',
        description: 'CSP-примитивы: channel, send, recv, spawn',
        group: 'Concurrency',
    },
    {
        id: 'recursion',
        file: 'recursion.lat',
        title: '🔁 Recursion (factorial, fibonacci, ackermann)',
        description: 'Рекурсивные функции: факториал, Фибоначчи, Аккерман',
        group: 'Algorithms',
    },
    {
        id: 'sorting',
        file: 'sorting.lat',
        title: '🔢 Sorting (bubble sort, binary search)',
        description: 'Классические алгоритмы: пузырьковая сортировка и бинарный поиск',
        group: 'Algorithms',
    },
    {
        id: 'arrays',
        file: 'arrays.lat',
        title: '📊 Arrays & Methods (push, pop, length, concat)',
        description: 'Литералы, индексация, методы push/pop/length, конкатенация',
        group: 'Data',
    },
    {
        id: 'strings',
        file: 'strings.lat',
        title: '🔤 Strings (concat, length, comparison)',
        description: 'Строковые литералы, конкатенация, длина, сравнение',
        group: 'Data',
    },
    {
        id: 'control-flow',
        file: 'control_flow.lat',
        title: '🔀 Control Flow (if/else, while, for, logic ops)',
        description: 'Условия, циклы, логические операторы && || !',
        group: 'Functional',
    },
    {
        id: 'fp-patterns',
        file: 'fp_patterns.lat',
        title: 'λ FP Patterns (map, filter, reduce)',
        description: 'Функциональные паттерны: map, filter, reduce над массивами',
        group: 'Functional',
    },
    {
        id: 'variables-types',
        file: 'variables_types.lat',
        title: '📦 Variables & Types (let, annotations)',
        description: 'Объявление переменных, аннотации типов, присваивание',
        group: 'Language',
    },
    {
        id: 'operators',
        file: 'operators.lat',
        title: '➗ Operators (arithmetic, compare, logic)',
        description: 'Арифметика, сравнения, логика, приоритет операторов',
        group: 'Language',
    },
    {
        id: 'functions',
        file: 'functions.lat',
        title: '🧩 Functions (params, return, recursion)',
        description: 'Функции с параметрами и возвратом, композиция, рекурсия',
        group: 'Language',
    },
    {
        id: 'builtins-methods',
        file: 'builtins_methods.lat',
        title: '🧰 Builtins & Methods (len, push, pop, .length)',
        description: 'Встроенные функции len/push и методы массивов/строк',
        group: 'Language',
    },
    {
        id: 'ai-streaming',
        file: 'ai_streaming.lat',
        title: '🌊 AI Streaming (ai_stream, stream_next)',
        description: 'Потоковая генерация токенов модели через handle-поток',
        group: 'AI',
        needsAI: true,
    },
    {
        id: 'ai-infer',
        file: 'ai_infer.lat',
        title: '🤖 AI Inference (ai_infer)',
        description: 'Вызов AI-модели для анализа данных',
        group: 'AI',
        needsAI: true,
    },
    {
        id: 'ai-embed',
        file: 'ai_embed.lat',
        title: '🧬 AI Embeddings (ai_embed)',
        description: 'Векторные представления текста и косинусное сходство',
        group: 'AI',
        needsAI: true,
    },
    {
        id: 'ai-agents',
        file: 'ai_pipeline.lat',
        title: '🤖⚡ AI + Goroutines (parallel AI pipeline)',
        description: 'Комбинация AI-вызовов и параллельных вычислений',
        group: 'AI',
        needsAI: true,
    },
    {
        id: 'edge-cases',
        file: 'edge_cases.lat',
        title: '🧪 Edge Cases (empty arrays, null, unary ops)',
        description: 'Граничные случаи: пустые массивы, null, унарные операторы',
        group: 'Misc',
    },
    {
        id: 'classes',
        file: 'classes.lat',
        title: '🏛 Classes & OOP (fields, init, methods, this)',
        description: 'Классы, поля, конструктор init, методы и привязка this',
        group: 'OOP',
    },
    {
        id: 'match',
        file: 'match.lat',
        title: '🎯 Pattern Matching (match, case, Ok/Err)',
        description: 'Сопоставление с образцом: литералы, default, Result/Option',
        group: 'Language',
    },
    {
        id: 'async-await',
        file: 'async_await.lat',
        title: '⏳ Async/Await (async fn, await)',
        description: 'Асинхронные функции и разворачивание промисов через await',
        group: 'Language',
    },
    {
        id: 'select-yield',
        file: 'select_yield.lat',
        title: '📡 Select & Yield (CSP select, yield, spawn block)',
        description: 'select по каналам, yield планировщику, анонимные горутины',
        group: 'Concurrency',
    },
    {
        id: 'tensors',
        file: 'tensors.lat',
        title: '🧮 Tensors & Semantic (matmul, cosine_similarity)',
        description: 'Тензоры, матричное умножение и семантические векторы',
        group: 'AI',
    },
    {
        id: 'testing-contracts',
        file: 'testing_contracts.lat',
        title: '✅ Testing & Contracts (test, assert, forall, snapshot)',
        description: 'Тестовые блоки, assert/assert_eq, @forall, snapshot и контракты',
        group: 'Testing',
    },
    {
        id: 'lambdas',
        file: 'lambdas.lat',
        title: 'λ Lambdas & Closures (fn(x) => ..., higher-order)',
        description: 'Лямбды, замыкания, функции высшего порядка и for-in',
        group: 'Functional',
    },
];

/**
 * Возвращает метаданные примера по идентификатору.
 * @param {string} id
 * @returns {ExampleMeta|undefined}
 */
export function getExampleMeta(id) {
    return EXAMPLE_META.find(e => e.id === id);
}
