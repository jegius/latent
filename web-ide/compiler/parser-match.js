// compiler/parser-match.js — pattern matching, лямбды и select-выражения.
// Единственная ответственность: разбор match/case, паттернов, лямбд и
// select в позиции выражения (миксин прототипа Parser).

import { TokenType } from './token.js';

export const matchMethods = {
    /**
     * Разбирает match-выражение: match expr { case pat: body, default: body, }
     * @returns {object} AST-узел Match
     */
    parseMatch() {
        this.expect(TokenType.Keyword, 'match');
        const scrutinee = this.parseExpression();
        this.expect(TokenType.Punct, '{');
        const arms = [];
        let hasDefault = false;
        while (!this.check(TokenType.Punct, '}') && !this.check(TokenType.EOF)) {
            this.match(TokenType.Keyword, 'case');
            let pattern;
            if (this.check(TokenType.Keyword, 'default')) {
                this.advance();
                pattern = { kind: 'Wildcard' };
                hasDefault = true;
            } else {
                pattern = this.parsePattern();
            }
            this.expect(TokenType.Punct, ':');
            const body = this.check(TokenType.Punct, '{')
                ? { type: 'BlockExpr', block: this.parseBlock() }
                : this.parseExpression();
            arms.push({ pattern, body });
            // Разделитель необязателен перед '}' и перед следующей веткой.
            if (!this.match(TokenType.Punct, ',') && !this.match(TokenType.Punct, ';')) {
                if (!this.check(TokenType.Punct, '}')
                    && !this.check(TokenType.Keyword, 'case')
                    && !this.check(TokenType.Keyword, 'default')) break;
            }
        }
        this.expect(TokenType.Punct, '}');
        return { type: 'Match', scrutinee, arms, hasDefault };
    },

    /**
     * Разбирает лямбду: fn(x, y) => expr  или  fn(x) { ... }.
     * @returns {object} Lambda-узел
     */
    parseLambda() {
        this.expect(TokenType.Keyword, 'fn');
        this.expect(TokenType.Punct, '(');
        const params = [];
        if (!this.check(TokenType.Punct, ')')) {
            do {
                const p = this.peek();
                if (p.type !== TokenType.Ident && p.type !== TokenType.Keyword) {
                    throw new Error(`Expected lambda parameter at line ${p.line}`);
                }
                params.push(this.advance().value);
                if (this.match(TokenType.Punct, ':')) this.parseTypeAnnotation();
            } while (this.match(TokenType.Punct, ','));
        }
        this.expect(TokenType.Punct, ')');
        if (this.match(TokenType.Op, '=>')) {
            return { type: 'Lambda', params, body: this.parseExpression(), isBlock: false };
        }
        return { type: 'Lambda', params, body: this.parseBlock(), isBlock: true };
    },

    /**
     * Разбирает select как выражение: значение — тело выигравшей ветки.
     * @returns {object} SelectExpr-узел
     */
    parseSelectExpr() {
        const stmt = this.parseSelect();
        return { type: 'SelectExpr', arms: stmt.arms, defaultBody: stmt.defaultBody };
    },

    /**
     * Разбирает паттерн match: литерал, _, идентификатор-связка,
     * конструктор Ok(x)/Err(e) или default.
     * @returns {object} паттерн
     */
    parsePattern() {
        const t = this.peek();
        if (t.type === TokenType.Number) { this.advance(); return { kind: 'Literal', value: t.value }; }
        if (t.type === TokenType.String) { this.advance(); return { kind: 'Literal', value: t.value }; }
        if (t.type === TokenType.Keyword && t.value === 'true') { this.advance(); return { kind: 'Literal', value: true }; }
        if (t.type === TokenType.Keyword && t.value === 'false') { this.advance(); return { kind: 'Literal', value: false }; }
        if (t.type === TokenType.Keyword && t.value === 'null') { this.advance(); return { kind: 'Literal', value: null }; }
        if (t.type === TokenType.Ident && t.value === '_') { this.advance(); return { kind: 'Wildcard' }; }
        if (t.type === TokenType.Ident || t.type === TokenType.Keyword) {
            this.advance();
            if (this.match(TokenType.Punct, '(')) {
                const args = [];
                if (!this.check(TokenType.Punct, ')')) {
                    do { args.push(this.parsePattern()); } while (this.match(TokenType.Punct, ','));
                }
                this.expect(TokenType.Punct, ')');
                return { kind: 'Constructor', name: t.value, args };
            }
            return { kind: 'Identifier', name: t.value };
        }
        throw new Error(`Invalid match pattern '${t.value}' at line ${t.line}`);
    },
};