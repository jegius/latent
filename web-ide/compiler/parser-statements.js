// compiler/parser-statements.js — разбор инструкций (миксин прототипа Parser).
// Единственная ответственность: управление (let/if/while/for/for-in/return/
// print), присваивания, spawn/select/yield и тестовые конструкции.
//
// Объявления верхнего уровня (fn/class/декораторы) — в parser-declarations.js.

import { TokenType } from './token.js';

export const statementMethods = {
    parseStatement() {
        if (this.check(TokenType.Keyword, 'let')) return this.parseLet();
        if (this.check(TokenType.Keyword, 'if')) return this.parseIf();
        if (this.check(TokenType.Keyword, 'while')) return this.parseWhile();
        if (this.check(TokenType.Keyword, 'for')) return this.parseFor();
        if (this.check(TokenType.Keyword, 'return')) return this.parseReturn();
        if (this.check(TokenType.Keyword, 'print')) return this.parsePrint();
        if (this.check(TokenType.Keyword, 'spawn')) return this.parseSpawn();
        if (this.check(TokenType.Keyword, 'select')) return this.parseSelect();
        if (this.check(TokenType.Keyword, 'yield')) {
            this.advance();
            this.match(TokenType.Punct, ';');
            return { type: 'Yield' };
        }
        if (this.isTestDecl()) return this.parseTest();
        if (this.check(TokenType.Keyword, 'assert') || this.check(TokenType.Keyword, 'assert_eq')) {
            return this.parseAssert();
        }
        return this.parseAssignOrExpr();
    },

    /** Присваивание (name=, this.field=, arr[i]=) или выражение-инструкция. */
    parseAssignOrExpr() {
        if (this.check(TokenType.Ident) || this.check(TokenType.Keyword, 'this')) {
            const assign = this.tryParseAssign();
            if (assign) return assign;
        }
        const expr = this.parseExpression();
        this.match(TokenType.Punct, ';');
        return { type: 'ExprStmt', expr };
    },

    /** Пытается разобрать присваивание; иначе null (позиция не меняется). */
    tryParseAssign() {
        const next = this.peek(1);
        const next2 = this.peek(2);
        if (next.type === TokenType.Op && next.value === '=') {
            const name = this.advance().value;
            this.advance();
            const value = this.parseExpression();
            this.match(TokenType.Punct, ';');
            return { type: 'Assign', name, value };
        }
        if (next.type === TokenType.Punct && next.value === '.'
            && next2 && next2.type === TokenType.Ident) {
            const afterField = this.peek(3);
            if (afterField && afterField.type === TokenType.Op && afterField.value === '=') {
                const object = this.advance().value;
                this.advance();
                const field = this.advance().value;
                this.advance();
                const value = this.parseExpression();
                this.match(TokenType.Punct, ';');
                return { type: 'FieldAssign', object, field, value };
            }
        }
        if (next.type === TokenType.Punct && next.value === '[') {
            const idxAssign = this.tryParseIndexAssign();
            if (idxAssign) return idxAssign;
        }
        return null;
    },

    /** arr[i] = value → IndexAssign, если за ']' идёт '='. */
    tryParseIndexAssign() {
        let depth = 0;
        let j = this.pos + 1;
        while (j < this.tokens.length) {
            const tk = this.tokens[j];
            if (tk.type === TokenType.Punct && tk.value === '[') depth++;
            if (tk.type === TokenType.Punct && tk.value === ']') {
                depth--;
                if (depth === 0) {
                    const after = this.tokens[j + 1];
                    if (after && after.type === TokenType.Op && after.value === '=') {
                        const object = this.parsePostfix();
                        this.expect(TokenType.Op, '=');
                        const value = this.parseExpression();
                        this.match(TokenType.Punct, ';');
                        return { type: 'IndexAssign', object, value };
                    }
                    return null;
                }
            }
            j++;
        }
        return null;
    },

    parseLet() {
        this.expect(TokenType.Keyword, 'let');
        const nameTok = this.peek();
        if (nameTok.type !== TokenType.Ident && nameTok.type !== TokenType.Keyword) {
            throw new Error(`Expected identifier at line ${nameTok.line}`);
        }
        const name = this.advance().value;
        if (this.match(TokenType.Punct, ':')) {
            this.parseTypeAnnotation();
        }
        this.expect(TokenType.Op, '=');
        const value = this.parseExpression();
        this.match(TokenType.Punct, ';');
        return { type: 'Let', name, value };
    },

    parseIf() {
        this.expect(TokenType.Keyword, 'if');
        this.expect(TokenType.Punct, '(');
        const condition = this.parseExpression();
        this.expect(TokenType.Punct, ')');
        const thenBranch = this.parseBlock();
        let elseBranch = null;
        if (this.match(TokenType.Keyword, 'else')) {
            elseBranch = this.check(TokenType.Keyword, 'if')
                ? this.parseIf() : this.parseBlock();
        }
        return { type: 'If', condition, thenBranch, elseBranch };
    },

    parseWhile() {
        this.expect(TokenType.Keyword, 'while');
        this.expect(TokenType.Punct, '(');
        const condition = this.parseExpression();
        this.expect(TokenType.Punct, ')');
        const body = this.parseBlock();
        return { type: 'While', condition, body };
    },

    parseFor() {
        this.expect(TokenType.Keyword, 'for');
        this.expect(TokenType.Punct, '(');
        const forIn = this.tryParseForIn();
        if (forIn) return forIn;
        // C-стиль: for (let i = 0; i < n; i = i + 1)
        const init = this.parseLet();
        const condition = this.parseExpression();
        this.expect(TokenType.Punct, ';');
        let update;
        if (this.check(TokenType.Ident) && this.peek(1).type === TokenType.Op && this.peek(1).value === '=') {
            const name = this.advance().value;
            this.advance();
            update = { type: 'Assign', name, value: this.parseExpression() };
        } else {
            update = this.parseExpression();
        }
        this.expect(TokenType.Punct, ')');
        const body = this.parseBlock();
        return { type: 'For', init, condition, update, body };
    },

    /** for (let x in items) / for (x in items) → ForEach, иначе null. */
    tryParseForIn() {
        if (this.check(TokenType.Keyword, 'let') && this.peek(2)
            && this.peek(2).type === TokenType.Keyword && this.peek(2).value === 'in') {
            this.advance();
            const varName = this.advance().value;
            this.advance();
            const iterable = this.parseExpression();
            this.expect(TokenType.Punct, ')');
            return { type: 'ForEach', var: varName, iterable, body: this.parseBlock() };
        }
        if (this.check(TokenType.Ident) && this.peek(1)
            && this.peek(1).type === TokenType.Keyword && this.peek(1).value === 'in') {
            const varName = this.advance().value;
            this.advance();
            const iterable = this.parseExpression();
            this.expect(TokenType.Punct, ')');
            return { type: 'ForEach', var: varName, iterable, body: this.parseBlock() };
        }
        return null;
    },

    parseReturn() {
        this.expect(TokenType.Keyword, 'return');
        if (this.match(TokenType.Punct, ';')) return { type: 'Return', value: { type: 'Null' } };
        if (this.check(TokenType.Punct, '}')) return { type: 'Return', value: { type: 'Null' } };
        const value = this.parseExpression();
        this.match(TokenType.Punct, ';');
        return { type: 'Return', value };
    },

    parsePrint() {
        this.expect(TokenType.Keyword, 'print');
        this.expect(TokenType.Punct, '(');
        const args = [this.parseExpression()];
        while (this.match(TokenType.Punct, ',')) {
            args.push(this.parseExpression());
        }
        this.expect(TokenType.Punct, ')');
        this.match(TokenType.Punct, ';');
        return { type: 'Print', args };
    },

    parseSpawn() {
        this.expect(TokenType.Keyword, 'spawn');
        // spawn { ... } — анонимная горутина
        if (this.check(TokenType.Punct, '{')) {
            return { type: 'SpawnBlock', block: this.parseBlock() };
        }
        const call = this.parsePostfix();
        if (call.type !== 'Call') {
            throw new Error(`spawn requires a function call or block at line ${this.peek().line}`);
        }
        this.match(TokenType.Punct, ';');
        return { type: 'Spawn', call };
    },

    /** true, если текущая позиция — объявление теста: test "name" { ... }. */
    isTestDecl() {
        if (!this.check(TokenType.Keyword, 'test')) return false;
        const n = this.peek(1);
        if (!n) return false;
        if (n.type === TokenType.String) return true;
        return (n.type === TokenType.Ident || n.type === TokenType.Keyword)
            && this.peek(2) && this.peek(2).type === TokenType.Punct && this.peek(2).value === '{';
    },

    /** test "name" { ... } — тестовый блок. */
    parseTest() {
        this.expect(TokenType.Keyword, 'test');
        const nameTok = this.peek();
        let name;
        if (nameTok.type === TokenType.String) { name = nameTok.value; this.advance(); }
        else { name = this.advance().value; }
        const body = this.parseBlock();
        return { type: 'Test', name, body };
    },

    /**
     * assert(cond, msg?) или assert_eq(a, b, msg?) — проверка в тестах.
     * Поддерживает и форму без скобок: assert cond;
     */
    parseAssert() {
        const isEq = this.check(TokenType.Keyword, 'assert_eq');
        this.advance();
        const args = [];
        if (this.match(TokenType.Punct, '(')) {
            if (!this.check(TokenType.Punct, ')')) {
                do { args.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
            }
            this.expect(TokenType.Punct, ')');
        } else {
            args.push(this.parseExpression());
        }
        this.match(TokenType.Punct, ';');
        return { type: isEq ? 'AssertEq' : 'Assert', args };
    },
};