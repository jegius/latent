// compiler/run.js — выполнение программы на движке №1.
// Единственная ответственность: runLatent (pre-fetch AI + persistent-кэш).

import { tokenize } from './lexer.js';
import { Parser } from './parser.js';
import { Interpreter } from './interpreter.js';
import { AIConfig, persistentAICache, aiCacheKey } from './ai-config.js';
import { aiInferRemote } from './ai-gateway.js';
import { collectAIPrompts } from './repair.js';

/**
 * Выполняет исходный код Latent и возвращает { result, output }.
 * Если включён AI и настроен реальный гейтвей (provider !== 'mock'),
 * предзагружает ответы ai_infer из гейтвея (pre-fetch), иначе — мок.
 * @param {string} source — исходный код
 * @param {boolean} withAI — включить AI-функции
 * @returns {{ result: any, output: string[] }}
 */
export async function runLatent(source, withAI = false) {
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    const program = parser.parseProgram();

    const output = [];
    const interpreter = new Interpreter(program, (text) => output.push(text));
    if (withAI) interpreter.enableAI();

    // Pre-fetch: если настроен реальный гейтвей, загружаем ответы ai_infer заранее.
    // Кэш персистентный — живёт между перезапусками программы (§6.4 статьи).
    if (withAI && AIConfig.provider !== 'mock') {
        const prompts = new Set();
        for (const fn of Object.values(program.functions)) {
            collectAIPrompts(fn.body, prompts);
        }
        if (prompts.size > 0) {
            interpreter.aiCache = new Map();
            let fetched = 0;
            let cached = 0;
            for (const prompt of prompts) {
                const key = aiCacheKey(AIConfig.provider, AIConfig.model, prompt);
                if (persistentAICache.has(key)) {
                    interpreter.aiCache.set(prompt, persistentAICache.get(key));
                    cached++;
                }
            }
            const toFetch = [...prompts].filter(p =>
                !persistentAICache.has(aiCacheKey(AIConfig.provider, AIConfig.model, p)));
            if (toFetch.length > 0) {
                output.push(`[AI] Fetching ${toFetch.length} inference(s) from ${AIConfig.provider} (${AIConfig.baseUrl})...`);
            }
            if (cached > 0) {
                output.push(`[AI] ${cached} inference(s) served from cache.`);
            }
            for (const prompt of toFetch) {
                try {
                    const response = await aiInferRemote(null, prompt);
                    interpreter.aiCache.set(prompt, response);
                    persistentAICache.set(
                        aiCacheKey(AIConfig.provider, AIConfig.model, prompt), response);
                    fetched++;
                } catch (e) {
                    output.push(`[AI] Gateway error: ${e.message} — falling back to mock`);
                    // Не кэшируем — aiInfer использует mock
                }
            }
        }
    }

    const result = interpreter.run();
    return { result, output };
}