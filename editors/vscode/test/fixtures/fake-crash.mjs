#!/usr/bin/env node
// LSP-сервер, который сразу падает: проверка graceful-обработки в клиенте.

process.stderr.write('fake-crash-lsp: намеренное падение\n');
process.exit(1);
