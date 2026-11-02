// vite.config.js — production-сборка Latent Web IDE с code splitting.
//
// Сборка опциональна: без неё IDE работает как набор статических ES-модулей
// (`python -m http.server` в web-ide/). `build:chunks` нужен для GitHub Pages и
// для проектов, которые встраивают IDE/движок в свой бандл.
//
// Стратегия:
//   base: './'        — ассеты и dynamic import() резолвятся относительно
//                       index.html, поэтому playground работает из подкаталога
//                       (/latent/playground/) и из любого префикса;
//   outDir: 'dist'    — собранные файлы рядом с исходниками, не коммитятся;
//   manualChunks      — engine2 / ai / editor / examples / core (+ vendor);
//   dynamic import()  — loader.js (wasm), lazy-ai.js (провайдеры/repair),
//                       examples/loader.js (манифест и .lat) грузятся по
//                       требованию, а не на старте.
//
// `new URL('../compiler.wasm', import.meta.url)` в compiler/wasm-loader.js
// заставляет Vite эмитить .wasm отдельным хешированным ассетом.

import { defineConfig } from 'vite';

/**
 * Раскладывает модули по чанкам. Возвращает undefined — модуль остаётся в
 * чанке по умолчанию (entry/shared).
 * @param {string} id — абсолютный id модуля (posix-разделители)
 * @returns {string|undefined}
 */
function chunkName(id) {
    const p = id.replace(/\\/g, '/');

    // Движок №2: загрузчик + сам wasm-ассет.
    if (p.includes('/compiler/wasm-loader.js') || /\.wasm(\?|$)/.test(p)) {
        return 'engine2';
    }
    // AI: конфигурация, гейтвей, mock-помощники, self-repair и чистые
    // помощники repair-core. Они нужны и core (run.js), поэтому держим все
    // AI-модули в одном чанке — иначе получается цикл ai ↔ core.
    // lazy-ai.js сюда НЕ входит — это мост, он должен остаться в core.
    if (p.includes('/compiler/ai-')
        || p.includes('/compiler/interpreter-ai.js')
        || p.includes('/compiler/repair.js')
        || p.includes('/compiler/repair-core.js')) {
        return 'ai';
    }
    // Примеры: манифест и исходники .lat (raw-модули) — грузятся лениво.
    // loader.js/index.js, наоборот, нужны на старте и остаются в core.
    if (p.includes('/examples/manifest.js')
        || (p.includes('/examples/') && /\.lat(\?|$)/.test(p))) {
        return 'examples';
    }
    // Редактор: canvas-рендер, ввод, метрики, навигация.
    if (p.includes('/views/editor/')) {
        return 'editor';
    }
    // Ядро: лексер, парсер, интерпретатор, среда, значения, run.
    if (p.includes('/compiler/')) {
        return 'core';
    }
    // Внешние зависимости (появятся при подключении плагинов/библиотек).
    if (p.includes('/node_modules/')) {
        return 'vendor';
    }
    return undefined;
}

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true,
        // Не инлайнить мелкие ассеты: .wasm и .lat должны оставаться файлами.
        assetsInlineLimit: 0,
        rollupOptions: {
            output: {
                manualChunks: chunkName,
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
    server: { port: 5173, open: false },
    preview: { port: 4173 },
});
