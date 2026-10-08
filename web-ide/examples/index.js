// examples/index.js — фасад каталога примеров.
//
// Единственная ответственность: свести метаданные (manifest.js) и загрузчик
// исходников (.lat через loader.js) в единый асинхронный API. Определение типа
// Example — здесь; сам код примеров — в одноимённых .lat-файлах рядом.

export { EXAMPLE_META, EXAMPLE_GROUPS, getExampleMeta } from './manifest.js';
export { loadExamples, loadExampleById, resetExamplesCache } from './loader.js';

/**
 * @typedef {Object} Example
 * @property {string} id — машинный идентификатор
 * @property {string} file — имя файла .lat в каталоге examples/
 * @property {string} title — название в списке
 * @property {string} description — краткое описание фичи
 * @property {string} group — группа меню File → Examples
 * @property {string} code — исходный код примера (из .lat-файла)
 * @property {boolean} [needsAI] — требуется ли кнопка «Run with AI»
 */