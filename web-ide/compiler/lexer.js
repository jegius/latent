// compiler/lexer.js — лексер языка Latent.
// Единственная ответственность: превращение исходника в поток токенов.

import { TokenType, KEYWORDS } from './token.js';

export function tokenize(source) {
    const tokens = [];
    let i = 0;
    let line = 1;

    const peek = (offset = 0) => source[i + offset];
    const advance = () => source[i++];

    while (i < source.length) {
        const ch = source[i];

        if (ch === '\n') { line++; i++; continue; }
        if (/\s/.test(ch)) { i++; continue; }

        // Комментарии
        if (ch === '/' && peek(1) === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }

        // Числа
        if (/\d/.test(ch)) {
            let num = '';
            while (i < source.length && /[\d.]/.test(source[i])) num += advance();
            tokens.push({ type: TokenType.Number, value: parseFloat(num), line });
            continue;
        }

        // Строки
        if (ch === '"') {
            advance(); // opening quote
            let str = '';
            while (i < source.length && source[i] !== '"') {
                if (source[i] === '\\') {
                    advance();
                    const esc = advance();
                    if (esc === 'n') str += '\n';
                    else if (esc === 't') str += '\t';
                    else str += esc;
                } else {
                    str += advance();
                }
            }
            advance(); // closing quote
            tokens.push({ type: TokenType.String, value: str, line });
            continue;
        }

        // Идентификаторы и ключевые слова
        if (/[a-zA-Z_]/.test(ch)) {
            let word = '';
            while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) word += advance();
            const type = KEYWORDS.has(word) ? TokenType.Keyword : TokenType.Ident;
            tokens.push({ type, value: word, line });
            continue;
        }

        // Трёхсимвольные операторы
        const three = source.slice(i, i + 3);
        if (three === '::') { /* обрабатывается как двухсимвольный ниже */ }

        // Двухсимвольные операторы
        const two = source.slice(i, i + 2);
        if (['==', '!=', '<=', '>=', '&&', '||', '->', '=>', '<-'].includes(two)) {
            tokens.push({ type: TokenType.Op, value: two, line });
            i += 2;
            continue;
        }

        // Односимвольные операторы
        if ('+-*/%<>=!'.includes(ch)) {
            tokens.push({ type: TokenType.Op, value: ch, line });
            i++;
            continue;
        }

        // Пунктуация
        if ('(){}[];,:.@'.includes(ch)) {
            tokens.push({ type: TokenType.Punct, value: ch, line });
            i++;
            continue;
        }

        throw new Error(`Unexpected character '${ch}' at line ${line}`);
    }

    tokens.push({ type: TokenType.EOF, value: null, line });
    return tokens;
}