# Changelog

Все заметные изменения расширения **Latent Language** для VS Code.

## 1.0.0

Первая версия.

### Добавлено

- TextMate-грамматика `source.latent`: комментарии `//` и вложенные `/* */`, строки с
  escape-последовательностями, числа (int/float/экспонента), `true`/`false`/`null`,
  жёсткие и мягкие ключевые слова, типы, операторы, декораторы, AI-примитивы,
  объявления и вызовы.
- Language configuration: комментарии, скобки, auto-closing/surrounding pairs,
  `wordPattern`, фолдинг по `// region`, indentation rules.
- Сниппеты для всех конструкций языка с описаниями на русском.
- LSP-клиент без зависимостей: stdio JSON-RPC, initialize/initialized,
  didOpen/didChange (full)/didSave/didClose, publishDiagnostics, completion, hover,
  signatureHelp, formatting, documentSymbol, definition; перезапуск и graceful
  degradation при отсутствии сервера.
- Компиляция через CLI `latentc` или `compiler.wasm` (ABI `latent_alloc`/`latent_compile`),
  запуск WASM с `env.print`, парсинг ошибок «на строке L:C» в диагностики.
- Команды `latent.compile`, `latent.run`, `latent.check`, `latent.format`,
  `latent.openDocs`, `latent.openPlayground`, `latent.restartLsp`; статус-бар;
  OutputChannel «Latent»; настройки и форматирование при сохранении.
- Тесты на `node:test` (грамматика, сниппеты, package.json, runner, LSP-клиент, docs).
