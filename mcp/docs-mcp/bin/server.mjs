#!/usr/bin/env node
// bin/server.mjs — точка входа MCP-сервера документации Latent.
//
// Единственная ответственность: разобрать аргументы командной строки, собрать
// ядро сервера (core.mjs) и запустить нужный транспорт:
//   --stdio                    — stdio (Content-Length-фрейминг);
//   --http --port 8765 --host  — Streamable HTTP.
// Плюс общие флаги: --docs <path>, --wasm <path>, --stateless, --help, --version.
//
// Диагностика при stdio-транспорте пишется только в stderr: stdout занят
// JSON-RPC потоком.

import process from 'node:process';

import { createCore } from '../src/core.mjs';
import { resolveDocsRoot, resolveWasmPath, resolveRepoRoot } from '../src/paths.mjs';
import { startHttpServer } from '../src/http.mjs';
import { startStdio } from '../src/stdio.mjs';
import { SERVER_NAME, SERVER_VERSION } from '../src/version.mjs';

/** Текст справки. */
const USAGE = `latent-docs — MCP-сервер документации языка Latent (zero dependencies)

Использование:
  node bin/server.mjs --stdio
  node bin/server.mjs --http [--port 8765] [--host 127.0.0.1] [--stateless]

Транспорт:
  --stdio              Общение JSON-RPC через stdin/stdout (Content-Length или NDJSON).
  --http               Streamable HTTP: POST/GET/DELETE /mcp, GET /health, GET /.
  --port <число>       Порт HTTP-сервера (по умолчанию 8765; 0 — случайный).
  --host <адрес>       Адрес прослушивания (по умолчанию 127.0.0.1).
  --stateless          Не требовать initialize до вызовов tools/resources/prompts.

Данные:
  --docs <path>        Каталог документации (по умолчанию <repo>/docs/docs).
  --wasm <path>        Путь к compiler.wasm (по умолчанию <repo>/web-ide/compiler.wasm).
  --repo <path>        Корень репозитория (для примеров; по умолчанию вычисляется).
  --help, -h           Показать эту справку.
  --version, -v        Показать версию.

Переменные окружения: LATENT_DOCS_PATH, LATENT_COMPILER_WASM.
`;

/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {object}
 */
function parseArgs(argv) {
    const options = {
        transport: null,
        port: 8765,
        host: '127.0.0.1',
        docs: null,
        wasm: null,
        repo: null,
        stateless: false,
        help: false,
        version: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const raw = argv[index];
        const [flag, inlineValue] = raw.includes('=') ? raw.split('=', 2) : [raw, undefined];

        /** @param {string} name */
        const takeValue = (name) => {
            if (inlineValue !== undefined) return inlineValue;
            const next = argv[index + 1];
            if (next === undefined || next.startsWith('--')) {
                throw new Error(`Флаг ${name} требует значения`);
            }
            index += 1;
            return next;
        };

        switch (flag) {
            case '--stdio':
                options.transport = 'stdio';
                break;
            case '--http':
                options.transport = 'http';
                break;
            case '--port':
                options.port = Number(takeValue('--port'));
                break;
            case '--host':
                options.host = takeValue('--host');
                break;
            case '--docs':
                options.docs = takeValue('--docs');
                break;
            case '--wasm':
                options.wasm = takeValue('--wasm');
                break;
            case '--repo':
                options.repo = takeValue('--repo');
                break;
            case '--stateless':
                options.stateless = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            case '--version':
            case '-v':
                options.version = true;
                break;
            default:
                throw new Error(`Неизвестный аргумент: ${raw}`);
        }
    }

    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error(`Некорректный порт: ${options.port}`);
    }
    return options;
}

/**
 * Формирует параметры путей.
 * @param {object} options
 * @returns {{repoRoot: string, docsRoot: string, wasmPath: string}}
 */
function resolvePaths(options) {
    const repoRoot = resolveRepoRoot(options.repo);
    return {
        repoRoot,
        docsRoot: resolveDocsRoot({ docs: options.docs, repoRoot }),
        wasmPath: resolveWasmPath({ wasm: options.wasm, repoRoot }),
    };
}

/**
 * Запускает stdio-транспорт.
 * @param {object} core
 * @param {{docsRoot: string}} paths
 */
function runStdio(core, paths) {
    const hooks = coreHooks;
    const stdio = startStdio(core, {
        logger: console,
        onExit: () => process.exit(0),
    });
    hooks.onExit = () => stdio.requestExit();

    process.on('SIGINT', () => {
        stdio.close();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        stdio.close();
        process.exit(0);
    });

    console.error(`[docs-mcp] stdio: документация ${paths.docsRoot}; документов: ${core.index.docs.length}`);
}

/**
 * Запускает HTTP-транспорт.
 * @param {object} core
 * @param {object} options
 * @param {{docsRoot: string}} paths
 * @returns {Promise<void>}
 */
async function runHttp(core, options, paths) {
    const handle = await startHttpServer({
        core,
        host: options.host,
        port: options.port,
        stateless: options.stateless,
        logger: console,
    });

    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    const landingUrl = handle.url.replace(/\/mcp$/, '/');
    console.log(`${SERVER_NAME} ${SERVER_VERSION} — MCP-сервер документации Latent`);
    console.log('transport: http');
    console.log(`url:       ${handle.url}`);
    console.log(`health:    ${healthUrl}`);
    console.log(`landing:   ${landingUrl}`);
    console.log(`docs:      ${paths.docsRoot}`);
    console.log(`documents: ${core.index.docs.length}`);
    console.log(`mode:      ${options.stateless ? 'stateless (initialize не обязателен)' : 'sessions (Mcp-Session-Id)'}`);
    console.log('Остановка: Ctrl+C (SIGINT/SIGTERM).');

    /** @type {Promise<void>|null} */
    let closing = null;
    /** @param {string} signal */
    const shutdown = (signal) => {
        if (closing) return closing;
        console.error(`[docs-mcp] получен ${signal}, останавливаю сервер...`);
        closing = handle.close().then(() => {
            console.error('[docs-mcp] сервер остановлен.');
            process.exit(0);
        });
        return closing;
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** @type {{onExit?: () => void}} */
const coreHooks = {};

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`[docs-mcp] ${error.message}`);
        console.error('Запустите с --help для справки.');
        process.exit(2);
    }

    if (options.help) {
        process.stdout.write(USAGE);
        return;
    }
    if (options.version) {
        process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
        return;
    }
    if (!options.transport) {
        console.error('[docs-mcp] не указан транспорт: используйте --stdio или --http.');
        process.stderr.write(USAGE);
        process.exit(1);
    }

    const paths = resolvePaths(options);
    const core = createCore({
        docsRoot: paths.docsRoot,
        repoRoot: paths.repoRoot,
        wasmPath: paths.wasmPath,
        hooks: coreHooks,
    });

    if (!core.index.exists) {
        console.error(`[docs-mcp] предупреждение: ${core.index.error}. Сервер продолжит работу с пустым индексом.`);
    }

    try {
        if (options.transport === 'stdio') {
            runStdio(core, paths);
        } else {
            await runHttp(core, options, paths);
        }
    } catch (error) {
        console.error(`[docs-mcp] не удалось запустить сервер: ${error && error.message ? error.message : error}`);
        process.exit(1);
    }
}

main();
