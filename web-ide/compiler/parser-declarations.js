// compiler/parser-declarations.js — объявления верхнего уровня (миксин Parser).
// Единственная ответственность: программа, функции (async), классы (OOP),
// декораторы, аннотации типов и блоки.

import { TokenType } from './token.js';

export const declarationMethods = {
    parseProgram() {
        const functions = {};
        const classes = {};
        const tests = [];
        while (!this.check(TokenType.EOF)) {
            const decl = this.parseDeclaration();
            this.registerDeclaration(decl, functions, classes, tests);
        }
        return { type: 'Program', functions, classes, tests };
    },

    /**
     * Разбирает объявление верхнего уровня или инструкцию.
     * Декораторы (@ai_contract/@test/@forall) оборачивают цель.
     * @returns {object} узел
     */
    parseDeclaration() {
        if (this.check(TokenType.Punct, '@')) return this.parseDecorator();
        if (this.check(TokenType.Keyword, 'class')) return this.parseClass();
        if (this.isAsyncFn()) return this.parseFunction();
        if (this.check(TokenType.Keyword, 'fn')) return this.parseFunction();
        return this.parseStatement();
    },

    /** Регистрирует верхнеуровневое объявление в соответствующих таблицах. */
    registerDeclaration(decl, functions, classes, tests) {
        if (decl.type === 'Decorator') {
            this.registerDeclaration(decl.target, functions, classes, tests);
            return;
        }
        if (decl.type === 'Function') functions[decl.name] = decl;
        else if (decl.type === 'Class') classes[decl.name] = decl;
        else if (decl.type === 'Test') tests.push(decl);
    },

    /** true, если текущая позиция — `async fn`. */
    isAsyncFn() {
        return this.check(TokenType.Keyword, 'async')
            && this.peek(1) && this.peek(1).type === TokenType.Keyword
            && this.peek(1).value === 'fn';
    },

    /**
     * @decorator(args) target — декоратор над объявлением/функцией.
     * Используется для @ai_contract, @test, @forall.
     */
    parseDecorator() {
        this.expect(TokenType.Punct, '@');
        const nameTok = this.peek();
        if (nameTok.type !== TokenType.Ident && nameTok.type !== TokenType.Keyword) {
            throw new Error(`Expected decorator name at line ${nameTok.line}`);
        }
        this.advance();
        const name = nameTok.value;
        const args = [];
        if (this.match(TokenType.Punct, '(')) {
            if (!this.check(TokenType.Punct, ')')) {
                do { args.push(this.parseExpression()); } while (this.match(TokenType.Punct, ','));
            }
            this.expect(TokenType.Punct, ')');
        }
        const target = this.parseDeclaration();
        return { type: 'Decorator', name, args, target };
    },

    /**
     * Разбирает функцию: [async] fn name(params) [-> Type] { body }.
     * @returns {object} Function-узел
     */
    parseFunction() {
        let isAsync = false;
        if (this.check(TokenType.Keyword, 'async')) { this.advance(); isAsync = true; }
        this.expect(TokenType.Keyword, 'fn');
        const name = this.expect(TokenType.Ident).value;
        this.expect(TokenType.Punct, '(');
        const params = [];
        if (!this.check(TokenType.Punct, ')')) {
            do {
                const paramName = this.expect(TokenType.Ident).value;
                if (this.match(TokenType.Punct, ':')) {
                    this.parseTypeAnnotation();
                }
                params.push(paramName);
            } while (this.match(TokenType.Punct, ','));
        }
        this.expect(TokenType.Punct, ')');
        if (this.match(TokenType.Op, '->')) {
            this.parseTypeAnnotation();
        }
        const body = this.parseBlock();
        return { type: 'Function', name, params, body, isAsync };
    },

    /**
     * Разбирает класс: class Name { field: Type; method(...) { ... } }.
     * Поля — без значения, методы — обычные функции.
     * @returns {object} Class-узел
     */
    parseClass() {
        this.expect(TokenType.Keyword, 'class');
        const name = this.expect(TokenType.Ident).value;
        this.expect(TokenType.Punct, '{');
        const fields = [];
        const methods = [];
        while (!this.check(TokenType.Punct, '}') && !this.check(TokenType.EOF)) {
            // Метод: [async] fn name(...) { ... }  (допускаем и без fn)
            if (this.isAsyncFn() || this.check(TokenType.Keyword, 'fn')
                || (this.check(TokenType.Ident) && this.peek(1)
                    && this.peek(1).type === TokenType.Punct && this.peek(1).value === '(')) {
                methods.push(this.parseClassMethod());
                continue;
            }
            // Поле: name: Type;
            const fieldName = this.expect(TokenType.Ident).value;
            let type = null;
            if (this.match(TokenType.Punct, ':')) type = this.parseTypeAnnotation();
            this.match(TokenType.Punct, ';');
            fields.push({ name: fieldName, type });
        }
        this.expect(TokenType.Punct, '}');
        return { type: 'Class', name, fields, methods };
    },

    /** Разбирает метод класса (с необязательными async / fn). */
    parseClassMethod() {
        let isAsync = false;
        if (this.check(TokenType.Keyword, 'async')) { this.advance(); isAsync = true; }
        if (this.check(TokenType.Keyword, 'fn')) this.advance();
        const name = this.expect(TokenType.Ident).value;
        this.expect(TokenType.Punct, '(');
        const params = [];
        if (!this.check(TokenType.Punct, ')')) {
            do {
                const pName = this.expect(TokenType.Ident).value;
                if (this.match(TokenType.Punct, ':')) this.parseTypeAnnotation();
                params.push(pName);
            } while (this.match(TokenType.Punct, ','));
        }
        this.expect(TokenType.Punct, ')');
        if (this.match(TokenType.Op, '->')) this.parseTypeAnnotation();
        const body = this.parseBlock();
        return { type: 'Function', name, params, body, isAsync };
    },

    /** Разбор аннотации типа: ident, [T], (T, T), Name<T>. */
    parseTypeAnnotation() {
        if (this.match(TokenType.Punct, '[')) {
            this.parseTypeAnnotation();
            this.expect(TokenType.Punct, ']');
            return;
        }
        if (this.match(TokenType.Punct, '(')) {
            if (!this.check(TokenType.Punct, ')')) {
                do { this.parseTypeAnnotation(); } while (this.match(TokenType.Punct, ','));
            }
            this.expect(TokenType.Punct, ')');
            return;
        }
        if (this.check(TokenType.Ident) || this.check(TokenType.Keyword)) {
            this.advance();
            if (this.match(TokenType.Op, '<')) {
                do { this.parseTypeAnnotation(); } while (this.match(TokenType.Punct, ','));
                this.expect(TokenType.Op, '>');
            }
            return;
        }
        throw new Error(`Invalid type annotation at line ${this.peek().line}`);
    },

    parseBlock() {
        this.expect(TokenType.Punct, '{');
        const statements = [];
        while (!this.check(TokenType.Punct, '}') && !this.check(TokenType.EOF)) {
            statements.push(this.parseDeclaration());
        }
        this.expect(TokenType.Punct, '}');
        return { type: 'Block', statements };
    },
};