// compiler/parser-expressions.js — разбор выражений (миксин прототипа Parser).
// Единственная ответственность: приоритетный спуск выражений и первичные формы.
// match/лямбды/паттерны — в parser-match.js.

import { TokenType, SOFT_KEYWORDS } from './token.js';

export const expressionMethods = {
    // Приоритеты: <- (send) < || < && < ==/!= < </<=/>/>= < +/- < *//% < unary < call/index < primary
    parseExpression() {
        let left = this.parseOr();
        while (this.match(TokenType.Op, '<-')) {
            left = { type: 'Send', channel: left, value: this.parseOr() };
        }
        return left;
    },

    /**
     * Пробует пропустить generic-аргументы вида `<int, [float]>`.
     * При неудаче позиция восстанавливается, возвращается false.
     * @returns {boolean}
     */
    skipTypeArgs() {
        const start = this.pos;
        if (!this.match(TokenType.Op, '<')) return false;
        try {
            let depth = 1;
            while (depth > 0) {
                const t = this.peek();
                if (!t || t.type === TokenType.EOF) { this.pos = start; return false; }
                if (t.type === TokenType.Op && t.value === '<') depth++;
                else if (t.type === TokenType.Op && t.value === '>') depth--;
                else if (t.type === TokenType.Punct && [',', '[', ']'].includes(t.value)) { /* ок */ }
                else if (t.type === TokenType.Ident || t.type === TokenType.Keyword
                    || t.type === TokenType.Number) { /* ок */ }
                else { this.pos = start; return false; }
                this.advance();
            }
            return true;
        } catch {
            this.pos = start;
            return false;
        }
    },

    parseOr() {
        let left = this.parseAnd();
        while (this.match(TokenType.Op, '||')) {
            left = { type: 'Binary', op: '||', left, right: this.parseAnd() };
        }
        return left;
    },

    parseAnd() {
        let left = this.parseEquality();
        while (this.match(TokenType.Op, '&&')) {
            left = { type: 'Binary', op: '&&', left, right: this.parseEquality() };
        }
        return left;
    },

    parseEquality() {
        let left = this.parseComparison();
        while (true) {
            if (this.match(TokenType.Op, '==')) {
                left = { type: 'Binary', op: '==', left, right: this.parseComparison() };
            } else if (this.match(TokenType.Op, '!=')) {
                left = { type: 'Binary', op: '!=', left, right: this.parseComparison() };
            } else break;
        }
        return left;
    },

    parseComparison() {
        let left = this.parseAdditive();
        while (true) {
            if (this.match(TokenType.Op, '<')) {
                left = { type: 'Binary', op: '<', left, right: this.parseAdditive() };
            } else if (this.match(TokenType.Op, '<=')) {
                left = { type: 'Binary', op: '<=', left, right: this.parseAdditive() };
            } else if (this.match(TokenType.Op, '>')) {
                left = { type: 'Binary', op: '>', left, right: this.parseAdditive() };
            } else if (this.match(TokenType.Op, '>=')) {
                left = { type: 'Binary', op: '>=', left, right: this.parseAdditive() };
            } else break;
        }
        return left;
    },

    parseAdditive() {
        let left = this.parseMultiplicative();
        while (true) {
            if (this.match(TokenType.Op, '+')) {
                left = { type: 'Binary', op: '+', left, right: this.parseMultiplicative() };
            } else if (this.match(TokenType.Op, '-')) {
                left = { type: 'Binary', op: '-', left, right: this.parseMultiplicative() };
            } else break;
        }
        return left;
    },

    parseMultiplicative() {
        let left = this.parseUnary();
        while (true) {
            if (this.match(TokenType.Op, '*')) {
                left = { type: 'Binary', op: '*', left, right: this.parseUnary() };
            } else if (this.match(TokenType.Op, '/')) {
                left = { type: 'Binary', op: '/', left, right: this.parseUnary() };
            } else if (this.match(TokenType.Op, '%')) {
                left = { type: 'Binary', op: '%', left, right: this.parseUnary() };
            } else break;
        }
        return left;
    },

    parseUnary() {
        if (this.match(TokenType.Op, '-')) {
            return { type: 'Unary', op: '-', operand: this.parseUnary() };
        }
        if (this.match(TokenType.Op, '!')) {
            return { type: 'Unary', op: '!', operand: this.parseUnary() };
        }
        // await — унарный префиксный оператор, связывает как унарный минус
        if (this.check(TokenType.Keyword, 'await')) {
            this.advance();
            return { type: 'Await', expr: this.parseUnary() };
        }
        return this.parsePostfix();
    },

    parsePostfix() {
        let expr = this.parsePrimary();
        // Опциональные type-аргументы: channel<int>(), tensor<float>()
        if (expr.type === 'Ident' && this.check(TokenType.Op, '<')) {
            const save = this.pos;
            if (this.skipTypeArgs()) {
                // ok — аргументы типов пропущены
            } else {
                this.pos = save;
            }
        }
        while (true) {
            if (this.match(TokenType.Punct, '(')) {
                // Вызов функции
                const args = [];
                if (!this.check(TokenType.Punct, ')')) {
                    do { args.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
                }
                this.expect(TokenType.Punct, ')');
                expr = { type: 'Call', callee: expr, args };
            } else if (this.match(TokenType.Punct, '[')) {
                // Индексация
                const index = this.parseExpression();
                this.expect(TokenType.Punct, ']');
                expr = { type: 'Index', object: expr, index };
            } else if (this.match(TokenType.Punct, '.')) {
                // Доступ к полю/методу
                const name = this.expect(TokenType.Ident).value;
                expr = { type: 'Member', object: expr, name };
            } else break;
        }
        return expr;
    },

    parsePrimary() {
        const t = this.peek();

        if (t.type === TokenType.Number) { this.advance(); return { type: 'Number', value: t.value }; }
        if (t.type === TokenType.String) { this.advance(); return { type: 'String', value: t.value }; }
        if (t.type === TokenType.Keyword && t.value === 'true') { this.advance(); return { type: 'Bool', value: true }; }
        if (t.type === TokenType.Keyword && t.value === 'false') { this.advance(); return { type: 'Bool', value: false }; }
        if (t.type === TokenType.Keyword && t.value === 'null') { this.advance(); return { type: 'Null' }; }

        // this — ссылка на текущий экземпляр класса
        if (t.type === TokenType.Keyword && t.value === 'this') {
            this.advance();
            return { type: 'This' };
        }

        // match-выражение
        if (t.type === TokenType.Keyword && t.value === 'match') {
            return this.parseMatch();
        }

        // select-выражение (как выражение — значение ветки)
        if (t.type === TokenType.Keyword && t.value === 'select') {
            return this.parseSelectExpr();
        }

        // лямбда: fn(x, y) => expr  |  fn(x) { ... }
        if (t.type === TokenType.Keyword && t.value === 'fn') {
            return this.parseLambda();
        }

        // new ClassName(args) — создание экземпляра
        if (t.type === TokenType.Keyword && t.value === 'new') {
            this.advance();
            const className = this.expect(TokenType.Ident).value;
            const args = [];
            if (this.match(TokenType.Punct, '(')) {
                if (!this.check(TokenType.Punct, ')')) {
                    do { args.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
                }
                this.expect(TokenType.Punct, ')');
            }
            return { type: 'New', className, args };
        }

        if (t.type === TokenType.Ident) { this.advance(); return { type: 'Ident', name: t.value }; }

        // Встроенные функции-ключевые слова: channel(), tensor(), semantic(),
        // assert(), assert_eq(), snapshot(), ai_contract(), enforce_contract(),
        // а также «мягкие» ключевые слова в роли идентификаторов.
        if (t.type === TokenType.Keyword && (t.value === 'channel' || SOFT_KEYWORDS.has(t.value))) {
            this.advance();
            return { type: 'Ident', name: t.value };
        }

        if (this.match(TokenType.Punct, '(')) {
            const expr = this.parseExpression();
            this.expect(TokenType.Punct, ')');
            return expr;
        }

        if (this.match(TokenType.Punct, '[')) {
            // Литерал массива
            const elements = [];
            if (!this.check(TokenType.Punct, ']')) {
                do { elements.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
            }
            this.expect(TokenType.Punct, ']');
            return { type: 'Array', elements };
        }

        throw new Error(`Unexpected token '${t.value}' at line ${t.line}`);
    },
};