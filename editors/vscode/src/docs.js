'use strict';

// Ссылки на документацию Latent и их открытие в браузере.
//
// Модуль не требует `vscode` на верхнем уровне: объект с API передаётся
// параметром, поэтому функции покрываются тестами с заглушкой.

const DOCS_URL = 'https://jegius.github.io/latent/';
const PLAYGROUND_URL = 'https://jegius.github.io/latent/playground/';

/**
 * Открывает URL во внешнем браузере.
 * @param {{env: {openExternal: (uri: any) => Promise<boolean>}, Uri: {parse: (value: string) => any}}} vscode
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function openUrl(vscode, url) {
    if (!vscode || !vscode.env || typeof vscode.env.openExternal !== 'function'
        || !vscode.Uri || typeof vscode.Uri.parse !== 'function') {
        return Promise.reject(new Error('Недоступен API VS Code для открытия ссылок'));
    }
    return Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url)));
}

/**
 * Открывает документацию языка.
 * @param {object} vscode
 * @returns {Promise<boolean>}
 */
function openDocs(vscode) {
    return openUrl(vscode, DOCS_URL);
}

/**
 * Открывает web-IDE (playground).
 * @param {object} vscode
 * @returns {Promise<boolean>}
 */
function openPlayground(vscode) {
    return openUrl(vscode, PLAYGROUND_URL);
}

module.exports = {
    DOCS_URL,
    PLAYGROUND_URL,
    openDocs,
    openPlayground,
    openUrl,
};
