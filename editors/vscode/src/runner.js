'use strict';

// Компиляция и запуск программ Latent без зависимости от API VS Code.
//
// Модуль намеренно не требует `vscode`: его функции покрыты node:test и
// используются как расширением (src/extension.js), так и тестами.
//
// Два пути компиляции:
//   1) CLI `latentc compile <file.lat> <out.wasm>` (если бинарник есть);
//   2) `compiler.wasm` — Rust-компилятор, собранный в WebAssembly, через
//      C-ABI `latent_alloc` / `latent_compile` (см. src/lib.rs).
//
// Запуск скомпилированной программы: WebAssembly.Instance с единственным
// импортом `env.print(ptr)`, который читает из линейной памяти строку
// `[len u32 LE][utf8 bytes...]` (ABI из src/codegen/memory.rs).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Позиция в сообщении компилятора: «... на строке 12:7». */
const ERROR_POSITION_RE = /на строке\s+(\d+):(\d+)/;

/** Начала сообщений, по которым можно разделять склеенные ошибки через «; ». */
const ERROR_HEAD_RE =
    /^(?:Ошибка|Неопределённая|Несовпадение|Неожиданный|Незавершённ|Неверная|Неверный|Бесконечный|Отсутствует|Не функция|push expects|Builtin |Метод |Unknown |Enum |Оператор |Приём |AI-примитивы|Unsupported|internal:)/u;

const MAX_OUTPUT_BYTES = 1024 * 1024;

let tmpCounter = 0;

/**
 * Корень репозитория Latent относительно каталога расширения.
 * @param {string} extensionPath
 * @returns {string|null}
 */
function repoRootFor(extensionPath) {
    if (!extensionPath) return null;
    return path.resolve(extensionPath, '..', '..');
}

/**
 * Возвращает первый существующий путь из списка (или первый непустой).
 * @param {Array<string|null|undefined>} candidates
 * @returns {string}
 */
function firstExisting(candidates) {
    const list = candidates.filter((item) => typeof item === 'string' && item.length > 0);
    for (const candidate of list) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch (e) {
            // Недоступный путь просто пропускаем.
        }
    }
    return list.length > 0 ? list[0] : '';
}

/**
 * Путь к compiler.wasm: явная настройка → workspace → репозиторий → расширение.
 * @param {{configuredPath?: string, extensionPath?: string, workspaceRoot?: string}} [options]
 * @returns {string}
 */
function resolveCompilerWasmPath(options = {}) {
    if (options.configuredPath) return path.resolve(options.configuredPath);
    const root = repoRootFor(options.extensionPath);
    return firstExisting([
        options.workspaceRoot ? path.join(options.workspaceRoot, 'web-ide', 'compiler.wasm') : null,
        root ? path.join(root, 'web-ide', 'compiler.wasm') : null,
        options.extensionPath ? path.join(options.extensionPath, 'web-ide', 'compiler.wasm') : null,
        options.extensionPath ? path.join(options.extensionPath, 'compiler.wasm') : null,
    ]);
}

/**
 * Путь к CLI latentc: явная настройка → target/debug → target/release.
 * Возвращается даже несуществующий путь по умолчанию — вызывающий код
 * проверяет fs.existsSync и уходит на compiler.wasm.
 * @param {{configuredPath?: string, extensionPath?: string}} [options]
 * @returns {string}
 */
function resolveLatentcPath(options = {}) {
    if (options.configuredPath) return path.resolve(options.configuredPath);
    const root = repoRootFor(options.extensionPath);
    if (!root) return '';
    return firstExisting([
        path.join(root, 'target', 'debug', 'latentc.exe'),
        path.join(root, 'target', 'debug', 'latentc'),
        path.join(root, 'target', 'release', 'latentc.exe'),
        path.join(root, 'target', 'release', 'latentc'),
    ]);
}

/**
 * Путь к Node для запуска LSP-сервера / .mjs-скриптов.
 * @param {{configuredPath?: string}} [options]
 * @returns {string}
 */
function resolveNodePath(options = {}) {
    return options.configuredPath || 'node';
}

/**
 * Инстанцирует compiler.wasm.
 * @param {string} wasmPath
 * @returns {{ok: boolean, exports?: object, error?: string}}
 */
function instantiateCompiler(wasmPath) {
    try {
        if (!wasmPath) {
            return { ok: false, error: 'Не задан путь к compiler.wasm' };
        }
        if (!fs.existsSync(wasmPath)) {
            return { ok: false, error: `Файл compiler.wasm не найден: ${wasmPath}` };
        }
        const bytes = fs.readFileSync(wasmPath);
        const module = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(module, {});
        return { ok: true, exports: instance.exports };
    } catch (e) {
        return { ok: false, error: `Не удалось загрузить compiler.wasm (${wasmPath}): ${e.message}` };
    }
}

/**
 * Версия компилятора из `latent_version` (если экспорт есть).
 * @param {object} exports
 * @returns {string}
 */
function readCompilerVersion(exports) {
    try {
        if (!exports || typeof exports.latent_version !== 'function' || !exports.memory) return '';
        const ptr = exports.latent_version();
        const view = new DataView(exports.memory.buffer);
        const len = view.getUint32(ptr, true);
        const bytes = new Uint8Array(exports.memory.buffer, ptr + 4, len);
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        return '';
    }
}

/**
 * Компилирует исходник через compiler.wasm (движок №2).
 * @param {string} source
 * @param {string} wasmPath
 * @returns {{ok: boolean, wasm?: Buffer, error?: string, version?: string}}
 */
function compileWithWasm(source, wasmPath) {
    const loaded = instantiateCompiler(wasmPath);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const exports = loaded.exports;
    if (typeof exports.latent_compile !== 'function' || !exports.memory) {
        return { ok: false, error: 'compiler.wasm не экспортирует latent_compile/memory (несовместимый ABI)' };
    }

    let srcPtr = 0;
    let resPtr = 0;
    let srcLen = 0;
    let outLen = 0;
    try {
        const encoded = new TextEncoder().encode(String(source ?? ''));
        srcLen = encoded.length || 1;
        srcPtr = exports.latent_alloc(srcLen);
        if (!srcPtr) return { ok: false, error: 'compiler.wasm: latent_alloc вернул 0' };
        new Uint8Array(exports.memory.buffer).set(encoded, srcPtr);

        resPtr = exports.latent_compile(srcPtr, encoded.length);
        if (!resPtr) return { ok: false, error: 'compiler.wasm: latent_compile вернул 0' };

        // Память могла вырасти во время компиляции — берём свежие view.
        const view = new DataView(exports.memory.buffer);
        const status = view.getUint32(resPtr, true);
        const len = view.getUint32(resPtr + 4, true);
        const payload = Buffer.from(new Uint8Array(exports.memory.buffer, resPtr + 8, len));
        outLen = 8 + len;

        if (status !== 1) {
            return { ok: false, error: payload.toString('utf8'), version: readCompilerVersion(exports) };
        }
        return { ok: true, wasm: payload, version: readCompilerVersion(exports) };
    } catch (e) {
        return { ok: false, error: `Ошибка compiler.wasm: ${e.message}` };
    } finally {
        try {
            if (typeof exports.latent_free === 'function') {
                if (resPtr && outLen) exports.latent_free(resPtr, outLen);
                if (srcPtr) exports.latent_free(srcPtr, srcLen);
            }
        } catch (e) {
            // Освобождение — best effort.
        }
    }
}

/**
 * Позиция из сообщения компилятора.
 * @param {string} text
 * @returns {{line: number, column: number}|null} 1-based строка/столбец
 */
function parseErrorPosition(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    const match = ERROR_POSITION_RE.exec(text);
    if (!match) return null;
    const line = Number(match[1]);
    const column = Number(match[2]);
    if (!Number.isFinite(line) || !Number.isFinite(column) || line < 1 || column < 1) return null;
    return { line, column };
}

/**
 * Разделяет склейку ошибок «A; B; C» на отдельные сообщения.
 * @param {string} text
 * @returns {Array<string>}
 */
function splitCompilerErrors(text) {
    if (typeof text !== 'string') return [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const messages = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/;\s+/u);
        let current = '';
        for (const part of parts) {
            const piece = part.trim();
            if (!piece) continue;
            if (current && ERROR_HEAD_RE.test(piece)) {
                messages.push(current);
                current = piece;
            } else {
                current = current ? `${current}; ${piece}` : piece;
            }
        }
        if (current) messages.push(current);
    }
    return messages;
}

/**
 * Сообщения компилятора → простые диагностики (без API VS Code).
 * Позиции 1-based; в VS Code они переводятся в 0-based.
 * @param {string} text
 * @returns {Array<{message: string, line: number, column: number, hasPosition: boolean, severity: string}>}
 */
function parseCompilerDiagnostics(text) {
    return splitCompilerErrors(text).map((raw) => {
        const position = parseErrorPosition(raw);
        const message = raw
            .replace(/^error:\s*/iu, '')
            .replace(/\s*на строке\s+\d+:\d+/u, '')
            .trim() || raw;
        return {
            message,
            line: position ? position.line : 1,
            column: position ? position.column : 1,
            hasPosition: Boolean(position),
            severity: 'error',
        };
    });
}

/**
 * Запускает скомпилированный WASM-модуль с хост-импортом env.print.
 * @param {Buffer|Uint8Array|ArrayBuffer} bytes
 * @param {{print?: (text: string) => void, maxOutputBytes?: number}} [options]
 * @returns {{ok: boolean, output: string, result?: number|undefined, error?: string, truncated?: boolean}}
 */
function runWasm(bytes, options = {}) {
    const maxOutput = Number.isFinite(options.maxOutputBytes) ? options.maxOutputBytes : MAX_OUTPUT_BYTES;
    const onPrint = typeof options.print === 'function' ? options.print : null;
    let output = '';
    let truncated = false;

    let instance = null;
    const imports = {
        env: {
            print(ptr) {
                if (!instance || !instance.exports.memory) return;
                const view = new DataView(instance.exports.memory.buffer);
                const len = view.getUint32(ptr, true);
                const text = new TextDecoder('utf-8').decode(
                    new Uint8Array(instance.exports.memory.buffer, ptr + 4, len));
                if (output.length + text.length + 1 > maxOutput) {
                    truncated = true;
                    return;
                }
                output += text + '\n';
                if (onPrint) onPrint(text);
            },
        },
    };

    try {
        const source = bytes instanceof Uint8Array
            ? bytes
            : bytes instanceof ArrayBuffer
                ? new Uint8Array(bytes)
                : new Uint8Array(bytes || []);
        if (source.length === 0) {
            return { ok: false, output, error: 'Пустой WASM-модуль' };
        }
        const module = new WebAssembly.Module(source);
        instance = new WebAssembly.Instance(module, imports);
    } catch (e) {
        return { ok: false, output, error: `Некорректный WASM-модуль: ${e.message}` };
    }

    const main = instance.exports.main;
    if (typeof main !== 'function') {
        const names = Object.keys(instance.exports).join(', ') || '(нет)';
        return { ok: false, output, error: `Модуль не экспортирует main. Экспорты: ${names}` };
    }

    try {
        const raw = main();
        const result = typeof raw === 'bigint' ? Number(raw) : (typeof raw === 'number' ? raw : undefined);
        return { ok: true, output, result, truncated };
    } catch (e) {
        return { ok: false, output, error: `Ошибка выполнения: ${e.message}`, truncated };
    }
}

/**
 * Компилирует файл: сначала CLI latentc (если доступен и preferCli), иначе wasm.
 * @param {string} filePath
 * @param {{source?: string, latentcPath?: string, nodePath?: string, compilerWasmPath?: string,
 *          extensionPath?: string, outPath?: string, preferCli?: boolean, cwd?: string}} [options]
 * @returns {{ok: boolean, engine?: string, wasm?: Buffer, wasmPath?: string, output?: string,
 *           error?: string, missing?: boolean, diagnostics: Array<object>}}
 */
function compileFile(filePath, options = {}) {
    const preferCli = options.preferCli !== false;
    if (preferCli) {
        const latentcPath = options.latentcPath || resolveLatentcPath({
            extensionPath: options.extensionPath,
        });
        let exists = false;
        try {
            exists = Boolean(latentcPath) && fs.existsSync(latentcPath);
        } catch (e) {
            exists = false;
        }
        if (exists) {
            const cli = compileWithCli(filePath, {
                latentcPath,
                nodePath: options.nodePath,
                outPath: options.outPath,
                cwd: options.cwd,
            });
            if (cli.ok) return { ...cli, engine: 'latentc', diagnostics: [] };
            // Ошибка компиляции — возвращаем как есть; отсутствие бинарника — уходим на wasm.
            if (!cli.missing) {
                return { ...cli, engine: 'latentc', diagnostics: parseCompilerDiagnostics(cli.error || '') };
            }
        }
    }

    let source = options.source;
    if (typeof source !== 'string') {
        try {
            source = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            return { ok: false, engine: 'wasm', error: `Не удалось прочитать ${filePath}: ${e.message}`, diagnostics: [] };
        }
    }
    const wasmPath = options.compilerWasmPath || resolveCompilerWasmPath({
        extensionPath: options.extensionPath,
    });
    const compiled = compileWithWasm(source, wasmPath);
    return {
        ...compiled,
        engine: 'wasm',
        compilerWasmPath: wasmPath,
        diagnostics: compiled.ok ? [] : parseCompilerDiagnostics(compiled.error || ''),
    };
}

/**
 * Компилирует и сразу исполняет программу.
 * @param {string} source
 * @param {{compilerWasmPath?: string, extensionPath?: string, print?: (text: string) => void}} [options]
 * @returns {{ok: boolean, output: string, wasm?: Buffer, error?: string, result?: number, diagnostics: Array<object>}}
 */
function compileAndRun(source, options = {}) {
    const wasmPath = options.compilerWasmPath || resolveCompilerWasmPath({
        extensionPath: options.extensionPath,
    });
    const compiled = compileWithWasm(source, wasmPath);
    if (!compiled.ok) {
        return {
            ok: false,
            output: '',
            wasmPath,
            error: compiled.error,
            diagnostics: parseCompilerDiagnostics(compiled.error || ''),
        };
    }
    const executed = runWasm(compiled.wasm, { print: options.print });
    return {
        ok: executed.ok,
        output: executed.output,
        wasm: compiled.wasm,
        wasmPath,
        result: executed.result,
        truncated: executed.truncated,
        error: executed.error,
        diagnostics: executed.ok ? [] : [{ message: executed.error, line: 1, column: 1, hasPosition: false, severity: 'error' }],
    };
}

/**
 * Компилирует файл через CLI `latentc compile <file> <out.wasm>`.
 * @param {string} filePath
 * @param {{latentcPath: string, nodePath?: string, outPath?: string, cwd?: string, timeoutMs?: number}} options
 * @returns {{ok: boolean, wasm?: Buffer, wasmPath?: string, output?: string, error?: string, missing?: boolean}}
 */
function compileWithCli(filePath, options = {}) {
    const latentcPath = options.latentcPath;
    if (!latentcPath) {
        return { ok: false, missing: true, error: 'Путь к latentc не задан' };
    }
    try {
        if (!fs.existsSync(latentcPath)) {
            return { ok: false, missing: true, error: `latentc не найден: ${latentcPath}` };
        }
    } catch (e) {
        return { ok: false, missing: true, error: `latentc недоступен: ${latentcPath}` };
    }

    tmpCounter += 1;
    const outPath = options.outPath
        || path.join(os.tmpdir(), `latent-${process.pid}-${Date.now()}-${tmpCounter}.wasm`);

    const isScript = /\.(?:mjs|cjs|js)$/iu.test(latentcPath);
    const command = isScript ? (options.nodePath || resolveNodePath()) : latentcPath;
    const args = isScript
        ? [latentcPath, 'compile', filePath, outPath]
        : ['compile', filePath, outPath];

    let result;
    try {
        result = spawnSync(command, args, {
            cwd: options.cwd,
            encoding: 'utf8',
            timeout: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 60000,
            windowsHide: true,
        });
    } catch (e) {
        return { ok: false, error: `Не удалось запустить latentc: ${e.message}` };
    }

    if (result.error) {
        const missing = result.error.code === 'ENOENT';
        return {
            ok: false,
            missing,
            error: missing
                ? `latentc не найден: ${command}`
                : `Ошибка запуска latentc: ${result.error.message}`,
        };
    }

    const combined = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (result.status !== 0) {
        return {
            ok: false,
            exitCode: result.status,
            output: combined,
            error: combined || `latentc завершился с кодом ${result.status}`,
        };
    }

    try {
        if (!fs.existsSync(outPath)) {
            return { ok: false, output: combined, error: `latentc не создал файл ${outPath}` };
        }
        return { ok: true, wasm: fs.readFileSync(outPath), wasmPath: outPath, output: combined };
    } catch (e) {
        return { ok: false, output: combined, error: `Не удалось прочитать ${outPath}: ${e.message}` };
    }
}

/**
 * Путь для сохранения результата компиляции рядом с исходником.
 * @param {string} filePath
 * @returns {string}
 */
function wasmOutputPath(filePath) {
    return String(filePath).replace(/\.lat$/iu, '') + '.wasm';
}

/**
 * Записывает WASM-байты в файл.
 * @param {string} filePath
 * @param {Buffer|Uint8Array} bytes
 * @returns {string}
 */
function writeWasmFile(filePath, bytes) {
    fs.writeFileSync(filePath, bytes);
    return filePath;
}

module.exports = {
    MAX_OUTPUT_BYTES,
    compileAndRun,
    compileFile,
    compileWithCli,
    compileWithWasm,
    firstExisting,
    instantiateCompiler,
    parseCompilerDiagnostics,
    parseErrorPosition,
    readCompilerVersion,
    repoRootFor,
    resolveCompilerWasmPath,
    resolveLatentcPath,
    resolveNodePath,
    runWasm,
    splitCompilerErrors,
    wasmOutputPath,
    writeWasmFile,
};
