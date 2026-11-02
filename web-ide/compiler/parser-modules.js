// compiler/parser-modules.js — файловые модули и enum (миксин Parser).
// Единственная ответственность: разбор `import {…} from "…"`, `export` и
// `enum Name { Variant, Variant(T, …) }`.
//
// Import/export разрешены только на верхнем уровне файла-модуля: внутри
// функции/класса парсер сообщает об ошибке (blockDepth > 0).

import { TokenType } from './token.js';

export const moduleMethods = {
    /**
     * `import { a, b as c } from "./path.lat";` или
     * `import "./path.lat";` (подключение ради побочного эффекта).
     * @returns {object} Import-узел
     */
    parseImportDeclaration() {
        const line = this.peek().line;
        if (this.blockDepth > 0) {
            throw new Error(`Import declarations are only allowed at top level (line ${line})`);
        }
        this.expect(TokenType.Keyword, 'import');

        // import "./file.lat";
        if (this.check(TokenType.String)) {
            const source = this.advance().value;
            this.match(TokenType.Punct, ';');
            return { type: 'Import', source, specifiers: [], line };
        }

        this.expect(TokenType.Punct, '{');
        const specifiers = [];
        if (!this.check(TokenType.Punct, '}')) {
            do {
                const imported = this.expectImportName('imported name');
                let local = imported;
                if (this.checkName('as')) {
                    this.advance();
                    local = this.expectImportName('local alias');
                }
                specifiers.push({ imported, local });
            } while (this.match(TokenType.Punct, ','));
        }
        this.expect(TokenType.Punct, '}');
        if (!this.checkName('from')) {
            throw new Error(`Expected 'from' after import list at line ${this.peek().line}`);
        }
        this.advance();
        const srcTok = this.peek();
        if (srcTok.type !== TokenType.String) {
            throw new Error(`Expected module path string after 'from' at line ${srcTok.line}`);
        }
        const source = this.advance().value;
        this.match(TokenType.Punct, ';');
        return { type: 'Import', source, specifiers, line };
    },

    /**
     * `export fn …` | `export class …` | `export enum …`.
     * Экспортировать можно только top-level fn/class/enum (v1).
     * @returns {object} Export-узел
     */
    parseExportDeclaration() {
        const line = this.peek().line;
        if (this.blockDepth > 0) {
            throw new Error(`Export declarations are only allowed at top level (line ${line})`);
        }
        this.expect(TokenType.Keyword, 'export');
        const ok = this.check(TokenType.Keyword, 'fn')
            || this.isAsyncFn()
            || this.check(TokenType.Keyword, 'class')
            || this.check(TokenType.Keyword, 'enum');
        if (!ok) {
            throw new Error(`export supports only fn, class, enum at line ${line}`);
        }
        const declaration = this.parseDeclaration();
        return { type: 'Export', declaration, line };
    },

    /**
     * `enum Name { Variant, Variant(T, …), }` — sum-тип (варианты видны как
     * конструкторы в модуле, где объявлен enum, и в модулях, импортировавших enum).
     * @returns {object} Enum-узел
     */
    parseEnumDeclaration() {
        const line = this.peek().line;
        this.expect(TokenType.Keyword, 'enum');
        const name = this.expect(TokenType.Ident).value;
        this.expect(TokenType.Punct, '{');
        const variants = [];
        while (!this.check(TokenType.Punct, '}') && !this.check(TokenType.EOF)) {
            const variantName = this.expect(TokenType.Ident).value;
            const fields = [];
            if (this.match(TokenType.Punct, '(')) {
                if (!this.check(TokenType.Punct, ')')) {
                    do { fields.push(this.parseTypeAnnotation()); }
                    while (this.match(TokenType.Punct, ','));
                }
                this.expect(TokenType.Punct, ')');
            }
            variants.push({ name: variantName, fields });
            if (!this.match(TokenType.Punct, ',')) break;
        }
        this.expect(TokenType.Punct, '}');
        return { type: 'Enum', name, variants, line };
    },

    /** true, если текущий токен — имя (Ident) или ключевое слово с этим значением. */
    checkName(value) {
        const t = this.peek();
        return !!t && (t.type === TokenType.Ident || t.type === TokenType.Keyword)
            && t.value === value;
    },

    /** Ожидает имя символа (Ident); ключевые слова как имена импорта не годятся. */
    expectImportName(what) {
        const t = this.peek();
        if (t.type !== TokenType.Ident) {
            throw new Error(`Expected ${what} at line ${t.line}`);
        }
        return this.advance().value;
    },
};
