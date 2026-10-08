// compiler/environment.js — runtime-примитивы движка №1.
// Единственная ответственность: сигнал return, канал goroutines, окружение
// переменных и совместимые с await значения (Promise/Result/Option).

export class ReturnSignal {
    constructor(value) { this.value = value; }
}

// Канал для коммуникации между горутинами (CSP-style).
// Поддерживает буфер и неблокирующую операцию try_recv (для select).
export class Channel {
    constructor(scheduler, buffer = 0) {
        this.queue = [];
        this.buffer = buffer;
        this.closed = false;
        this.scheduler = scheduler; // колбэк: прогнать другие горутины
    }

    send(value) {
        if (this.closed) throw new Error('send on closed channel');
        this.queue.push(value);
        return null;
    }

    /** Пробует забрать значение без ожидания планировщика. */
    tryRecv() {
        if (this.queue.length === 0) return undefined; // маркер «нет данных»
        return this.queue.shift();
    }

    recv() {
        // Активное ожидание: пока канал пуст, уступаем другим горутинам
        let guard = 0;
        while (this.queue.length === 0) {
            if (this.closed) return null;
            if (!this.scheduler || !this.scheduler()) {
                throw new Error('Deadlock: recv on empty channel with no runnable goroutines');
            }
            if (++guard > 10_000_000) throw new Error('recv wait limit exceeded');
        }
        return this.queue.shift();
    }

    close() { this.closed = true; }
}

export class Environment {
    constructor(parent = null) {
        this.vars = new Map();
        this.parent = parent;
    }
    define(name, value) { this.vars.set(name, value); }
    get(name) {
        if (this.vars.has(name)) return this.vars.get(name);
        if (this.parent) return this.parent.get(name);
        throw new Error(`Undefined variable '${name}'`);
    }
    set(name, value) {
        if (this.vars.has(name)) { this.vars.set(name, value); return; }
        if (this.parent) { this.parent.set(name, value); return; }
        throw new Error(`Undefined variable '${name}'`);
    }
    has(name) {
        if (this.vars.has(name)) return true;
        return this.parent ? this.parent.has(name) : false;
    }
}

/**
 * Асинхронное значение (Promise-подобное). `await` разворачивает его в value.
 * @param {any} value
 * @returns {{__promise: true, value: any}}
 */
export function resolvedPromise(value) {
    return { __promise: true, value };
}

/** true, если значение — Promise-подобное. */
export function isPromise(v) {
    return v !== null && typeof v === 'object' && v.__promise === true;
}

/**
 * Алгебраический тип Result/Option: Ok(v), Err(e), Some(v), None.
 * @param {string} tag
 * @param {any} [value]
 */
export function taggedValue(tag, value) {
    return { __tag: tag, value };
}

/** true, если значение — тегированное (Ok/Err/Some/None). */
export function isTagged(v) {
    return v !== null && typeof v === 'object' && typeof v.__tag === 'string';
}