// examples.js — barrel-фасад коллекции примеров Latent.
//
// Единственная ответственность: реэкспорт асинхронного API каталога examples/.
// Исходный код примеров хранится в реальных .lat-файлах (examples/*.lat) и
// загружается через examples/loader.js. Список метаданных — examples/manifest.js.

/** @typedef {import('./examples/index.js').Example} Example */

export {
    EXAMPLE_META,
    EXAMPLE_GROUPS,
    getExampleMeta,
    loadExamples,
    loadExampleById,
    resetExamplesCache,
} from './examples/index.js';