// landing.mjs — HTML-лендинг MCP-сервера документации (GET /).
//
// Единственная ответственность: собрать статическую страницу с описанием
// сервера, адресами подключения, конфигурациями популярных MCP-клиентов,
// списком tools/resources/prompts и curl-примерами. Все подставляемые
// значения экранируются.

/**
 * Экранирует текст для вставки в HTML.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Блок кода в HTML.
 * @param {string} code
 * @returns {string}
 */
function codeBlock(code) {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
}

/**
 * Рендерит лендинг.
 * @param {{host: string, port: number, docsRoot: string, docCount: number, stateless: boolean, version: string}} info
 * @returns {string}
 */
export function renderLanding(info) {
    const host = info.host === '0.0.0.0' ? '127.0.0.1' : info.host;
    const baseUrl = `http://${host}:${info.port}`;
    const mcpUrl = `${baseUrl}/mcp`;
    const stdioCommand = 'node mcp/docs-mcp/bin/server.mjs --stdio';
    const claudeConfig = `{
  "mcpServers": {
    "latent-docs": {
      "command": "node",
      "args": [
        "C:/path/to/latent/mcp/docs-mcp/bin/server.mjs",
        "--stdio"
      ]
    }
  }
}`;
    const cursorConfig = `{
  "mcpServers": {
    "latent-docs": {
      "command": "node",
      "args": ["C:/path/to/latent/mcp/docs-mcp/bin/server.mjs", "--stdio"]
    }
  }
}`;
    const vscodeConfig = `{
  "servers": {
    "latent-docs": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`;
    const claudeCodeCommand = `claude mcp add --transport stdio latent-docs -- node C:/path/to/latent/mcp/docs-mcp/bin/server.mjs --stdio`;
    const curlInit = `curl -s ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`;
    const curlTools = `# Идентификатор сессии берётся из заголовка Mcp-Session-Id ответа initialize
curl -s ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Mcp-Session-Id: <SESSION_ID>" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`;
    const curlStateless = `# Запуск без обязательного initialize:
node mcp/docs-mcp/bin/server.mjs --http --port ${info.port} --stateless
curl -s ${mcpUrl} -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
    const curlHealth = `curl -s ${baseUrl}/health`;
    const curlSearch = `curl -s ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Mcp-Session-Id: <SESSION_ID>" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_docs","arguments":{"query":"массивы push pop","limit":5}}}'`;

    const tools = [
        ['list_docs', '{}', 'оглавление: path/title/description/section'],
        ['search_docs', '{query, limit?}', 'результаты с score и сниппетом'],
        ['read_doc', '{path}', 'полный Markdown страницы'],
        ['get_language_reference', '{topic?}', 'агрегированный справочник reference/*'],
        ['get_example', '{id?}', 'исходник примера из web-ide/examples'],
        ['check_code', '{code}', 'компиляция через web-ide/compiler.wasm'],
    ];

    const toolsRows = tools.map(([name, args, description]) => (
        `<tr><td><code>${escapeHtml(name)}</code></td><td><code>${escapeHtml(args)}</code></td><td>${escapeHtml(description)}</td></tr>`
    )).join('\n');

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>latent-docs — MCP-сервер документации Latent</title>
<style>
  :root { color-scheme: light dark; --accent: #6d5efc; --bg: #0f1020; --panel: #191a2e; --text: #e8e8f4; --muted: #a9a9c4; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: linear-gradient(180deg, var(--bg), #14152a 60%); color: var(--text); line-height: 1.6; }
  main { max-width: 980px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 2rem; margin: 0 0 8px; }
  h1 span { color: var(--accent); }
  h2 { margin-top: 42px; border-bottom: 1px solid #2c2d4a; padding-bottom: 8px; }
  p { color: var(--muted); }
  a { color: var(--accent); }
  .badges { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 8px; }
  .badge { background: var(--panel); border: 1px solid #2c2d4a; border-radius: 999px; padding: 4px 12px; font-size: .85rem; color: var(--muted); }
  .badge b { color: var(--text); }
  pre { background: #0b0c18; border: 1px solid #2c2d4a; border-radius: 10px; padding: 14px 16px; overflow-x: auto; font-size: .86rem; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #2c2d4a; font-size: .92rem; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  .muted { color: var(--muted); font-size: .9rem; }
  .grid { display: grid; gap: 18px; grid-template-columns: 1fr; }
  @media (min-width: 800px) { .grid { grid-template-columns: 1fr 1fr; } }
  footer { margin-top: 60px; color: var(--muted); font-size: .85rem; }
</style>
</head>
<body>
<main>
  <h1><span>latent-docs</span> — MCP-сервер документации</h1>
  <p>Доступ к документации языка Latent для AI-агентов по протоколу
     <a href="https://modelcontextprotocol.io">Model Context Protocol</a>.
     Только чтение: сервер не изменяет файлы и не исполняет код.</p>

  <div class="badges">
    <span class="badge">версия <b>${escapeHtml(info.version)}</b></span>
    <span class="badge">документов <b>${info.docCount}</b></span>
    <span class="badge">транспорт <b>${info.stateless ? 'HTTP (stateless)' : 'HTTP + stdio'}</b></span>
    <span class="badge">протокол <b>2025-06-18</b></span>
  </div>

  <h2>Подключение по HTTP</h2>
  <div class="grid">
    <div>
      <p>Endpoint: <code>${escapeHtml(mcpUrl)}</code></p>
      ${codeBlock(`MCP URL: ${mcpUrl}\nHealth:  ${baseUrl}/health`)}
      <p class="muted">${
        info.stateless
            ? 'Сервер запущен в stateless-режиме: initialize не обязателен.'
            : 'Сервер с сессиями: сначала POST initialize, затем передавайте заголовок Mcp-Session-Id. GET /mcp — SSE-поток, GET /health — статус.'
      }</p>
    </div>
    <div>
      <p>Проверка:</p>
      ${codeBlock(curlHealth)}
      ${codeBlock(curlTools)}
    </div>
  </div>

  <h2>Подключение по stdio</h2>
  ${codeBlock(stdioCommand)}
  <p class="muted">stdio использует Content-Length-фрейминг (как LSP); NDJSON тоже принимается.</p>

  <h2>Клиенты</h2>
  <h3>Claude Desktop</h3>
  <p class="muted">Файл <code>~/.claude/claude_desktop_config.json</code> (Windows: <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>):</p>
  ${codeBlock(claudeConfig)}
  <h3>Claude Code</h3>
  ${codeBlock(claudeCodeCommand)}
  <h3>Cursor</h3>
  <p class="muted">Файл <code>~/.cursor/mcp.json</code> или <code>.cursor/mcp.json</code> в проекте:</p>
  ${codeBlock(cursorConfig)}
  <h3>VS Code</h3>
  <p class="muted">Файл <code>.vscode/mcp.json</code>:</p>
  ${codeBlock(vscodeConfig)}

  <h2>Инструменты</h2>
  <table>
    <thead><tr><th>Tool</th><th>Аргументы</th><th>Результат</th></tr></thead>
    <tbody>
${toolsRows}
    </tbody>
  </table>
  <p class="muted">Ресурсы: <code>latent-docs://index</code> и <code>latent-docs://&lt;path.md&gt;</code> для каждой страницы.
     Промпты: <code>explain_syntax</code>, <code>write_program</code>, <code>debug_program</code> — с подстановкой релевантных страниц.</p>

  <h2>curl-примеры</h2>
  ${codeBlock(curlInit)}
  ${codeBlock(curlSearch)}
  ${codeBlock(curlStateless)}

  <h2>Расположение документации</h2>
  <p><code>${escapeHtml(info.docsRoot)}</code></p>
  <p class="muted">Переопределяется флагом <code>--docs &lt;path&gt;</code> или переменной окружения
     <code>LATENT_DOCS_PATH</code>. По умолчанию — <code>docs/docs</code> в корне репозитория.</p>

  <h2>Безопасность</h2>
  <ul class="muted">
    <li>Сервер только читает Markdown и не изменяет файлы.</li>
    <li><code>check_code</code> компилирует код в WASM-байты, но не исполняет программу.</li>
    <li>По умолчанию слушает <code>127.0.0.1</code> — не публикуйте наружу без reverse proxy и авторизации.</li>
    <li>Пути к документам нормализуются: выход за пределы каталога документации запрещён.</li>
  </ul>

  <footer>
    Latent MCP docs server · <a href="/mcp">/mcp</a> · <a href="/health">/health</a> ·
    документация: <code>docs/</code> · PLAYGROUND: <a href="/playground/">/playground/</a> (если сервер запущен рядом с docs-сайтом)
  </footer>
</main>
</body>
</html>
`;
}
