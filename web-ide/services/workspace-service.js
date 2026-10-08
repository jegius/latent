// services/workspace-service.js — модель рабочего пространства (файлы на Latent).
//
// Бизнес-логика: набор файлов `.lat`, активный файл, создание/переименование/
// удаление, персистентность в localStorage. Не знает о DOM.
//
// Формат хранения: { activeId, files: [{ id, name, code, createdAt }] }.

const STORAGE_KEY = 'latent-workspace-v1';

/**
 * @typedef {Object} LatentFile
 * @property {string} id — машинный идентификатор (уникальный)
 * @property {string} name — имя файла, всегда с расширением .lat
 * @property {string} code — исходный код
 * @property {number} createdAt — момент создания (ms)
 */

let idCounter = 0;
function nextId() {
    idCounter += 1;
    return `f${Date.now().toString(36)}_${idCounter}`;
}

export class WorkspaceService {
    /**
     * @param {Object} [opts]
     * @param {Array<{name:string, code:string}>} [opts.initialFiles]
     * @param {Object} [opts.storage] — хранилище (по умолчанию localStorage)
     */
    constructor(opts = {}) {
        this.storage = opts.storage !== undefined
            ? opts.storage
            : (typeof localStorage !== 'undefined' ? localStorage : null);
        /** @type {LatentFile[]} */
        this.files = [];
        this.activeId = null;

        const restored = this.load();
        if (restored) {
            this.files = restored.files;
            this.activeId = restored.activeId;
        } else if (opts.initialFiles && opts.initialFiles.length) {
            for (const f of opts.initialFiles) {
                this.createFile(f.name, f.code);
            }
        }
    }

    /**
     * Приводит имя к виду `*.lat`.
     * @param {string} name
     * @returns {string}
     */
    static normalizeName(name) {
        let n = String(name || '').trim();
        if (!n) n = 'untitled';
        n = n.replace(/[\/\\:*?"<>|]+/g, '_');
        if (!n.endsWith('.lat')) n += '.lat';
        return n;
    }

    /**
     * Создаёт новый файл.
     * @param {string} name
     * @param {string} [code]
     * @returns {LatentFile}
     */
    createFile(name, code = '') {
        const fileName = WorkspaceService.normalizeName(name);
        const file = {
            id: nextId(),
            name: fileName,
            code,
            createdAt: Date.now(),
        };
        this.files.push(file);
        this.activeId = file.id;
        this.save();
        return file;
    }

    /**
     * Удаляет файл. Нельзя удалить последний.
     * @param {string} id
     * @returns {boolean}
     */
    deleteFile(id) {
        if (this.files.length <= 1) return false;
        const idx = this.files.findIndex(f => f.id === id);
        if (idx === -1) return false;
        this.files.splice(idx, 1);
        if (this.activeId === id) {
            this.activeId = this.files[Math.max(0, idx - 1)].id;
        }
        this.save();
        return true;
    }

    /**
     * Переименовывает файл.
     * @param {string} id
     * @param {string} name
     * @returns {boolean}
     */
    renameFile(id, name) {
        const file = this.getFile(id);
        if (!file) return false;
        file.name = WorkspaceService.normalizeName(name);
        this.save();
        return true;
    }

    /**
     * Обновляет код файла.
     * @param {string} id
     * @param {string} code
     */
    updateCode(id, code) {
        const file = this.getFile(id);
        if (!file) return;
        file.code = code;
        this.save();
    }

    /**
     * Возвращает файл по id.
     * @param {string} id
     * @returns {LatentFile|undefined}
     */
    getFile(id) {
        return this.files.find(f => f.id === id);
    }

    /**
     * Активный файл.
     * @returns {LatentFile|undefined}
     */
    getActive() {
        return this.getFile(this.activeId);
    }

    /**
     * Устанавливает активный файл.
     * @param {string} id
     * @returns {boolean}
     */
    setActive(id) {
        if (!this.getFile(id)) return false;
        this.activeId = id;
        this.save();
        return true;
    }

    /**
     * Возвращает исходник активного файла.
     * @returns {string}
     */
    getActiveCode() {
        const f = this.getActive();
        return f ? f.code : '';
    }

    save() {
        if (!this.storage) return;
        try {
            this.storage.setItem(STORAGE_KEY, JSON.stringify({
                activeId: this.activeId,
                files: this.files,
            }));
        } catch (e) { /* storage недоступен */ }
    }

    /**
     * @returns {{activeId:string, files:LatentFile[]}|null}
     */
    load() {
        if (!this.storage) return null;
        try {
            const raw = this.storage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.files) || data.files.length === 0) return null;
            return data;
        } catch (e) {
            return null;
        }
    }
}