// services/share-service.js — шаринг программы через URL и персистентность кода.
// Программа — это URL: код кодируется в base64 (UTF-8-безопасно) и кладётся
// в hash. Дополнительно код живёт в localStorage (§6.7 статьи).

const STORAGE_KEY = 'latent-source';

/**
 * UTF-8-безопасное кодирование строки в base64 (btoa ломается на не-ASCII).
 * @param {string} str
 * @returns {string}
 */
export function encodeBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

/**
 * Декодирует base64 обратно в UTF-8-строку.
 * @param {string} b64
 * @returns {string}
 */
export function decodeBase64Utf8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

export class ShareService {
    /**
     * Сохраняет исходник в localStorage.
     * @param {string} source
     */
    saveSource(source) {
        try {
            localStorage.setItem(STORAGE_KEY, source);
        } catch (e) {
            // localStorage недоступен — игнорируем
        }
    }

    /**
     * Загружает исходник из localStorage.
     * @returns {string|null}
     */
    loadSource() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    /**
     * Строит share-URL с кодом в hash.
     * @param {string} source
     * @param {string} [base] — базовый URL (по умолчанию текущий)
     * @returns {string}
     */
    buildShareUrl(source, base) {
        const prefix = (base || (typeof location !== 'undefined' ? location.href.split('#')[0] : ''));
        return `${prefix}#code=${encodeBase64Utf8(source)}`;
    }

    /**
     * Извлекает код из hash текущего URL, если он там есть.
     * @param {string} [hash]
     * @returns {string|null}
     */
    readCodeFromHash(hash) {
        const h = hash !== undefined
            ? hash
            : (typeof location !== 'undefined' ? location.hash : '');
        const m = /[#&]code=([^&]+)/.exec(h || '');
        if (!m) return null;
        try {
            return decodeBase64Utf8(m[1]);
        } catch (e) {
            return null;
        }
    }
}