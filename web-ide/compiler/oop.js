// compiler/oop.js — модель объектов языка Latent.
// Единственная ответственность: представление экземпляра класса, поиск метода
// в цепочке наследования и привязка `this`.

/**
 * Экземпляр класса. `klass` — узел Class из AST; `fields` — слоты значений.
 */
export class Instance {
    /**
     * @param {object} klass — AST-узел класса
     * @param {object} fields — начальные значения полей
     */
    constructor(klass, fields) {
        this.klass = klass;
        this.fields = fields || new Map();
    }

    get(name) {
        if (this.fields.has(name)) return this.fields.get(name);
        return undefined;
    }

    set(name, value) {
        this.fields.set(name, value);
    }
}

/** true, если значение — экземпляр класса. */
export function isInstance(v) { return v instanceof Instance; }

/**
 * Находит метод по имени, поднимаясь по цепочке родительских классов.
 * @param {object} klass — AST-узел класса
 * @param {string} name — имя метода
 * @returns {object|null}
 */
export function findMethod(klass, name) {
    let cur = klass;
    while (cur) {
        const m = cur.methods.find(fn => fn.name === name);
        if (m) return m;
        cur = cur.parent || null;
    }
    return null;
}