// version.mjs — имя и версия MCP-сервера.
//
// Единственная ответственность: прочитать package.json пакета и отдать
// константы для initialize.serverInfo. Чтение — синхронное, один раз при
// импорте; при любой ошибке используются безопасные значения по умолчанию.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Имя сервера в serverInfo (фиксировано контрактом). */
export const SERVER_NAME = 'latent-docs';

/** Каталог пакета `mcp/docs-mcp`. */
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Читает версию из package.json.
 * @returns {string}
 */
function readVersion() {
    try {
        const raw = fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === 'string' && parsed.version) return parsed.version;
    } catch {
        // package.json недоступен — версия не критична для протокола.
    }
    return '0.0.0';
}

/** Версия сервера из package.json. */
export const SERVER_VERSION = readVersion();
