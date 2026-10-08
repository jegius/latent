// compiler/ai-gateway.js — сетевой слой AI Gateway.
// Единственная ответственность: проверка доступности и удалённый inference.

import { AIConfig } from './ai-config.js';

/**
 * Проверяет доступность гейтвея. Для ollama — GET /api/tags.
 * @returns {Promise<{ok: boolean, models?: string[], error?: string}>}
 */
export async function checkAIGateway() {
    if (AIConfig.provider === 'mock') {
        return { ok: true, models: ['mock-model'] };
    }
    if (AIConfig.provider === 'ollama') {
        try {
            const res = await fetch(`${AIConfig.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { ok: true, models: (data.models || []).map(m => m.name) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    if (AIConfig.provider === 'openai-compatible') {
        try {
            const res = await fetch(`${AIConfig.baseUrl}/models`, {
                headers: AIConfig.apiKey ? { 'Authorization': `Bearer ${AIConfig.apiKey}` } : {},
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { ok: true, models: (data.data || []).map(m => m.id) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: false, error: `Unknown provider: ${AIConfig.provider}` };
}

/**
 * Выполняет inference через настроенный гейтвей.
 * При ошибке сети — fallback на детерминированный мок.
 * @param {string} model
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function aiInferRemote(model, prompt) {
    // Для ollama и openai-compatible по умолчанию модель берётся из конфигурации
    // гейтвея (поле Model в UI) — пользователь настраивает свою модель, а литерал
    // в коде может быть невалидным. Но если в коде указана явная модель, а в
    // настройках модель не задана — используем литерал как fallback.
    const effectiveModel = AIConfig.model || model || '';

    if (AIConfig.provider === 'ollama') {
        const res = await fetch(`${AIConfig.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: effectiveModel,
                prompt: String(prompt),
                stream: false,
                options: { temperature: 0.2 },
            }),
            signal: AbortSignal.timeout(AIConfig.timeout),
        });
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
        const data = await res.json();
        // Убираем think-блоки из ответов reasoning-моделей (qwen3 и т.п.)
        let text = data.response || '';
        text = text.replace(/ thinking[\s\S]*?<\/think>/g, '').trim();
        return text;
    }

    if (AIConfig.provider === 'openai-compatible') {
        const res = await fetch(`${AIConfig.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(AIConfig.apiKey ? { 'Authorization': `Bearer ${AIConfig.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: effectiveModel,
                messages: [{ role: 'user', content: String(prompt) }],
                temperature: 0.2,
            }),
            signal: AbortSignal.timeout(AIConfig.timeout),
        });
        if (!res.ok) throw new Error(`Gateway HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
    }

    // provider === 'mock' — обрабатывается вызывающей стороной
    throw new Error('mock provider');
}