// test/ai-settings.test.js — тесты сервиса настроек AI Gateway (без DOM).
//
// Сервис отвечает за загрузку/сохранение настроек в localStorage, применение
// их к глобальной конфигурации AI и проверку соединения с гейтвеем.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AISettingsService } from '../services/ai-settings-service.js';
import { configureAI, getAIConfig } from '../compiler-loader.js';

const BASE = getAIConfig();
afterEach(() => configureAI(BASE));

/** In-memory localStorage-стаб. */
function memStorage(overrides = {}) {
    const map = new Map();
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        ...overrides,
    };
}

test('load: читает сохранённые настройки из localStorage', () => {
    const storage = memStorage();
    storage.setItem('latent-ai-config', JSON.stringify({ provider: 'ollama', model: 'm1' }));
    globalThis.localStorage = storage;
    try {
        const settings = new AISettingsService().load();
        assert.deepEqual(settings, { provider: 'ollama', model: 'm1' });
    } finally {
        delete globalThis.localStorage;
    }
});

test('load: нет записи → null', () => {
    globalThis.localStorage = memStorage();
    try {
        assert.equal(new AISettingsService().load(), null);
    } finally {
        delete globalThis.localStorage;
    }
});

test('load: битый JSON → null (не бросает)', () => {
    const storage = memStorage();
    storage.setItem('latent-ai-config', '{not json');
    globalThis.localStorage = storage;
    try {
        assert.equal(new AISettingsService().load(), null);
    } finally {
        delete globalThis.localStorage;
    }
});

test('load: localStorage недоступен → null', () => {
    // В Node localStorage отсутствует — сервис должен деградировать молча.
    assert.equal(new AISettingsService().load(), null);
});

test('save: сериализует текущую конфигурацию AI', () => {
    const storage = memStorage();
    globalThis.localStorage = storage;
    try {
        configureAI({
            provider: 'openai-compatible', baseUrl: 'https://api', model: 'gpt', apiKey: 'sk',
        });
        new AISettingsService().save();
        const saved = JSON.parse(storage.map.get('latent-ai-config'));
        assert.deepEqual(saved, {
            provider: 'openai-compatible', baseUrl: 'https://api', model: 'gpt', apiKey: 'sk',
        });
    } finally {
        delete globalThis.localStorage;
    }
});

test('save: ошибка storage не пробрасывается', () => {
    globalThis.localStorage = memStorage({ setItem: () => { throw new Error('quota'); } });
    try {
        assert.doesNotThrow(() => new AISettingsService().save());
    } finally {
        delete globalThis.localStorage;
    }
});

test('apply: обрезает пробелы и подставляет значения по умолчанию', () => {
    const svc = new AISettingsService();
    svc.apply({ provider: 'ollama', baseUrl: '  http://localhost:11434  ', model: '  qwen3:4b ' });
    const cfg = getAIConfig();
    assert.equal(cfg.provider, 'ollama');
    assert.equal(cfg.baseUrl, 'http://localhost:11434');
    assert.equal(cfg.model, 'qwen3:4b');
    assert.equal(cfg.apiKey, '');

    svc.apply({ provider: 'mock' });
    assert.equal(getAIConfig().provider, 'mock');
    assert.equal(getAIConfig().baseUrl, '');
});

test('getConfig: возвращает снимок конфигурации', () => {
    configureAI({ provider: 'ollama', model: 'x' });
    const cfg = new AISettingsService().getConfig();
    assert.equal(cfg.provider, 'ollama');
    assert.equal(cfg.model, 'x');
    cfg.provider = 'mutated';
    assert.equal(getAIConfig().provider, 'ollama'); // копия, не ссылка
});

test('testConnection: mock-провайдер доступен без сети', async () => {
    configureAI({ provider: 'mock' });
    const res = await new AISettingsService().testConnection();
    assert.deepEqual(res, { ok: true, models: ['mock-model'] });
});

test('testConnection: ollama опрашивает /api/tags', async () => {
    const origFetch = globalThis.fetch;
    let requested = null;
    globalThis.fetch = async (url) => {
        requested = url;
        return { ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen3:4b' }] }) };
    };
    try {
        configureAI({ provider: 'ollama', baseUrl: 'http://gpu:11434' });
        const res = await new AISettingsService().testConnection();
        assert.deepEqual(res.models, ['qwen3:4b']);
        assert.equal(requested, 'http://gpu:11434/api/tags');
    } finally {
        globalThis.fetch = origFetch;
    }
});

test('testConnection: недоступный гейтвей → ok:false', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
        configureAI({ provider: 'ollama' });
        const res = await new AISettingsService().testConnection();
        assert.equal(res.ok, false);
        assert.match(res.error, /ECONNREFUSED/);
    } finally {
        globalThis.fetch = origFetch;
    }
});
