'use strict';

// Расширение VS Code для языка Latent.
//
// Возможности:
//   * подсветка (TextMate), сниппеты, language configuration — без LSP;
//   * LSP-сервер (tooling/latent-lsp): диагностика, completion, hover,
//     сигнатуры, форматирование, symbols/definition — через собственный
//     минимальный клиент (без vscode-languageclient);
//   * компиляция в WASM через CLI latentc или compiler.wasm и запуск
//     результата с импортом env.print;
//   * статус-бар и OutputChannel «Latent».

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const runner = require('./runner');
const { LspClient, resolveServerPath } = require('./lsp-client');
const docs = require('./docs');

const LANGUAGE_ID = 'latent';
const SELECTOR = { language: LANGUAGE_ID };
const DIAGNOSTICS_SOURCE = 'latent';
const LSP_DIAGNOSTICS_SOURCE = 'latent-lsp';

/** @type {vscode.OutputChannel|undefined} */
let output;
/** @type {vscode.DiagnosticCollection|undefined} */
let diagnostics;
/** @type {vscode.StatusBarItem|undefined} */
let statusItem;
/** @type {LspClient|null} */
let client = null;
/** @type {vscode.ExtensionContext|undefined} */
let extensionContext;
/** @type {Record<string, any>} */
let settings = {};
let warnedAboutMissingLsp = false;
let lspState = 'stopped';
let lspDetail = '';

function readSettings() {
    const config = vscode.workspace.getConfiguration('latent');
    return {
        latentcPath: config.get('latentcPath', ''),
        nodePath: config.get('nodePath', ''),
        lspServerPath: config.get('lspServerPath', ''),
        compilerWasmPath: config.get('compilerWasmPath', ''),
        enableDiagnostics: config.get('enableDiagnostics', true),
        enableLsp: config.get('enableLsp', true),
        formatOnSave: config.get('formatOnSave', false),
    };
}

function log(message) {
    if (output) output.appendLine(message);
}

function isLatentDocument(document) {
    return Boolean(document) && document.languageId === LANGUAGE_ID;
}

function workspaceFolderPath(document) {
    try {
        const folder = document && document.uri
            ? vscode.workspace.getWorkspaceFolder(document.uri)
            : undefined;
        return folder ? folder.uri.fsPath : undefined;
    } catch (e) {
        return undefined;
    }
}

function resolveConfiguredPath(value, document) {
    if (!value) return '';
    if (path.isAbsolute(value)) return value;
    const folder = workspaceFolderPath(document);
    if (folder) return path.join(folder, value);
    return value;
}

function extensionPath() {
    return extensionContext ? extensionContext.extensionUri.fsPath : '';
}

function setStatus(text, tooltip, command = 'latent.restartLsp') {
    if (!statusItem) return;
    statusItem.text = text;
    statusItem.tooltip = tooltip;
    statusItem.command = command;
    statusItem.show();
}

function updateStatus(state, detail) {
    lspState = state;
    lspDetail = detail || '';
    if (!statusItem) return;
    if (!settings.enableLsp) {
        setStatus('$(circle-slash) Latent', 'Latent: LSP выключен (latent.enableLsp = false)');
        return;
    }
    switch (state) {
        case 'running':
            setStatus('$(symbol-method) Latent', `Latent: LSP работает${detail ? ` (${detail})` : ''}`);
            break;
        case 'starting':
            setStatus('$(sync~spin) Latent', 'Latent: LSP запускается…');
            break;
        case 'missing':
            setStatus('$(warning) Latent: LSP off', detail || 'LSP-сервер не найден — работаем без LSP');
            break;
        case 'error':
            setStatus('$(error) Latent: LSP off', detail || 'Ошибка LSP-сервера');
            break;
        default:
            setStatus('$(circle-slash) Latent', detail || 'Latent: LSP остановлен');
            break;
    }
}

// ---------------------------------------------------------------------------
// Диагностика
// ---------------------------------------------------------------------------

function lspSeverityToVscode(severity) {
    switch (severity) {
        case 1: return vscode.DiagnosticSeverity.Error;
        case 2: return vscode.DiagnosticSeverity.Warning;
        case 3: return vscode.DiagnosticSeverity.Information;
        case 4: return vscode.DiagnosticSeverity.Hint;
        default: return vscode.DiagnosticSeverity.Error;
    }
}

function rangeFromLsp(range) {
    return new vscode.Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
    );
}

function publishLspDiagnostics(params) {
    if (!diagnostics) return;
    if (!settings.enableDiagnostics) return;
    try {
        const uri = vscode.Uri.parse(params.uri);
        const items = Array.isArray(params.diagnostics) ? params.diagnostics : [];
        const list = items.slice(0, 1000).map((item) => {
            const range = item.range ? rangeFromLsp(item.range) : new vscode.Range(0, 0, 0, 1);
            const diagnostic = new vscode.Diagnostic(range, item.message || '', lspSeverityToVscode(item.severity));
            diagnostic.source = item.source || LSP_DIAGNOSTICS_SOURCE;
            if (item.code !== undefined && item.code !== null) {
                diagnostic.code = typeof item.code === 'object' ? item.code.value : item.code;
            }
            return diagnostic;
        });
        diagnostics.set(uri, list);
    } catch (e) {
        log(`[LSP] не удалось разобрать publishDiagnostics: ${e.message}`);
    }
}

function publishRunnerDiagnostics(document, plainDiagnostics) {
    if (!diagnostics) return;
    if (!settings.enableDiagnostics) return;
    try {
        const list = (plainDiagnostics || []).map((item) => {
            const line = Math.max(0, Math.min((item.line || 1) - 1, Math.max(0, document.lineCount - 1)));
            const lineText = document.lineAt(line).text;
            const column = Math.max(0, Math.min((item.column || 1) - 1, lineText.length));
            const endColumn = Math.min(lineText.length, column + 1);
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(line, column, line, Math.max(column, endColumn)),
                item.message || 'Ошибка компиляции Latent',
                vscode.DiagnosticSeverity.Error,
            );
            diagnostic.source = DIAGNOSTICS_SOURCE;
            return diagnostic;
        });
        diagnostics.set(document.uri, list);
    } catch (e) {
        log(`[compile] не удалось опубликовать диагностику: ${e.message}`);
    }
}

function clearRunnerDiagnostics(document) {
    if (diagnostics) diagnostics.delete(document.uri);
}

// ---------------------------------------------------------------------------
// LSP-клиент и мостовые провайдеры VS Code
// ---------------------------------------------------------------------------

function compilerWasmForLsp() {
    try {
        return runner.resolveCompilerWasmPath({
            configuredPath: resolveConfiguredPath(settings.compilerWasmPath),
            extensionPath: extensionPath(),
        });
    } catch (e) {
        return '';
    }
}

async function startLsp() {
    if (!settings.enableLsp) {
        updateStatus('stopped', 'LSP выключен в настройках');
        return false;
    }
    if (client) {
        await client.stop();
        client = null;
    }

    const serverPath = settings.lspServerPath
        ? resolveConfiguredPath(settings.lspServerPath)
        : resolveServerPath({ extensionPath: extensionPath() });
    const repoRoot = runner.repoRootFor(extensionPath()) || extensionPath();
    const env = {};
    const wasmPath = compilerWasmForLsp();
    if (wasmPath) env.LATENT_COMPILER_WASM = wasmPath;

    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0]
        : undefined;

    client = new LspClient({
        serverPath,
        nodePath: settings.nodePath || runner.resolveNodePath(),
        cwd: repoRoot,
        env,
        rootUri: folder ? folder.uri.toString() : null,
        logger: (message) => log(`[LSP] ${message}`),
        onDiagnostics: publishLspDiagnostics,
        onNotification: (method, params) => {
            if (method === 'window/logMessage' && params && params.message) {
                log(`[LSP] ${params.message}`);
            } else if (method === 'window/showMessage' && params && params.message) {
                const kind = params.type;
                if (kind === 1) vscode.window.showErrorMessage(params.message);
                else if (kind === 2) vscode.window.showWarningMessage(params.message);
                else log(`[LSP] ${params.message}`);
            }
        },
        onStateChange: (state, detail) => updateStatus(state, detail),
    });

    const started = await client.start();
    if (!started) {
        const reason = client.lastError || 'неизвестная ошибка';
        log(`[LSP] ${reason}`);
        updateStatus(client.state === 'missing' ? 'missing' : 'error', reason);
        if (!warnedAboutMissingLsp) {
            warnedAboutMissingLsp = true;
            let hint;
            if (client.state === 'missing') {
                hint = 'LSP-сервер не найден. Подсветка, сниппеты и запуск работают; автодополнение, hover и форматирование — только с LSP. Укажите путь в настройке latent.lspServerPath.';
            } else if (/ENOENT|not found|не найден/iu.test(reason)) {
                hint = `Node.js не найден для запуска LSP-сервера (${reason}). Укажите путь к Node в настройке latent.nodePath. Подсветка, сниппеты и запуск работают без LSP.`;
            } else {
                hint = `Не удалось запустить LSP-сервер: ${reason}`;
            }
            vscode.window.showWarningMessage(`Latent: ${hint}`);
        }
        return false;
    }

    log(`[LSP] сервер запущен: ${serverPath}`);
    updateStatus('running', client.serverInfo ? client.serverInfo.name : '');
    for (const document of vscode.workspace.textDocuments) {
        if (isLatentDocument(document)) {
            client.openDocument(document.uri.toString(), document.getText(), {
                version: document.version,
            });
        }
    }
    return true;
}

async function restartLsp(options = {}) {
    log('[LSP] перезапуск по запросу');
    if (client) {
        await client.stop();
        client = null;
    }
    if (diagnostics) diagnostics.clear();
    const started = await startLsp();
    if (!options.silent) {
        if (started) {
            vscode.window.showInformationMessage('Latent: LSP-сервер перезапущен.');
        } else {
            vscode.window.showWarningMessage('Latent: LSP-сервер недоступен — работаем без LSP.');
        }
    }
    return started;
}

function completionKind(kind) {
    if (!Number.isFinite(kind) || kind <= 0) return vscode.CompletionItemKind.Text;
    return Math.max(0, Math.min(kind - 1, vscode.CompletionItemKind.TypeParameter));
}

function markdownFromLsp(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return new vscode.MarkdownString(value);
    if (Array.isArray(value)) {
        const text = value
            .map((part) => (typeof part === 'string' ? part : part && part.value ? part.value : ''))
            .filter(Boolean)
            .join('\n\n');
        return new vscode.MarkdownString(text);
    }
    if (value.kind === 'plaintext') {
        const markdown = new vscode.MarkdownString();
        markdown.appendText(value.value || '');
        return markdown;
    }
    return new vscode.MarkdownString(value.value || '');
}

function documentUri(document) {
    return document.uri.toString();
}

async function provideCompletions(document, position) {
    if (!client || !client.isRunning) return undefined;
    try {
        const result = await client.completion(documentUri(document), position);
        if (!result) return undefined;
        const items = Array.isArray(result) ? result : (result.items || []);
        return items.map((item) => {
            const completion = new vscode.CompletionItem(String(item.label), completionKind(item.kind));
            if (item.detail) completion.detail = item.detail;
            const documentation = markdownFromLsp(item.documentation);
            if (documentation) completion.documentation = documentation;
            if (item.sortText) completion.sortText = item.sortText;
            if (item.filterText) completion.filterText = item.filterText;
            if (item.insertText !== undefined) {
                completion.insertText = item.insertTextFormat === 2
                    ? new vscode.SnippetString(item.insertText)
                    : String(item.insertText);
            }
            if (item.textEdit && item.textEdit.newText !== undefined && item.textEdit.range) {
                completion.range = rangeFromLsp(item.textEdit.range);
                completion.insertText = item.textEdit.newText;
            }
            return completion;
        });
    } catch (e) {
        log(`[LSP] completion: ${e.message}`);
        return undefined;
    }
}

async function provideHover(document, position) {
    if (!client || !client.isRunning) return undefined;
    try {
        const result = await client.hover(documentUri(document), position);
        if (!result || !result.contents) return undefined;
        const contents = markdownFromLsp(result.contents);
        if (!contents) return undefined;
        const range = result.range ? rangeFromLsp(result.range) : undefined;
        return new vscode.Hover(contents, range);
    } catch (e) {
        log(`[LSP] hover: ${e.message}`);
        return undefined;
    }
}

async function provideSignatureHelp(document, position) {
    if (!client || !client.isRunning) return undefined;
    try {
        const result = await client.signatureHelp(documentUri(document), position);
        if (!result || !Array.isArray(result.signatures)) return undefined;
        const help = new vscode.SignatureHelp();
        help.signatures = result.signatures.map((signature) => {
            const info = new vscode.SignatureInformation(
                signature.label || '',
                markdownFromLsp(signature.documentation),
            );
            info.parameters = (signature.parameters || []).map((parameter) => new vscode.ParameterInformation(
                parameter.label,
                markdownFromLsp(parameter.documentation),
            ));
            return info;
        });
        help.activeSignature = Number.isFinite(result.activeSignature) ? result.activeSignature : 0;
        help.activeParameter = Number.isFinite(result.activeParameter) ? result.activeParameter : 0;
        return help;
    } catch (e) {
        log(`[LSP] signatureHelp: ${e.message}`);
        return undefined;
    }
}

async function provideFormattingEdits(document) {
    if (!client || !client.isRunning) return undefined;
    try {
        const edits = await client.formatting(documentUri(document), {
            tabSize: 4,
            insertSpaces: true,
        });
        if (!Array.isArray(edits)) return [];
        return edits.map((edit) => new vscode.TextEdit(rangeFromLsp(edit.range), edit.newText));
    } catch (e) {
        log(`[LSP] formatting: ${e.message}`);
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Компиляция и запуск
// ---------------------------------------------------------------------------

function activeLatentDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isLatentDocument(editor.document)) {
        vscode.window.showWarningMessage('Latent: откройте файл языка Latent (.lat).');
        return null;
    }
    return editor.document;
}

function compileOptions(document) {
    return {
        extensionPath: extensionPath(),
        workspaceRoot: workspaceFolderPath(document),
        latentcPath: resolveConfiguredPath(settings.latentcPath, document) || undefined,
        nodePath: settings.nodePath || undefined,
        compilerWasmPath: resolveConfiguredPath(settings.compilerWasmPath, document) || undefined,
        source: document.getText(),
    };
}

function compileDocument(document, preferCli) {
    const options = compileOptions(document);
    const isFile = document.uri.scheme === 'file';
    // CLI читает файл с диска, поэтому для несохранённого документа
    // компилируем присланный текст через compiler.wasm.
    const canUseCli = preferCli && isFile && !document.isDirty;
    const filePath = isFile ? document.uri.fsPath : path.join(extensionPath(), 'untitled.lat');
    return runner.compileFile(filePath, {
        ...options,
        preferCli: canUseCli,
    });
}

function describeCompileResult(result) {
    if (!result) return 'нет результата';
    const engine = result.engine === 'latentc' ? 'latentc' : 'compiler.wasm';
    const size = result.wasm ? result.wasm.length : 0;
    return `${engine}, ${size} байт WASM`;
}

async function compileCommand() {
    const document = activeLatentDocument();
    if (!document) return;
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Latent: компиляция…',
        cancellable: false,
    }, async () => compileDocument(document, true));

    if (!result.ok) {
        log(`[compile] ошибка (${result.engine || 'wasm'}): ${result.error || 'неизвестно'}`);
        publishRunnerDiagnostics(document, result.diagnostics);
        vscode.window.showErrorMessage(`Latent: ошибка компиляции. ${firstLine(result.error)}`);
        return;
    }

    publishRunnerDiagnostics(document, []);
    log(`[compile] ${document.uri.fsPath || document.fileName}: ${describeCompileResult(result)}`);
    if (document.uri.scheme === 'file') {
        try {
            const outPath = runner.wasmOutputPath(document.uri.fsPath);
            runner.writeWasmFile(outPath, result.wasm);
            log(`[compile] записано: ${outPath}`);
            vscode.window.showInformationMessage(`Latent: скомпилировано в ${path.basename(outPath)} (${result.wasm.length} байт).`);
        } catch (e) {
            vscode.window.showErrorMessage(`Latent: не удалось записать WASM: ${e.message}`);
        }
    } else {
        vscode.window.showInformationMessage(`Latent: скомпилировано (${result.wasm.length} байт WASM); сохраните файл, чтобы получить .wasm.`);
    }
}

async function runCommand() {
    const document = activeLatentDocument();
    if (!document) return;

    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Latent: компиляция и запуск…',
        cancellable: false,
    }, async () => compileDocument(document, true));

    if (!result.ok) {
        log(`[run] ошибка компиляции: ${result.error || 'неизвестно'}`);
        publishRunnerDiagnostics(document, result.diagnostics);
        output.show(true);
        vscode.window.showErrorMessage(`Latent: ошибка компиляции. ${firstLine(result.error)}`);
        return;
    }

    publishRunnerDiagnostics(document, []);
    if (output) {
        output.appendLine('');
        output.appendLine(`=== Запуск: ${document.fileName} (${describeCompileResult(result)}) ===`);
    }

    const executed = runner.runWasm(result.wasm, {
        print: (text) => {
            if (output) output.appendLine(text);
        },
    });
    if (output) output.appendLine('');

    if (executed.ok) {
        const code = executed.result === undefined ? 'без результата' : `результат: ${executed.result}`;
        log(`[run] завершено (${code})`);
        if (executed.truncated) {
            log('[run] вывод обрезан (слишком большой)');
        }
        output.show(true);
    } else {
        log(`[run] ${executed.error}`);
        output.show(true);
        vscode.window.showErrorMessage(`Latent: ${firstLine(executed.error)}`);
    }
}

async function checkCommand() {
    const document = activeLatentDocument();
    if (!document) return;
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Latent: проверка…',
        cancellable: false,
    }, async () => compileDocument(document, false));

    if (result.ok) {
        publishRunnerDiagnostics(document, []);
        log(`[check] ${document.fileName}: ok (${result.wasm.length} байт WASM)`);
        vscode.window.showInformationMessage(`Latent: проверка пройдена (${result.wasm.length} байт WASM).`);
        return;
    }

    publishRunnerDiagnostics(document, result.diagnostics);
    log(`[check] ${document.fileName}: ${result.diagnostics.length} ошибок`);
    const first = result.diagnostics[0];
    const where = first && first.hasPosition ? ` (строка ${first.line}:${first.column})` : '';
    vscode.window.showErrorMessage(`Latent: ${result.diagnostics.length} ошибок${where}. ${firstLine(result.error)}`);
}

async function formatCommand() {
    const document = activeLatentDocument();
    if (!document) return;
    if (!client || !client.isRunning) {
        vscode.window.showWarningMessage('Latent: форматирование требует LSP-сервер (latent.lspServerPath / tooling/latent-lsp).');
        return;
    }
    const edits = await provideFormattingEdits(document);
    if (!edits || edits.length === 0) {
        vscode.window.showInformationMessage('Latent: форматирование не изменило документ.');
        return;
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(document.uri, edits);
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied) {
        vscode.window.showInformationMessage('Latent: документ отформатирован.');
    } else {
        vscode.window.showErrorMessage('Latent: не удалось применить форматирование.');
    }
}

function firstLine(text) {
    if (!text) return 'неизвестная ошибка';
    const line = String(text).split(/\r?\n/u).find((item) => item.trim().length > 0) || String(text);
    return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

// ---------------------------------------------------------------------------
// Активация
// ---------------------------------------------------------------------------

function registerDocumentSync(context) {
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (isLatentDocument(document) && client && client.isRunning) {
            client.openDocument(documentUri(document), document.getText(), { version: document.version });
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (isLatentDocument(event.document) && client && client.isRunning) {
            client.changeDocument(documentUri(event.document), event.document.version, event.document.getText());
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        if (isLatentDocument(document) && client && client.isRunning) {
            client.saveDocument(documentUri(document), document.getText());
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        if (isLatentDocument(document) && client && client.isRunning) {
            client.closeDocument(documentUri(document));
        }
        if (isLatentDocument(document) && diagnostics) {
            diagnostics.delete(document.uri);
        }
    }));
    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
        if (!settings.formatOnSave || !isLatentDocument(event.document)) return;
        if (event.reason !== vscode.TextDocumentSaveReason.Save) return;
        if (!client || !client.isRunning) return;
        event.waitUntil(Promise.resolve(provideFormattingEdits(event.document)).then((edits) => edits || []));
    }));
}

function registerProviders(context) {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        SELECTOR,
        { provideCompletionItems: provideCompletions },
        '.',
        ':',
    ));
    context.subscriptions.push(vscode.languages.registerHoverProvider(
        SELECTOR,
        { provideHover },
    ));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(
        SELECTOR,
        { provideSignatureHelp },
        '(',
        ',',
    ));
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(
        SELECTOR,
        { provideDocumentFormattingEdits: provideFormattingEdits },
    ));
}

function registerCommands(context) {
    const commands = {
        'latent.compile': compileCommand,
        'latent.run': runCommand,
        'latent.check': checkCommand,
        'latent.format': formatCommand,
        'latent.openDocs': async () => {
            try {
                await docs.openDocs(vscode);
            } catch (e) {
                vscode.window.showErrorMessage(`Latent: не удалось открыть документацию: ${e.message}`);
            }
        },
        'latent.openPlayground': async () => {
            try {
                await docs.openPlayground(vscode);
            } catch (e) {
                vscode.window.showErrorMessage(`Latent: не удалось открыть playground: ${e.message}`);
            }
        },
        'latent.restartLsp': () => restartLsp(),
    };
    for (const [id, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }
}

function registerConfigurationListener(context) {
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        const previous = settings;
        settings = readSettings();
        const lspChanged = event.affectsConfiguration('latent.enableLsp')
            || event.affectsConfiguration('latent.lspServerPath')
            || event.affectsConfiguration('latent.nodePath')
            || event.affectsConfiguration('latent.compilerWasmPath');
        if (lspChanged) {
            await restartLsp({ silent: true });
            return;
        }
        if (event.affectsConfiguration('latent.enableDiagnostics') && !settings.enableDiagnostics && diagnostics) {
            diagnostics.clear();
        }
        if (settings.enableLsp !== previous.enableLsp) {
            updateStatus(lspState, lspDetail);
        }
    }));
}

async function activate(context) {
    extensionContext = context;
    settings = readSettings();

    output = vscode.window.createOutputChannel('Latent');
    diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(output, diagnostics, statusItem);

    updateStatus('stopped', 'LSP ещё не запущен');
    output.appendLine('Latent Language 1.0.0');
    output.appendLine(`Расширение: ${extensionPath()}`);
    log(`compiler.wasm: ${compilerWasmForLsp() || '(не найден)'}`);
    log(`latentc: ${runner.resolveLatentcPath({ extensionPath: extensionPath() }) || '(не найден)'}`);

    registerProviders(context);
    registerCommands(context);
    registerDocumentSync(context);
    registerConfigurationListener(context);

    startLsp().catch((e) => {
        log(`[LSP] ошибка запуска: ${e.message}`);
        updateStatus('error', e.message);
    });

    return { dispose: deactivate };
}

async function deactivate() {
    if (client) {
        try {
            await client.dispose();
        } catch (e) {
            // Игнорируем ошибки остановки.
        }
        client = null;
    }
    if (statusItem) {
        statusItem.dispose();
        statusItem = undefined;
    }
    if (diagnostics) {
        diagnostics.dispose();
        diagnostics = undefined;
    }
    if (output) {
        output.dispose();
        output = undefined;
    }
}

module.exports = {
    activate,
    deactivate,
    // Экспорт для отладки/тестов без запуска VS Code.
    _internals: {
        completionKind,
        markdownFromLsp,
        lspSeverityToVscode,
        firstLine,
        rangeFromLsp,
    },
};
