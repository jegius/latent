// compiler/run.js — выполнение программы на движке №1.
// Единственная ответственность: runLatent (pre-fetch AI + persistent-кэш) и
// runLatentProject (многофайловый проект через линковку модулей).
// Сетевой AI-слой подключается dynamic import()'ом только в AI-режиме с
// реальным провайдером — обычный Run не тянет ai-gateway.

import { tokenize } from './lexer.js';
import { Parser } from './parser.js';
import { Interpreter } from './interpreter.js';
import { AIConfig, persistentAICache, aiCacheKey } from './ai-config.js';
import { collectAIPrompts } from './repair-core.js';
import { loadAIGateway } from './lazy-ai.js';
import { linkModuleProject } from './modules-link.js';

/**
 * Предзагрузка ответов ai_infer: реальный гейтвей (pre-fetch) + persistent-кэш.
 * @param {object} program
 * @param {Interpreter} interpreter
 * @param {string[]} output
 * @param {boolean} withAI
 * @param {{forceMockAI?: boolean}} opts
 */
async function prefetchAI(program, interpreter, output, withAI, opts) {
    if (!(withAI && AIConfig.provider !== 'mock' && !opts.forceMockAI)) return;
    const { aiInferRemote } = await loadAIGateway();
    const prompts = new Set();
    for (const fn of Object.values(program.functions || {})) {
        collectAIPrompts(fn.body, prompts);
    }
    if (prompts.size === 0) return;
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

/** Исполняет готовый Program и возвращает { result, output }. */
async function executeProgram(program, withAI, opts) {
    const output = [];
    const interpreter = new Interpreter(program, (text) => output.push(text));
    if (withAI) interpreter.enableAI();
    await prefetchAI(program, interpreter, output, withAI, opts);

    const result = interpreter.run();
    // test-блоки исполняются после main; показываем их результаты в консоли,
    // чтобы Testing & Contracts-пример давал осмысленный вывод в playground.
    for (const t of interpreter.testResults) {
        output.push(`test "${t.name}": ${t.passed ? 'ok' : `FAILED — ${t.error}`}`);
    }
    return { result, output };
}

/**
 * Выполняет исходный код Latent и возвращает { result, output }.
 * Если включён AI и настроен реальный гейтвей (provider !== 'mock'),
 * предзагружает ответы ai_infer из гейтвея (pre-fetch), иначе — мок.
 * @param {string} source — исходный код
 * @param {boolean} withAI — включить AI-функции
 * @param {Object} [opts]
 * @param {boolean} [opts.forceMockAI] — не ходить в сеть: обычный Run
 *   AI-примеров использует детерминированный mock, даже если настроен гейтвей
 * @returns {{ result: any, output: string[] }}
 */
export async function runLatent(source, withAI = false, opts = {}) {
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    const program = parser.parseProgram();
    if ((program.statements || []).some((s) => s.type === 'Import')) {
        throw new Error(
            'Program has import declarations: use runLatentProject(files, entry) ' +
            'or CompilerService.compileAndRunProject.');
    }
    return executeProgram(program, withAI, opts);
}

/**
 * Выполняет многофайловый проект: линковка модулей от entry, затем запуск.
 * @param {Array<{name?:string, code?:string}>} files — все .lat-файлы проекта
 * @param {string} entryPath — активный файл (entry)
 * @param {boolean} [withAI]
 * @param {Object} [opts] — forceMockAI/moduleCache/noCache
 * @returns {Promise<{result:any, output:string[], modules:number,
 *     modulePaths:string[], cycles:string[][]}>}
 */
export async function runLatentProject(files, entryPath, withAI = false, opts = {}) {
    const linked = linkModuleProject(files, entryPath, {
        cache: opts.moduleCache,
        noCache: opts.noCache,
    });
    const executed = await executeProgram(linked.program, withAI, opts);
    return {
        ...executed,
        modules: linked.modules.length,
        modulePaths: linked.modules.map((m) => m.path),
        cycles: linked.cycles,
    };
}
