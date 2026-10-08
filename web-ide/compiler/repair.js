// compiler/repair.js — AI self-repair исходного кода Latent.
// Единственная ответственность: получение исправленного исходника (AI или детерминированно).

import { AIConfig } from './ai-config.js';
import { aiInferRemote } from './ai-gateway.js';

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

/**
 * Извлекает код из ответа модели, снимая markdown-ограждения ```...```.
 * @param {string} text
 * @returns {string}
 */
export function extractCode(text) {
    const str = String(text || '');
    const fence = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/.exec(str);
    if (fence) return fence[1].trim();
    return str.trim();
}

/**
 * Детерминированный ремонт типовых синтаксических ошибок — fallback для
 * mock-режима. Поддерживает две частые правки:
 *  - отсутствующая `;` перед `}` (по номеру строки из диагностики);
 *  - несбалансированные фигурные скобки (добавление закрывающей в конец).
 * Возвращает null, если ничего исправить не удалось.
 * @param {string} source
 * @param {string} diagnostic
 * @returns {string|null}
 */
export function deterministicRepair(source, diagnostic) {
    const lines = source.split('\n');
    const diag = String(diagnostic || '');

    // Правило 1: "Expected ; but got '}' at line N" — диагностика указывает на
    // строку с '}', а точку с запятой надо поставить в конце предыдущей
    // содержательной строки.
    const semicolon = /Expected[^]*?line (\d+)/i.exec(diag);
    if (semicolon) {
        const lineNo = parseInt(semicolon[1], 10) - 1; // 0-based строка с '}'
        // Ищем последнюю непустую строку до lineNo
        for (let i = lineNo - 1; i >= 0; i--) {
            const trimmed = lines[i].trim();
            if (trimmed.length > 0) {
                if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}')) {
                    lines[i] = lines[i].replace(/\s*$/, '') + ';';
                    return lines.join('\n');
                }
                break;
            }
        }
    }

    // Правило 2: несбалансированные фигурные скобки — добавляем закрывающие
    let depth = 0;
    for (const ch of source) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    if (depth > 0) {
        return source.replace(/\s*$/, '') + '\n' + '}'.repeat(depth) + '\n';
    }

    return null;
}

/**
 * Рекурсивно собирает строковые литералы — аргументы prompt вызовов ai_infer.
 * @param {object} node — узел AST
 * @param {Set<string>} prompts — аккумулятор промптов
 */
export function collectAIPrompts(node, prompts) {
    if (!node || typeof node !== 'object') return;

    // Вызов ai_infer(model, prompt) со строковым литералом prompt
    if (node.type === 'Call' &&
        node.callee && node.callee.type === 'Ident' &&
        node.callee.name === 'ai_infer' &&
        node.args && node.args.length >= 2 &&
        node.args[1].type === 'String') {
        prompts.add(node.args[1].value);
    }

    // Рекурсивный обход всех полей
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) collectAIPrompts(item, prompts);
        } else if (child && typeof child === 'object') {
            collectAIPrompts(child, prompts);
        }
    }
}