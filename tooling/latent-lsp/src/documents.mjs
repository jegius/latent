// tooling/latent-lsp/src/documents.mjs — хранилище открытых документов и
// инкрементальная синхронизация (LSP textDocumentSync = Incremental).
//
// Модуль не знает о JSON-RPC и возможностях сервера: единственная
// ответственность — держать актуальный текст документа и корректно применять
// range-правки в UTF-16 позициях.

import { documentRange, offsetToPosition, positionToOffset } from './positions.mjs';

/**
 * Один открытый текстовый документ.
 */
export class TextDocument {
    /**
     * @param {{uri: string, languageId?: string, version?: number, text?: string}} init
     */
    constructor(init) {
        this.uri = init.uri;
        this.languageId = init.languageId || 'latent';
        this.version = init.version ?? 0;
        this.text = init.text ?? '';
    }

    /** Полный текст документа. */
    getText() {
        return this.text;
    }

    /** Диапазон всего документа (для formatting). */
    getRange() {
        return documentRange(this.text);
    }

    /**
     * Применяет набор изменений из didChange.
     * @param {number|undefined} version
     * @param {Array<{range?: {start: any, end: any}, text: string}>} changes
     */
    applyChanges(version, changes) {
        if (typeof version === 'number') this.version = version;
        let next = this.text;
        for (const change of changes || []) {
            next = applyContentChange(next, change);
        }
        this.text = next;
    }

    /** Обновляет полный текст (например, из didSave с includeText). */
    setText(text, version) {
        if (typeof version === 'number') this.version = version;
        this.text = String(text ?? '');
    }
}

/**
 * Применяет одно изменение к тексту.
 * Без `range` — полная замена содержимого.
 * @param {string} text
 * @param {{range?: {start: {line: number, character: number}, end: {line: number, character: number}}, text: string}} change
 * @returns {string}
 */
export function applyContentChange(text, change) {
    const insert = typeof change?.text === 'string' ? change.text : '';
    if (!change || !change.range) return insert;
    const start = positionToOffset(text, change.range.start);
    const end = positionToOffset(text, change.range.end);
    if (end < start) {
        // Некорректный диапазон: не роняем сервер, просто вставляем в начало.
        return insert + text;
    }
    return text.slice(0, start) + insert + text.slice(end);
}

/**
 * Применяет пачку изменений последовательно (как требует LSP: каждое
 * следующее изменение считается по состоянию после предыдущего).
 * @param {string} text
 * @param {Array<{range?: any, text: string}>} changes
 * @returns {string}
 */
export function applyAllChanges(text, changes) {
    let current = text;
    for (const change of changes || []) current = applyContentChange(current, change);
    return current;
}

/**
 * Хранилище документов: uri → TextDocument.
 */
export class DocumentStore {
    constructor() {
        /** @type {Map<string, TextDocument>} */
        this.documents = new Map();
    }

    /**
     * @param {string} uri
     * @param {{languageId?: string, version?: number, text?: string}} [init]
     * @returns {TextDocument}
     */
    open(uri, init = {}) {
        const doc = new TextDocument({ uri, ...init });
        this.documents.set(uri, doc);
        return doc;
    }

    /**
     * @param {string} uri
     * @returns {TextDocument|undefined}
     */
    get(uri) {
        return this.documents.get(uri);
    }

    /**
     * @param {string} uri
     * @returns {boolean}
     */
    has(uri) {
        return this.documents.has(uri);
    }

    /**
     * @param {string} uri
     */
    close(uri) {
        this.documents.delete(uri);
    }

    /** Все открытые документы. */
    all() {
        return [...this.documents.values()];
    }

    /** Текст документа или пустая строка. */
    textOf(uri) {
        return this.documents.get(uri)?.text ?? '';
    }

    /** Версия документа (для publishDiagnostics), если открыт. */
    versionOf(uri) {
        return this.documents.get(uri)?.version;
    }

    /**
     * Позиция → смещение для открытого документа.
     * @param {string} uri
     * @param {{line: number, character: number}} position
     */
    offsetOf(uri, position) {
        const doc = this.documents.get(uri);
        return doc ? positionToOffset(doc.text, position) : 0;
    }

    /**
     * Смещение → позиция для открытого документа.
     * @param {string} uri
     * @param {number} offset
     */
    positionOf(uri, offset) {
        const doc = this.documents.get(uri);
        return doc ? offsetToPosition(doc.text, offset) : { line: 0, character: 0 };
    }
}
