// tooling/latent-lsp/src/logger.mjs — логирование сервера.
//
// Для stdio-транспорта писать в stdout нельзя (там протокол), поэтому логи идут
// либо в файл `--log <path>`, либо в stderr. Логгер никогда не бросает: сбой
// записи не должен ронять сервер.

import fs from 'node:fs';
import path from 'node:path';

/** Логгер-заглушка (для тестов и встраивания). */
export const NOOP_LOGGER = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
};

/**
 * Простой логгер с уровнями.
 */
export class Logger {
    /**
     * @param {string} [filePath] — если не задан, лог идёт в stderr
     * @param {{stderr?: NodeJS.WritableStream}} [opts]
     */
    constructor(filePath, opts = {}) {
        this.filePath = filePath ? path.resolve(filePath) : '';
        this.stderr = opts.stderr || process.stderr;
        /** @type {number|null} */
        this.fd = null;
        if (this.filePath) {
            try {
                fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
                this.fd = fs.openSync(this.filePath, 'a');
            } catch (e) {
                this.fd = null;
                this.stderr.write(`[latent-lsp] не удалось открыть лог ${this.filePath}: ${e.message}\n`);
            }
        }
    }

    /**
     * @param {'debug'|'info'|'warn'|'error'} level
     * @param {string} message
     */
    log(level, message) {
        const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
        if (this.fd !== null) {
            try {
                fs.writeSync(this.fd, line);
                return;
            } catch (e) {
                // Падаем обратно на stderr.
            }
        }
        try {
            this.stderr.write(line);
        } catch (e) {
            // Последний рубеж: молча игнорируем.
        }
    }

    /** @param {string} message */
    debug(message) { this.log('debug', message); }
    /** @param {string} message */
    info(message) { this.log('info', message); }
    /** @param {string} message */
    warn(message) { this.log('warn', message); }
    /** @param {string} message */
    error(message) { this.log('error', message); }

    /** Закрывает файл лога. */
    close() {
        if (this.fd !== null) {
            try {
                fs.closeSync(this.fd);
            } catch (e) {
                // ignore
            }
            this.fd = null;
        }
    }
}
