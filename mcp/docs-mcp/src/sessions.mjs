// sessions.mjs — сессии Streamable HTTP транспорта.
//
// Единственная ответственность: выдать `Mcp-Session-Id` после initialize,
// хранить состояние сессий (кто инициализирован, когда активен) и убирать
// просроченные. Идентификатор — криптостойкий UUID, никаких внешних зависимостей.

import { randomUUID } from 'node:crypto';

/** Время жизни неактивной сессии по умолчанию — 30 минут. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class SessionStore {
    /**
     * @param {{ttlMs?: number}} [options]
     */
    constructor(options = {}) {
        this.ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
        /** @type {Map<string, object>} */
        this.sessions = new Map();
    }

    /**
     * Создаёт новую сессию.
     * @param {{clientInfo?: object, protocolVersion?: string}} [meta]
     * @returns {{id: string, initialized: boolean, createdAt: number, lastSeen: number}}
     */
    create(meta = {}) {
        const now = Date.now();
        const session = {
            id: randomUUID(),
            initialized: true,
            createdAt: now,
            lastSeen: now,
            clientInfo: meta.clientInfo || {},
            protocolVersion: meta.protocolVersion || '',
        };
        this.sessions.set(session.id, session);
        return session;
    }

    /**
     * Возвращает живую сессию и обновляет время активности.
     * @param {string} id
     * @returns {object|null}
     */
    get(id) {
        if (typeof id !== 'string' || !id) return null;
        const session = this.sessions.get(id);
        if (!session) return null;
        const now = Date.now();
        if (now - session.lastSeen > this.ttlMs) {
            this.sessions.delete(id);
            return null;
        }
        session.lastSeen = now;
        return session;
    }

    /**
     * Завершает сессию.
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        return this.sessions.delete(id);
    }

    /** @returns {number} */
    get size() {
        return this.sessions.size;
    }

    /** Удаляет все сессии (остановка сервера). */
    clear() {
        this.sessions.clear();
    }
}
