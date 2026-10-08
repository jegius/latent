// compiler/parser.js — рекурсивный парсер языка Latent.
// Единственная ответственность: сборка Parser из ядра и миксинов разбора.
// Алгоритм разнесён по parser-core / parser-declarations / parser-statements /
// parser-expressions / parser-match.

import { ParserBase } from './parser-core.js';
import { expressionMethods } from './parser-expressions.js';
import { matchMethods } from './parser-match.js';
import { declarationMethods } from './parser-declarations.js';
import { statementMethods } from './parser-statements.js';
import { concurrencyMethods } from './parser-concurrency.js';

export class Parser extends ParserBase {}

Object.assign(
    Parser.prototype,
    expressionMethods,
    matchMethods,
    declarationMethods,
    statementMethods,
    concurrencyMethods,
);