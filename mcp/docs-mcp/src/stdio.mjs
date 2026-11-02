// stdio.mjs — stdio-транспорт MCP-сервера документации.
//
// Единственная ответственность: читать JSON-RPC сообщения из stdin и писать
// ответы в stdout по Content-Length-фреймингу (как LSP и как требует контракт
// PLAN.md). Дополнительно принимается NDJSON (одно сообщение на строку) —
// текущая редакция MCP stdio рекомендует именно его, поэтому сервер дружелюбен
// к обоим форматам. Диагностика пишется только в stderr, чтобы не портить поток.
//
// Сообщения обрабатываются последовательно (очередь промисов), чтобы порядок
// ответов совпадал с порядком запросов.

import { ErrorCodes, failure } from './jsonrpc.mjs';

/**
 * Запускает stdio-транспорт.
 * @param {object} core ядро MCP-сервера
 * @param {{stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream, logger?: Console, exitOnEof?: boolean, onExit?: () => void}} [options]
 * @returns {{close: () => void, requestExit: () => void, isClosed: () => boolean}}
 */
export function startStdio(core, options = {}) {
    const stdin = options.stdin || process.stdin;
    const stdout = options.stdout || process.stdout;
    const logger = options.logger || console;
    const exitOnEof = options.exitOnEof !== false;

    /** @type {Buffer} */
    let buffer = Buffer.alloc(0);
    let queue = Promise.resolve();
    let pending = 0;
    let closed = false;
    let exitRequested = false;
    let finished = false;

    /**
     * Пишет JSON-RPC сообщение в stdout с Content-Length.
     * @param {object} message
     */
    function writeMessage(message) {
        if (closed && !exitRequested) return;
        const payload = Buffer.from(JSON.stringify(message), 'utf8');
        const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
        try {
            stdout.write(Buffer.concat([header, payload]));
        } catch (error) {
            logger.error?.('[docs-mcp] не удалось записать ответ в stdout:', error);
        }
    }

    /**
     * Завершает процесс после слива очереди и stdout.
     */
    function finish() {
        if (finished) return;
        finished = true;
        closed = true;
        try {
            stdin.pause?.();
        } catch {
            // stdin мог быть уже закрыт.
        }
        const done = () => {
            if (typeof options.onExit === 'function') options.onExit();
            else process.exit(0);
        };
        if (typeof stdout.write === 'function') {
            // Колбэк write вызывается после сброса буфера; небольшая задержка —
            // страховка для платформ, где 콜бэк вызывается до фактического flush.
            stdout.write('', () => setTimeout(done, 0));
        } else {
            done();
        }
    }

    /**
     * Проверяет, можно ли завершать процесс.
     */
    function maybeFinish() {
        if (!exitRequested || finished) return;
        if (pending > 0) return;
        finish();
    }

    /**
     * Ставит сообщение в очередь обработки.
     * @param {Buffer} payload
     */
    function enqueue(payload) {
        pending += 1;
        queue = queue
            .then(async () => {
                let parsed;
                try {
                    parsed = JSON.parse(payload.toString('utf8'));
                } catch {
                    writeMessage(failure(null, ErrorCodes.ParseError, 'Не удалось разобрать JSON-RPC сообщение'));
                    return;
                }
                try {
                    const response = await core.handlePayload(parsed);
                    if (response !== null && response !== undefined) writeMessage(response);
                } catch (error) {
                    logger.error?.('[docs-mcp] ошибка обработки сообщения:', error);
                    writeMessage(failure(null, ErrorCodes.InternalError, 'Внутренняя ошибка сервера'));
                }
            })
            .catch((error) => {
                logger.error?.('[docs-mcp] сбой очереди stdio:', error);
            })
            .finally(() => {
                pending -= 1;
                maybeFinish();
            });
    }

    /**
     * Отправляет уведомление о невозможности разобрать фрейм.
     * @param {string} reason
     */
    function framingError(reason) {
        writeMessage(failure(null, ErrorCodes.ParseError, `Ошибка фрейминга stdio: ${reason}`));
    }

    /**
     * Разбирает накопленный буфер на сообщения.
     */
    function processBuffer() {
        while (!closed) {
            if (buffer.length === 0) return;

            // NDJSON: сообщение начинается с '{'.
            const firstNonSpace = buffer.findIndex((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
            if (firstNonSpace === -1) {
                buffer = Buffer.alloc(0);
                return;
            }
            if (buffer[firstNonSpace] === 0x7b) {
                const newline = buffer.indexOf(0x0a, firstNonSpace);
                if (newline === -1) return; // ждём остаток строки
                const line = buffer.slice(firstNonSpace, newline).toString('utf8').trim();
                buffer = buffer.slice(newline + 1);
                if (line) enqueue(Buffer.from(line, 'utf8'));
                continue;
            }

            // Content-Length-фрейминг (LSP-совместимый).
            let separator = buffer.indexOf('\r\n\r\n');
            let separatorLength = 4;
            if (separator === -1) {
                separator = buffer.indexOf('\n\n');
                separatorLength = 2;
            }
            if (separator === -1) return;

            const headerText = buffer.slice(0, separator).toString('utf8');
            const match = /^content-length:\s*(\d+)\s*$/im.exec(headerText);
            if (!match) {
                framingError('отсутствует заголовок Content-Length');
                buffer = buffer.slice(separator + separatorLength);
                continue;
            }

            const length = Number(match[1]);
            if (!Number.isFinite(length) || length < 0 || length > 64 * 1024 * 1024) {
                framingError(`некорректный Content-Length: ${match[1]}`);
                buffer = buffer.slice(separator + separatorLength);
                continue;
            }

            const start = separator + separatorLength;
            if (buffer.length < start + length) return; // тело ещё не пришло

            const payload = buffer.slice(start, start + length);
            buffer = buffer.slice(start + length);
            enqueue(payload);
        }
    }

    /** @param {Buffer} chunk */
    function onData(chunk) {
        if (closed) return;
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
        processBuffer();
    }

    function onEnd() {
        if (closed) return;
        // Остаток буфера без завершающего перевода строки.
        if (buffer.length > 0) {
            const rest = buffer.toString('utf8').trim();
            buffer = Buffer.alloc(0);
            if (rest.startsWith('{')) enqueue(Buffer.from(rest, 'utf8'));
        }
        closed = true;
        queue.finally(() => {
            if (!exitRequested && exitOnEof) {
                exitRequested = true;
                maybeFinish();
            }
        });
    }

    function onError(error) {
        logger.error?.('[docs-mcp] ошибка stdin:', error);
    }

    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);

    /**
     * Просит транспорт завершиться после обработки текущей очереди.
     */
    function requestExit() {
        exitRequested = true;
        maybeFinish();
    }

    /** Снимает обработчики, не завершая процесс (используется в тестах). */
    function close() {
        if (closed) return;
        closed = true;
        stdin.off('data', onData);
        stdin.off('end', onEnd);
        stdin.off('error', onError);
        try {
            stdin.pause?.();
        } catch {
            // ignore
        }
    }

    return {
        close,
        requestExit,
        isClosed: () => closed,
        writeMessage,
    };
}
