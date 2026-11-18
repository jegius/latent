// tooling/latent-lsp/src/main.mjs — сборка и запуск stdio-сервера.
//
// Связывает CLI, логгер, данные о языке, wasm-компилятор и ядро LSP с
// транспортом JSON-RPC поверх stdin/stdout. Вся побочная работа (чтение файлов,
// WebAssembly.instantiate) — асинхронная; обработка сообщений — синхронная, что
// для LSP нормально: запросы обрабатываются по одному.

import { parseArgs, SERVER_VERSION, USAGE } from './cli.mjs';
import { Logger } from './logger.mjs';
import { loadLanguageData } from './language-data.mjs';
import { resolveCompilerWasmPath, WasmCompiler } from './wasm-compiler.mjs';
import { LatentLanguageServer } from './server.mjs';
import { ErrorCodes, errorResponse, FrameReader, serializeMessage } from './jsonrpc.mjs';

/**
 * Запускает сервер в stdio-режиме.
 *
 * @param {{
 *   argv?: string[],
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   env?: NodeJS.ProcessEnv,
 *   exit?: ((code: number) => void)|null,
 * }} [opts]
 *   `exit` — если задан, вызывается перед завершением промиса (bin/server.mjs
 *   передаёт сюда process.exit); иначе промис просто резолвится с кодом.
 * @returns {Promise<{code: number, server?: LatentLanguageServer}>}
 */
export async function runStdioServer(opts = {}) {
    const argv = opts.argv || process.argv.slice(2);
    const stdin = opts.stdin || process.stdin;
    const stdout = opts.stdout || process.stdout;
    const stderr = opts.stderr || process.stderr;
    const env = opts.env || process.env;
    const exit = opts.exit || null;

    const { options, errors } = parseArgs(argv);
    if (options.help) {
        stdout.write(USAGE);
        return { code: 0 };
    }
    if (options.version) {
        stdout.write(`latent-lsp ${SERVER_VERSION}\n`);
        return { code: 0 };
    }
    if (errors.length > 0) {
        stderr.write(errors.map((e) => `error: ${e}`).join('\n') + '\n\n' + USAGE);
        return { code: 2 };
    }
    if (!options.stdio) {
        stderr.write('error: поддерживается только транспорт --stdio\n\n' + USAGE);
        return { code: 2 };
    }

    const logger = new Logger(options.log, { stderr });

    let languageData;
    try {
        languageData = loadLanguageData(options.languageData, { logger, env });
    } catch (e) {
        logger.error(e.message);
        logger.close();
        return { code: 1 };
    }

    const compiler = await WasmCompiler.load(
        resolveCompilerWasmPath(options.compilerWasm, env), { logger });

    /** @type {LatentLanguageServer} */
    const server = new LatentLanguageServer({
        languageData,
        compiler,
        logger,
        send: (message) => {
            stdout.write(serializeMessage(message));
        },
    });

    const reader = new FrameReader();
    let finished = false;

    return await new Promise((resolve) => {
        /**
         * Завершает сервер: дожидается сброса stdout и резолвит промис.
         * @param {number} code
         */
        const finish = (code) => {
            if (finished) return;
            finished = true;
            logger.info(`завершение, код ${code}`);
            logger.close();
            const done = () => {
                if (exit) exit(code);
                resolve({ code, server });
            };
            try {
                stdout.write('', done);
            } catch (e) {
                done();
            }
        };

        const drain = () => {
            for (;;) {
                if (finished) return;
                const entry = reader.next();
                if (!entry) return;
                if (entry.frameError) {
                    logger.warn(`кадрирование: ${entry.frameError.message}`);
                    stdout.write(serializeMessage(
                        errorResponse(null, ErrorCodes.ParseError, entry.frameError.message)));
                    continue;
                }
                if (entry.parseError) {
                    logger.warn(`JSON: ${entry.parseError.message}`);
                    stdout.write(serializeMessage(errorResponse(
                        null, ErrorCodes.ParseError, `невалидный JSON: ${entry.parseError.message}`)));
                    continue;
                }
                server.handleMessage(entry.message);
                if (server.exitRequested) {
                    finish(server.exitCode);
                    return;
                }
            }
        };

        stdin.on('data', (chunk) => {
            reader.push(chunk);
            drain();
        });
        stdin.on('end', () => finish(server.exitRequested ? server.exitCode : 0));
        stdin.on('error', (e) => {
            logger.error(`stdin: ${e.message}`);
            finish(1);
        });
        if (typeof stdin.resume === 'function') stdin.resume();
    });
}
