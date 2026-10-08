// examples/loader.js — загрузчик исходников примеров из .lat-файлов.
//
// Единственная ответственность: превратить EXAMPLE_META (метаданные) + файлы
// examples/*.lat (код) в единый список Example. Работает и в браузере (fetch),
// и в Node (fs), поэтому примеры — единый источник правды для IDE и тестов.
//
// Логика кэшируется: повторная загрузка возвращает уже собранный массив.

import { EXAMPLE_META, getExampleMeta } from './manifest.js';

/** @type {Array<import('../examples.js').Example>|null} */
let cache = null;

/**
 * Читает файл примера. В Node — через fs, в браузере — через fetch рядом
 * с текущим модулем (директория examples/).
 *
 * @param {string} file — имя файла .lat
 * @returns {Promise<string>}
 */
async function readExampleFile(file) {
    // Node (тесты): нет document — читаем с диска относительно модуля.
    if (typeof window === 'undefined' && typeof process !== 'undefined') {
        const { readFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const here = dirname(fileURLToPath(import.meta.url));
        return readFile(join(here, file), 'utf8');
    }
    // Браузер: файлы лежат рядом с этим модулем (web-ide/examples/*.lat).
    const url = new URL(file, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Не удалось загрузить пример ${file}: HTTP ${res.status}`);
    }
    return res.text();
}

/**
 * Загружает все примеры: метаданные + исходный код из .lat-файлов.
 * Результат кэшируется в порядке EXAMPLE_META.
 *
 * @returns {Promise<Array<import('../examples.js').Example>>}
 */
export async function loadExamples() {
    if (cache) return cache;
    cache = await Promise.all(EXAMPLE_META.map(async (meta) => ({
        ...meta,
        code: await readExampleFile(meta.file),
    })));
    return cache;
}

/**
 * Возвращает пример по id, загружая исходники при необходимости.
 *
 * @param {string} id
 * @returns {Promise<import('../examples.js').Example|undefined>}
 */
export async function loadExampleById(id) {
    const meta = getExampleMeta(id);
    if (!meta) return undefined;
    const all = await loadExamples();
    return all.find(e => e.id === id);
}

/** Сбрасывает кэш (используется в тестах). */
export function resetExamplesCache() {
    cache = null;
}