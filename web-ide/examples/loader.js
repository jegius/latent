// examples/loader.js — загрузчик исходников примеров из .lat-файлов.
//
// Единственная ответственность: превратить EXAMPLE_META (метаданные) + файлы
// examples/*.lat (код) в единый список Example. Работает и в браузере (fetch),
// и в Node (fs), поэтому примеры — единый источник правды для IDE и тестов.
//
// Ленивость:
//  * метаданные (manifest.js) подключаются dynamic import()'ом при первом
//    обращении, а не при импорте barrel-фасада;
//  * собранная Vite-версия использует import.meta.glob('?raw') — каждый .lat
//    становится отдельным ленивым модулем; нативная версия читает файл через
//    fetch (браузер) или fs (Node) только когда пример реально нужен.
//
// Логика кэшируется: повторная загрузка возвращает уже собранный массив.

// Vite заменяет import.meta.glob(...) на карту ленивых import() во время
// сборки. В нативной ES-модульной версии import.meta.glob отсутствует —
// TypeError ловим и работаем через fetch/fs.
let builtSources = null;
try {
    builtSources = import.meta.glob('./*.lat', { query: '?raw', import: 'default' });
} catch (e) {
    builtSources = null;
}

/** @type {Promise<typeof import('./manifest.js')>|null} */
let manifestPromise = null;

/** Лениво подключает манифест примеров. @returns {Promise<typeof import('./manifest.js')>} */
function loadManifest() {
    if (!manifestPromise) manifestPromise = import('./manifest.js');
    return manifestPromise;
}

/** @type {Array<import('../examples.js').Example>|null} */
let cache = null;

/** @type {Map<string, string>} — код уже прочитанных примеров (по id). */
const codeCache = new Map();

/**
 * Читает файл примера. В сборке Vite — из raw-модуля (ленивый import()),
 * в Node — через fs, в нативном браузере — через fetch рядом с модулем.
 *
 * @param {string} file — имя файла .lat
 * @returns {Promise<string>}
 */
async function readExampleFile(file) {
    if (builtSources && builtSources[`./${file}`]) {
        return builtSources[`./${file}`]();
    }
    // Node (тесты): нет document — читаем с диска относительно модуля.
    // Спецификаторы в переменных + @vite-ignore: Vite не пытается собрать
    // node-встроенные модули в браузерный бандл (ветка недостижима в браузере).
    if (typeof window === 'undefined' && typeof process !== 'undefined') {
        const fsSpec = 'node:fs/promises';
        const urlSpec = 'node:url';
        const pathSpec = 'node:path';
        const { readFile } = await import(/* @vite-ignore */ fsSpec);
        const { fileURLToPath } = await import(/* @vite-ignore */ urlSpec);
        const { dirname, join } = await import(/* @vite-ignore */ pathSpec);
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
 * Загружает метаданные всех примеров (без исходного кода). Этого достаточно,
 * чтобы построить дерево проекта и меню File → Examples, не скачивая .lat.
 *
 * @returns {Promise<Array<{id: string, file: string, title: string,
 *   description: string, group: string, needsAI?: boolean}>>}
 */
export async function loadExampleMeta() {
    const { EXAMPLE_META } = await loadManifest();
    return EXAMPLE_META;
}

/**
 * Загружает каталог целиком «на уровне метаданных»: список примеров и порядок
 * групп. Исходники .lat при этом не читаются.
 *
 * @returns {Promise<{examples: Array<Object>, groups: string[]}>}
 */
export async function loadExampleCatalog() {
    const { EXAMPLE_META, EXAMPLE_GROUPS } = await loadManifest();
    return { examples: EXAMPLE_META, groups: EXAMPLE_GROUPS };
}

/**
 * Загружает все примеры: метаданные + исходный код из .lat-файлов.
 * Результат кэшируется в порядке EXAMPLE_META.
 *
 * @returns {Promise<Array<import('../examples.js').Example>>}
 */
export async function loadExamples() {
    if (cache) return cache;
    const { EXAMPLE_META } = await loadManifest();
    cache = await Promise.all(EXAMPLE_META.map(async (meta) => {
        const code = codeCache.has(meta.id)
            ? codeCache.get(meta.id)
            : await readExampleFile(meta.file);
        codeCache.set(meta.id, code);
        return { ...meta, code };
    }));
    return cache;
}

/**
 * Возвращает пример по id, подгружая манифест и только его исходник.
 * Это ключевая точка ленивости: клик по примеру не тянет остальные .lat.
 *
 * @param {string} id
 * @returns {Promise<import('../examples.js').Example|undefined>}
 */
export async function loadExampleById(id) {
    const { getExampleMeta } = await loadManifest();
    const meta = getExampleMeta(id);
    if (!meta) return undefined;
    const cached = cache && cache.find(e => e.id === id);
    if (cached) return cached;
    const code = codeCache.has(id) ? codeCache.get(id) : await readExampleFile(meta.file);
    codeCache.set(id, code);
    return { ...meta, code };
}

/** Сбрасывает кэш (используется в тестах). */
export function resetExamplesCache() {
    cache = null;
    codeCache.clear();
}
