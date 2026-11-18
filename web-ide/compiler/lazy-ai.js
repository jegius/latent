// compiler/lazy-ai.js — ленивые мосты к AI-модулям.
//
// Единственная ответственность: загрузить сетевой слой AI (`ai-gateway.js`) и
// self-repair (`repair.js`) только при первом реальном использовании. Модуль
// сам по себе содержит лишь dynamic import() и тонкие async-обёртки, поэтому
// попадает в core-чанк и не тянет AI-провайдеров при старте IDE.

let gatewayPromise = null;
let repairPromise = null;

/**
 * Лениво загружает AI Gateway (провайдеры, fetch, проверка соединения).
 * Промис кэшируется: повторные вызовы не создают новых import().
 * @returns {Promise<typeof import('./ai-gateway.js')>}
 */
export function loadAIGateway() {
    if (!gatewayPromise) gatewayPromise = import('./ai-gateway.js');
    return gatewayPromise;
}

/**
 * Лениво загружает self-repair (AI-ремонт + детерминированный fallback).
 * @returns {Promise<typeof import('./repair.js')>}
 */
export function loadRepair() {
    if (!repairPromise) repairPromise = import('./repair.js');
    return repairPromise;
}

/**
 * Проверяет доступность гейтвея, загружая сетевой слой только сейчас.
 * @returns {Promise<{ok: boolean, models?: string[], error?: string}>}
 */
export async function checkAIGateway() {
    const gateway = await loadAIGateway();
    return gateway.checkAIGateway();
}

/**
 * Выполняет inference через гейтвей (загрузка провайдера — по требованию).
 * @param {string} model
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function aiInferRemote(model, prompt) {
    const gateway = await loadAIGateway();
    return gateway.aiInferRemote(model, prompt);
}

/**
 * Ремонтирует исходник: AI-модуль грузится только при первом ремонте.
 * @param {string} source
 * @param {string} diagnostic
 * @param {boolean} [withAI]
 * @returns {Promise<string|null>}
 */
export async function repairCode(source, diagnostic, withAI = true) {
    const repair = await loadRepair();
    return repair.repairCode(source, diagnostic, withAI);
}
