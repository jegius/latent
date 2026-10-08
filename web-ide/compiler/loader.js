// compiler/loader.js — компиляция и проверка синтаксиса движка №1.
// Единственная ответственность: публичный API compile/checkSyntax/getVersion.

import { tokenize } from './lexer.js';
import { Parser } from './parser.js';

let compilerModule = null;

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