// test/ai-gateway.test.js — тесты сетевого слоя AI Gateway и pre-fetch движка №1.
//
// Проверяем реальное поведение: оба провайдера (ollama / openai-compatible) на
// стабе fetch, обработку HTTP-ошибок, нормализацию ответов, persistent-кэш
// инференса и fallback self-repair на детерминированный ремонт.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    configureAI, getAIConfig, clearAICache, getAICacheSize, repairCode, runLatent,
} from '../compiler-loader.js';
import { checkAIGateway, aiInferRemote } from '../compiler/ai-gateway.js';
import { persistentAICache, aiCacheKey } from '../compiler/ai-config.js';

/** Временно подменяет globalThis.fetch и конфигурацию AI. */
async function withGateway(cfg, fetchImpl, fn) {
    const before = getAIConfig();
    const origFetch = globalThis.fetch;
    configureAI(cfg);
    if (fetchImpl) globalThis.fetch = fetchImpl;
    try {
        return await fn();
    } finally {
        configureAI(before);
        globalThis.fetch = origFetch;
    }
}

/** fetch-стаб, возвращающий JSON с заданным статусом. */
function jsonResponse(payload, ok = true, status = 200) {
    return async () => ({ ok, status, json: async () => payload });
}

test('checkAIGateway: mock провайдер доступен без сети', async () => {
    await withGateway({ provider: 'mock' }, null, async () => {
        const res = await checkAIGateway();
        assert.deepEqual(res, { ok: true, models: ['mock-model'] });
    });
});

test('checkAIGateway: ollama читает список моделей из /api/tags', async () => {
    let requestedUrl = null;
    const fetchImpl = async (url) => {
        requestedUrl = url;
        return { ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen3:4b' }, { name: 'llama3' }] }) };
    };
    await withGateway({ provider: 'ollama', baseUrl: 'http://gpu:11434' }, fetchImpl, async () => {
        const res = await checkAIGateway();
        assert.equal(res.ok, true);
        assert.deepEqual(res.models, ['qwen3:4b', 'llama3']);
        assert.equal(requestedUrl, 'http://gpu:11434/api/tags');
    });
});

test('checkAIGateway: ollama без поля models → пустой список', async () => {
    await withGateway({ provider: 'ollama' }, jsonResponse({}), async () => {
        const res = await checkAIGateway();
        assert.deepEqual(res.models, []);
    });
});

test('checkAIGateway: HTTP-ошибка ollama → ok:false с текстом', async () => {
    await withGateway({ provider: 'ollama' }, jsonResponse({}, false, 503), async () => {
        const res = await checkAIGateway();
        assert.equal(res.ok, false);
        assert.match(res.error, /HTTP 503/);
    });
});

test('checkAIGateway: сетевой сбой → ok:false, не бросает', async () => {
    await withGateway({ provider: 'ollama' }, async () => { throw new Error('ECONNREFUSED'); }, async () => {
        const res = await checkAIGateway();
        assert.deepEqual(res, { ok: false, error: 'ECONNREFUSED' });
    });
});

test('checkAIGateway: openai-compatible шлёт Bearer и читает /models', async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => {
        seen = { url, auth: opts.headers.Authorization };
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'gpt-a' }, { id: 'gpt-b' }] }) };
    };
    await withGateway({ provider: 'openai-compatible', baseUrl: 'https://api.test/v1', apiKey: 'sk-1' },
        fetchImpl, async () => {
            const res = await checkAIGateway();
            assert.deepEqual(res.models, ['gpt-a', 'gpt-b']);
            assert.equal(seen.url, 'https://api.test/v1/models');
            assert.equal(seen.auth, 'Bearer sk-1');
        });
});

test('checkAIGateway: openai-compatible без ключа не шлёт Authorization', async () => {
    let headers = null;
    await withGateway({ provider: 'openai-compatible', apiKey: '' }, async (url, opts) => {
        headers = opts.headers;
        return { ok: true, status: 200, json: async () => ({}) };
    }, async () => {
        const res = await checkAIGateway();
        assert.deepEqual(res.models, []);
        assert.deepEqual(headers, {});
    });
});

test('checkAIGateway: ошибка openai-compatible → ok:false', async () => {
    await withGateway({ provider: 'openai-compatible' }, jsonResponse({}, false, 401), async () => {
        const res = await checkAIGateway();
        assert.equal(res.ok, false);
        assert.match(res.error, /HTTP 401/);
    });
});

test('checkAIGateway: неизвестный провайдер → понятная ошибка', async () => {
    await withGateway({ provider: 'mystery' }, null, async () => {
        const res = await checkAIGateway();
        assert.deepEqual(res, { ok: false, error: 'Unknown provider: mystery' });
    });
});

test('aiInferRemote (ollama): POST на /api/generate, модель из конфига', async () => {
    let body = null;
    const fetchImpl = async (url, opts) => {
        body = { url, ...JSON.parse(opts.body), method: opts.method };
        return { ok: true, status: 200, json: async () => ({ response: 'готовый ответ' }) };
    };
    await withGateway({ provider: 'ollama', baseUrl: 'http://gpu:11434', model: 'qwen3:4b' },
        fetchImpl, async () => {
            const text = await aiInferRemote('ignored-model', 'объясни код');
            assert.equal(text, 'готовый ответ');
            assert.equal(body.url, 'http://gpu:11434/api/generate');
            assert.equal(body.method, 'POST');
            assert.equal(body.model, 'qwen3:4b'); // модель из настроек приоритетнее литерала
            assert.equal(body.prompt, 'объясни код');
            assert.equal(body.stream, false);
        });
});

test('aiInferRemote (ollama): вырезает think-блоки reasoning-моделей', async () => {
    const fetchImpl = jsonResponse({ response: '  <think>долго думал</think>\n\nИтог: O(n)  ' });
    await withGateway({ provider: 'ollama' }, fetchImpl, async () => {
        const text = await aiInferRemote('m', 'p');
        assert.equal(text, 'Итог: O(n)');
    });
});

test('aiInferRemote (ollama): если модель не задана в настройках — берёт литерал', async () => {
    let body = null;
    await withGateway({ provider: 'ollama', model: '' }, async (url, opts) => {
        body = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ response: 'ok' }) };
    }, async () => {
        await aiInferRemote('literal-model', 'p');
        assert.equal(body.model, 'literal-model');
    });
});

test('aiInferRemote (ollama): HTTP-ошибка бросает с кодом', async () => {
    await withGateway({ provider: 'ollama' }, jsonResponse({}, false, 500), async () => {
        await assert.rejects(() => aiInferRemote('m', 'p'), /Ollama HTTP 500/);
    });
});

test('aiInferRemote (ollama): пустой ответ → пустая строка', async () => {
    await withGateway({ provider: 'ollama' }, jsonResponse({}), async () => {
        assert.equal(await aiInferRemote('m', 'p'), '');
    });
});

test('aiInferRemote (openai-compatible): Bearer + choices[0].message.content', async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => {
        seen = { url, auth: opts.headers.Authorization, body: JSON.parse(opts.body) };
        return {
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: 'ответ модели' } }] }),
        };
    };
    await withGateway(
        { provider: 'openai-compatible', baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'gpt-x' },
        fetchImpl,
        async () => {
            const text = await aiInferRemote(null, 'вопрос');
            assert.equal(text, 'ответ модели');
            assert.equal(seen.url, 'https://api.test/v1/chat/completions');
            assert.equal(seen.auth, 'Bearer k');
            assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'вопрос' }]);
            assert.equal(seen.body.model, 'gpt-x');
        });
});

test('aiInferRemote (openai-compatible): пустой ответ → пустая строка', async () => {
    await withGateway({ provider: 'openai-compatible', apiKey: '' }, jsonResponse({}), async () => {
        assert.equal(await aiInferRemote(null, 'p'), '');
    });
});

test('aiInferRemote (openai-compatible): HTTP-ошибка бросает', async () => {
    await withGateway({ provider: 'openai-compatible' }, jsonResponse({}, false, 429), async () => {
        await assert.rejects(() => aiInferRemote('m', 'p'), /Gateway HTTP 429/);
    });
});

test('aiInferRemote: mock-провайдер не ходит в сеть и бросает', async () => {
    await withGateway({ provider: 'mock' }, null, async () => {
        await assert.rejects(() => aiInferRemote('m', 'p'), /mock provider/);
    });
});

test('runLatent: pre-fetch AI-промптов и persistent-кэш между запусками', async () => {
    clearAICache();
    let calls = 0;
    const fetchImpl = async () => {
        calls++;
        return { ok: true, status: 200, json: async () => ({ response: 'CACHED-ANSWER' }) };
    };
    const src = 'fn main() { return ai_infer("m", "sum 10 20"); }';
    await withGateway({ provider: 'ollama', model: 'm1' }, fetchImpl, async () => {
        const first = await runLatent(src, true);
        assert.equal(first.result, 'CACHED-ANSWER');
        assert.ok(first.output.some(l => l.includes('[AI] Fetching 1 inference')));
        assert.equal(calls, 1);

        // Второй запуск: ответ уже в persistent-кэше → сеть не нужна
        const second = await runLatent(src, true);
        assert.equal(second.result, 'CACHED-ANSWER');
        assert.ok(second.output.some(l => l.includes('served from cache')));
        assert.equal(calls, 1);
        assert.equal(getAICacheSize(), 1);
        assert.equal(persistentAICache.get(aiCacheKey('ollama', 'm1', 'sum 10 20')),
            'CACHED-ANSWER');
    });
    clearAICache();
});

test('runLatent: ошибка гейтвея → сообщение и mock-fallback', async () => {
    clearAICache();
    const fetchImpl = async () => { throw new Error('network down'); };
    await withGateway({ provider: 'ollama', model: 'm' }, fetchImpl, async () => {
        const { result, output } = await runLatent(
            'fn main() { return ai_infer("m", "analyze 1 2 3"); }', true);
        assert.ok(output.some(l => l.includes('Gateway error: network down')));
        assert.match(result, /detected 3 numeric values/); // mockInfer fallback
        assert.equal(getAICacheSize(), 0); // неудачный ответ не кэшируется
    });
    clearAICache();
});

test('runLatent: без AI pre-fetch не выполняется', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: false, status: 500, json: async () => ({}) }; };
    await withGateway({ provider: 'ollama' }, fetchImpl, async () => {
        const { result } = await runLatent('fn main() { return 1; }', false);
        assert.equal(result, 1);
        assert.equal(called, false);
    });
});

test('runLatent: программа без ai_infer не делает запросов', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: false, status: 500, json: async () => ({}) }; };
    await withGateway({ provider: 'ollama' }, fetchImpl, async () => {
        await runLatent('fn main() { return 2 + 2; }', true);
        assert.equal(called, false);
    });
});

test('repairCode (реальный гейтвей): снимает markdown-ограждения ответа', async () => {
    const fetchImpl = jsonResponse({
        choices: [{ message: { content: '```latent\nfn main() { return 7; }\n```' } }],
    });
    await withGateway({ provider: 'openai-compatible', model: 'm' }, fetchImpl, async () => {
        const fixed = await repairCode('fn main() { return ; }', 'Expected expression', true);
        assert.equal(fixed, 'fn main() { return 7; }');
    });
});

test('repairCode (реальный гейтвей упал): deterministic fallback', async () => {
    const fetchImpl = async () => { throw new Error('gateway offline'); };
    await withGateway({ provider: 'openai-compatible' }, fetchImpl, async () => {
        const fixed = await repairCode('fn main() {\n    print(1);', 'Unexpected EOF', true);
        assert.ok(fixed.trimEnd().endsWith('}'));
    });
});

test('repairCode (реальный гейтвей упал): нечего чинить → null', async () => {
    const fetchImpl = async () => { throw new Error('gateway offline'); };
    await withGateway({ provider: 'openai-compatible' }, fetchImpl, async () => {
        assert.equal(await repairCode('fn main() { return 1; }', 'weird', true), null);
    });
});
