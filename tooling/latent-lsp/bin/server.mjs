#!/usr/bin/env node
// tooling/latent-lsp/bin/server.mjs — точка входа LSP-сервера Latent.
//
//   node tooling/latent-lsp/bin/server.mjs --stdio
//
// Транспорт — JSON-RPC 2.0 поверх stdio с заголовками Content-Length.
// Все настройки см. в src/cli.mjs / README.md.

import { runStdioServer } from '../src/main.mjs';

const { code } = await runStdioServer({
    exit: (exitCode) => process.exit(exitCode),
});

// Сюда попадаем только если exit-колбэк не вызывался (help/version/ошибка
// аргументов) — завершаемся с соответствующим кодом.
process.exit(code);
