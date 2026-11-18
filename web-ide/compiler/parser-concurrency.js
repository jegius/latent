// compiler/parser-concurrency.js — select/yield (миксин прототипа Parser).
// Единственная ответственность: разбор construct'ов конкурентности.

import { TokenType } from './token.js';

export const concurrencyMethods = {
    /**
     * select { case val <- ch: { ... } default: { ... } }.
     * Ждёт готовности одного из каналов.
     */
    parseSelect() {
        this.expect(TokenType.Keyword, 'select');
        this.expect(TokenType.Punct, '{');
        const arms = [];
        let defaultBody = null;
        while (!this.check(TokenType.Punct, '}') && !this.check(TokenType.EOF)) {
            this.match(TokenType.Keyword, 'case');
            if (this.check(TokenType.Keyword, 'default')) {
                this.advance();
                this.expect(TokenType.Punct, ':');
                defaultBody = this.parseBranchBody();
            } else {
                arms.push(this.parseSelectArm());
            }
            this.match(TokenType.Punct, ',');
            this.match(TokenType.Punct, ';');
        }
        this.expect(TokenType.Punct, '}');
        this.match(TokenType.Punct, ';');
        return { type: 'Select', arms, defaultBody };
    },
    
    /** Ветка select: `var? <- channel: body`. */
    parseSelectArm() {
        let varName = null;
        if (this.check(TokenType.Ident) && this.peek(1)
            && this.peek(1).type === TokenType.Op && this.peek(1).value === '<-') {
            varName = this.advance().value;
        }
        this.expect(TokenType.Op, '<-');
        const channel = this.parseExpression();
        this.expect(TokenType.Punct, ':');
        return { varName, channel, body: this.parseBranchBody() };
    },
    
    /** Тело ветки: { ... } или одиночная инструкция. */
    parseBranchBody() {
        return this.check(TokenType.Punct, '{')
            ? this.parseBlock()
            : { type: 'Block', statements: [this.parseStatement()] };
    },
    
};
