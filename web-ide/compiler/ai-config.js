// compiler/ai-config.js — глобальная конфигурация AI и персистентный кэш инференса.
// Единственная ответственность: хранение настроек гейтвея/модели и кэша ответов.

/**
 * Глобальная конфигурация AI. Изменяется через configureAI().
 * provider: 'mock' | 'ollama' | 'openai-compatible'
 * baseUrl: базовый URL гейтвея (для ollama — http://localhost:11434)
 * model: имя модели (для ollama — например 'qwen3-coder:14b')
 * apiKey: ключ API (для openai-compatible гейтвеев, опционально)
 */
export const AIConfig = {
    provider: 'mock',
    baseUrl: 'http://localhost:11434',
    model: 'qwen3:4b',
    apiKey: '',
    timeout: 120000,
};

/**
 * Настраивает AI-провайдера. Вызывается из IDE при изменении настроек.
 * @param {Partial<typeof AIConfig>} cfg
 */
export function configureAI(cfg) {
    Object.assign(AIConfig, cfg);
}

// Кэш AI-инференса, живущий МЕЖДУ перезапусками программы (см. §5.2, §6.4 статьи).
// Ключ — provider::model::prompt, поэтому смена гейтвея/модели не отдаёт чужие ответы.
export const persistentAICache = new Map();

export function aiCacheKey(provider, model, prompt) {
    return `${provider}::${model}::${prompt}`;
}

/**
 * Очищает кэш AI-инференса (тесты, смена гейтвея).
 */
export function clearAICache() {
    persistentAICache.clear();
}

/**
 * Возвращает текущее число записей в кэше AI-инференса.
 * @returns {number}
 */
export function getAICacheSize() {
    return persistentAICache.size;
}

export function getAIConfig() {
    return { ...AIConfig };
}