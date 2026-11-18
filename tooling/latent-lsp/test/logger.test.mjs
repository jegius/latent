// tooling/latent-lsp/test/logger.test.mjs — логирование сервера: файл, stderr,
// устойчивость к ошибкам записи (логгер не должен ронять сервер).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger, NOOP_LOGGER } from '../src/logger.mjs';

test('Logger: уровни пишутся в файл, close идемпотентен', () => {
    const dir = mkdtempSync(join(tmpdir(), 'latent-lsp-log-'));
    const file = join(dir, 'nested', 'lsp.log');
    try {
        const logger = new Logger(file, { stderr: { write() {} } });
        logger.debug('отладка');
        logger.info('старт');
        logger.warn('предупреждение');
        logger.error('ошибка');
        logger.close();
        logger.close(); // повторный close не бросает

        const text = readFileSync(file, 'utf8');
        assert.match(text, /\[debug\] отладка/);
        assert.match(text, /\[info\] старт/);
        assert.match(text, /\[warn\] предупреждение/);
        assert.match(text, /\[error\] ошибка/);
        assert.equal(text.trim().split('\n').length, 4);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Logger: недоступный путь → пишет в stderr и не бросает', () => {
    // NUL-байт в имени файла делает путь невалидным на всех платформах:
    // openSync бросает, конструктор обязан перейти на stderr.
    const dir = mkdtempSync(join(tmpdir(), 'latent-lsp-log-dir-'));
    const badFile = join(dir, 'bad\u0000name.log');
    const writes = [];
    const stderr = { write: (chunk) => { writes.push(String(chunk)); } };
    try {
        const logger = new Logger(badFile, { stderr });
        assert.equal(logger.fd, null, 'файл не открыт — fallback на stderr');
        assert.match(writes.join(''), /не удалось открыть лог/);

        logger.info('после сбоя');
        assert.match(writes.join(''), /\[info\] после сбоя/);
        logger.close(); // fd === null — no-op
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('NOOP_LOGGER: все методы — no-op и не бросают', () => {
    NOOP_LOGGER.debug('x');
    NOOP_LOGGER.info('x');
    NOOP_LOGGER.warn('x');
    NOOP_LOGGER.error('x');
    NOOP_LOGGER.close();
});
