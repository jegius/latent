// compiler/repair.js — AI self-repair исходного кода Latent.
// Единственная ответственность: получение исправленного исходника (AI или
// детерминированно). Модуль грузится лениво через compiler/lazy-ai.js: при
// старте IDE сетевой слой не нужен.

import { AIConfig } from './ai-config.js';
import { aiInferRemote } from './ai-gateway.js';
import { extractCode, deterministicRepair } from './repair-core.js';

// Обратная совместимость: чистые помощники исторически экспортировались отсюда.
export { extractCode, deterministicRepair, collectAIPrompts } from './repair-core.js';

/**
 * Выполняет self-repair: отправляет исходник + диагностику модели и получает
 * исправленный исходник (§6.5 статьи, цикл из Части VIII).
 * При mock-провайдере или ошибке гейтвея применяется детерминированный ремонт
 * типовых синтаксических ошибок.
 * @param {string} source — текущий исходник
 * @param {string} diagnostic — сообщение об ошибке компилятора/интерпретатора
 * @param {boolean} withAI
 * @returns {Promise<string|null>} исправленный исходник или null, если ремонт невозможен
 */
export async function repairCode(source, diagnostic, withAI = true) {
    if (withAI && AIConfig.provider !== 'mock') {
        const prompt =
            'You are a code repair assistant for the Latent language.\n' +
            'The following program failed with this diagnostic:\n' +
            `DIAGNOSTIC: ${diagnostic}\n\n` +
            'SOURCE:\n' + source + '\n\n' +
            'Return ONLY the corrected Latent source code without markdown fences.';
        try {
            const raw = await aiInferRemote(null, prompt);
            return extractCode(raw);
        } catch (e) {
            // падаем в детерминированный ремонт
        }
    }
    return deterministicRepair(source, diagnostic);
}
