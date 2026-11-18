// services/ai-settings-service.js — сервис настроек AI Gateway.
// Бизнес-логика: конфигурация, персистентность (localStorage), проверка соединения.
// Не знает ничего о DOM.

import { configureAI, checkAIGateway, getAIConfig } from '../compiler-loader.js';

const STORAGE_KEY = 'latent-ai-config';

/**
 * @typedef {Object} AISettings
 * @property {string} provider — 'mock' | 'ollama' | 'openai-compatible'
 * @property {string} baseUrl
 * @property {string} model
 * @property {string} apiKey
 */

export class AISettingsService {
    /**
     * Загружает сохранённые настройки из localStorage.
     * @returns {AISettings|null}
     */
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Сохраняет текущую конфигурацию AI в localStorage.
     */
    save() {
        const cfg = getAIConfig();
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                provider: cfg.provider,
                baseUrl: cfg.baseUrl,
                model: cfg.model,
                apiKey: cfg.apiKey,
            }));
        } catch (e) {
            // localStorage недоступен — игнорируем
        }
    }

    /**
     * Применяет настройки к глобальной конфигурации AI.
     * @param {AISettings} settings
     */
    apply(settings) {
        configureAI({
            provider: settings.provider,
            baseUrl: (settings.baseUrl || '').trim(),
            model: (settings.model || '').trim(),
            apiKey: settings.apiKey || '',
        });
    }

    /**
     * Возвращает текущую конфигурацию AI.
     * @returns {AISettings}
     */
    getConfig() {
        return getAIConfig();
    }

    /**
     * Проверяет соединение с AI-гейтвеем.
     * @returns {Promise<{ok: boolean, models?: string[], error?: string}>}
     */
    async testConnection() {
        return checkAIGateway();
    }
}
