// compiler/loader.js — компиляция и проверка синтаксиса движка №1 + ленивый
// мост к движку №2.
// Единственная ответственность: публичный API compile/checkSyntax/getVersion,
// а также loadWasmCompiler — динамический import() wasm-loader.js при первом
// использовании (движок №2 не попадает в стартовый граф модулей).

import { tokenize } from './lexer.js';
import { Parser } from './parser.js';

let compilerModule = null;
let wasmLoaderPromise = null;

export async function loadCompiler() {
    if (compilerModule) return compilerModule;

    compilerModule = {
        compile: (source) => {
            // Возвращаем исходник как "байткод" — интерпретатор выполнит его напрямую
            return new TextEncoder().encode(source);
        },
        check_syntax: (source) => {
            // Реальная проверка синтаксиса через парсер
            const tokens = tokenize(source);
            const parser = new Parser(tokens);
            parser.parseProgram();
            return true;
        },
        version: () => '0.1.0-js-interp',
    };

    return compilerModule;
}

/**
 * Лениво загружает движок №2 (Rust→WASM). `wasm-loader.js` и сам `.wasm`
 * подключаются только при первом вызове; промис кэшируется.
 * @param {Object} [opts] — пробрасывается в wasm-loader (url/cacheName/imports)
 * @returns {Promise<{compile: Function, source: string, version?: string}|null>}
 */
export async function loadWasmCompiler(opts) {
    if (!wasmLoaderPromise) wasmLoaderPromise = import('./wasm-loader.js');
    const { loadWasmCompiler: load } = await wasmLoaderPromise;
    return load(opts);
}

export async function compile(source) {
    const compiler = await loadCompiler();
    return compiler.compile(source);
}

export async function checkSyntax(source) {
    const compiler = await loadCompiler();
    return compiler.check_syntax(source);
}

export async function getVersion() {
    const compiler = await loadCompiler();
    return compiler.version();
}
