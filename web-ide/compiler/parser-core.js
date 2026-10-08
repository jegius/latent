// compiler/parser-core.js — ядро курсора токенов парсера.
// Единственная ответственность: позиция в потоке токенов и низкоуровневые проверки.

import { TokenType } from './token.js';

export class ParserBase {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek(offset = 0) { return this.tokens[this.pos + offset]; }
    advance() { return this.tokens[this.pos++]; }
    check(type, value) {
        const t = this.peek();
        return t.type === type && (value === undefined || t.value === value);
    }
    match(type, value) {
        if (this.check(type, value)) { this.advance(); return true; }
        return false;
    }
    expect(type, value) {
        const t = this.peek();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new Error(`Expected ${value || type} but got '${t.value}' at line ${t.line}`);
        }
        return this.advance();
    }
}

export { TokenType };