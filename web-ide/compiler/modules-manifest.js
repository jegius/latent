// compiler/modules-manifest.js — манифест проекта "LPF1" для движка №2.
// Единственная ответственность: кодирование/декодирование бинарного манифеста
// C-ABI `latent_compile_files` (см. MODULES.md) и детерминированный хэш набора
// файлов для кэша компиляции.
//
// Формат (little-endian):
//   magic "LPF1" (4 bytes)
//   u32 file_count
//   file_count × { u32 path_len, path utf8, u32 src_len, src utf8 }
//   u32 entry_index

import { ModuleError, normalizeModulePath, hashString } from './modules.js';

/** Сигнатура манифеста. */
export const MANIFEST_MAGIC = 'LPF1';
const MAGIC_BYTES = [0x4c, 0x50, 0x46, 0x31]; // "LPF1"

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Приводит файл проекта к { path, source } (канонический путь). */
function normalizeFile(file) {
    const path = normalizeModulePath(file && (file.path ?? file.name));
    const source = String((file && (file.source ?? file.code ?? file.text)) ?? '');
    return { path, source };
}

/** Детерминированно сортирует файлы по каноническому пути. */
function sortedFiles(files) {
    if (!Array.isArray(files)) {
        throw new ModuleError('project files must be an array', { code: 'PROJECT_INVALID' });
    }
    const seen = new Set();
    const out = [];
    for (const file of files) {
        const normalized = normalizeFile(file);
        if (seen.has(normalized.path)) {
            throw new ModuleError(
                `duplicate module file '${normalized.path}' in workspace`,
                { code: 'DUPLICATE_MODULE' });
        }
        seen.add(normalized.path);
        out.push(normalized);
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
}

/**
 * Готовит манифест из файлов workspace: все .lat-файлы (не только достижимые),
 * отсортированные по пути, + индекс entry.
 * @param {Array<{name?:string, code?:string, path?:string, source?:string}>} files
 * @param {string} entryPath
 * @returns {{files:Array<{path:string, source:string}>, entryIndex:number}}
 */
export function buildModuleManifest(files, entryPath) {
    const normalized = sortedFiles(files);
    if (normalized.length === 0) {
        throw new ModuleError('project has no .lat files', { code: 'PROJECT_EMPTY' });
    }
    const entry = normalizeModulePath(entryPath);
    const entryIndex = normalized.findIndex((file) => file.path === entry);
    if (entryIndex === -1) {
        throw new ModuleError(
            `entry file '${entry}' not found in workspace`, { path: entry, code: 'ENTRY_NOT_FOUND' });
    }
    return { files: normalized, entryIndex };
}

/**
 * Кодирует манифест "LPF1".
 * @param {Array<{path:string, source:string}>} files — уже канонические пути
 * @param {number} entryIndex
 * @returns {Uint8Array}
 */
export function encodeModuleManifest(files, entryIndex) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new ModuleError('manifest requires at least one file', { code: 'MANIFEST_INVALID' });
    }
    if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= files.length) {
        throw new ModuleError(
            `manifest entry_index ${entryIndex} is out of range [0, ${files.length})`,
            { code: 'MANIFEST_INVALID' });
    }
    const encoded = files.map((file) => ({
        path: encoder.encode(String(file.path ?? '')),
        source: encoder.encode(String(file.source ?? file.code ?? '')),
    }));
    let size = 4 + 4 + 4;
    for (const file of encoded) size += 4 + file.path.length + 4 + file.source.length;

    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    bytes.set(MAGIC_BYTES, 0);
    let offset = 4;
    view.setUint32(offset, files.length, true);
    offset += 4;
    for (const file of encoded) {
        view.setUint32(offset, file.path.length, true);
        offset += 4;
        bytes.set(file.path, offset);
        offset += file.path.length;
        view.setUint32(offset, file.source.length, true);
        offset += 4;
        bytes.set(file.source, offset);
        offset += file.source.length;
    }
    view.setUint32(offset, entryIndex, true);
    return bytes;
}

/**
 * Декодирует манифест "LPF1" (для тестов и диагностики).
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{files:Array<{path:string, source:string}>, entryIndex:number}}
 */
export function decodeModuleManifest(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const fail = (message) => {
        throw new ModuleError(`invalid module manifest: ${message}`, { code: 'MANIFEST_INVALID' });
    };
    if (bytes.length < 12) fail('too short');
    const magic = decoder.decode(bytes.slice(0, 4));
    if (magic !== MANIFEST_MAGIC) fail(`bad magic '${magic}'`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4;
    const count = view.getUint32(offset, true);
    offset += 4;
    if (count > 100000) fail(`unreasonable file count ${count}`);
    const files = [];
    for (let i = 0; i < count; i++) {
        if (offset + 4 > bytes.length) fail('truncated path length');
        const pathLen = view.getUint32(offset, true);
        offset += 4;
        if (offset + pathLen > bytes.length) fail('truncated path');
        const path = decoder.decode(bytes.slice(offset, offset + pathLen));
        offset += pathLen;
        if (offset + 4 > bytes.length) fail('truncated source length');
        const srcLen = view.getUint32(offset, true);
        offset += 4;
        if (offset + srcLen > bytes.length) fail('truncated source');
        const source = decoder.decode(bytes.slice(offset, offset + srcLen));
        offset += srcLen;
        files.push({ path, source });
    }
    if (offset + 4 > bytes.length) fail('truncated entry index');
    const entryIndex = view.getUint32(offset, true);
    offset += 4;
    if (offset !== bytes.length) fail('trailing bytes');
    if (entryIndex >= files.length) fail('entry index out of range');
    return { files, entryIndex };
}

/**
 * Детерминированный хэш набора файлов проекта (кэш движка №2).
 * Зависит от путей, содержимого и entry; порядок файлов не важен.
 * @param {Array<{name?:string, code?:string, path?:string, source?:string}>} files
 * @param {string} entryPath
 * @returns {string}
 */
export function projectHash(files, entryPath) {
    const { files: normalized, entryIndex } = buildModuleManifest(files, entryPath);
    const body = normalized.map((file) => `${file.path}\u0000${file.source}`).join('\u0001');
    return hashString(`${body}\u0002${entryIndex}`);
}
