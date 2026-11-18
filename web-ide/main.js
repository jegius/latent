// main.js — точка входа Latent IDE.
// Тонкий контроллер: связывает слой отображения (views/) с бизнес-логикой (services/).
// Обработчики команд/файлов/AI вынесены в controllers/ и подмешиваются в прототип.

import { CanvasEditor } from './views/canvas-editor.js';
import { OutputView } from './views/output-view.js';
import { ToolbarView } from './views/toolbar-view.js';
import { AISettingsView } from './views/ai-settings-view.js';
import { FileTreeView } from './views/file-tree-view.js';
import { MenubarView } from './views/menubar-view.js';
import { Modal } from './views/modal-view.js';
import { CompilerService } from './services/compiler-service.js';
import { AISettingsService } from './services/ai-settings-service.js';
import { ShareService } from './services/share-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { HotReload } from './hot-reload.js';
import { installHotkeys } from './hotkeys.js';
import { loadExampleCatalog, loadExampleById } from './examples.js';
import { fileControllerMethods } from './controllers/file-controller.js';
import { commandControllerMethods } from './controllers/command-controller.js';
import { wasmControllerMethods } from './controllers/wasm-controller.js';
import { aiSettingsControllerMethods } from './controllers/ai-settings-controller.js';

/**
 * Контроллер IDE: координирует View и Service.
 * Тело разнесено по миксинам controllers/, подмешиваемым ниже.
 */
class LatentIDEController {
    /**
     * @param {Array<import('./examples.js').Example>} examples — метаданные примеров
     *   (код стартового примера приходит в options.starter; остальные .lat
     *   подгружаются по клику через loadExampleById).
     * @param {{starter?: import('./examples.js').Example, groups?: string[]}} [options]
     */
    constructor(examples = [], options = {}) {
        this.examples = examples;
        // Порядок групп для дерева examples/ и меню File → Examples. Приходит из
        // манифеста, который загружается лениво (dynamic import) на старте.
        this.exampleGroups = options.groups || [];

        // Сервисный слой (бизнес-логика)
        this.compilerService = new CompilerService();
        this.aiSettingsService = new AISettingsService();
        this.shareService = new ShareService();
        const starter = options.starter
            || examples.find(e => e.id === 'sorting' && e.code)
            || examples.find(e => e.code);
        this.workspace = new WorkspaceService({
            initialFiles: [{ name: 'main.lat', code: starter ? starter.code : '' }],
        });

        // Слой отображения
        this.editor = new CanvasEditor('editor-canvas', 'editor');
        this.outputView = new OutputView();
        this.toolbarView = new ToolbarView();
        this.aiSettingsView = new AISettingsView();
        this.fileTreeView = new FileTreeView('file-tree', {
            groupOrder: this.exampleGroups,
        });
        this.menubarView = new MenubarView('.menubar');

        // Дебаунсированный автоперезапуск
        this.hotReload = new HotReload({ onReload: () => this.handleCompile(false) });
        this.wasmTabChecked = false;

        this.init();
    }

    init() {
        // Код из hash-URL (share) имеет приоритет — импортируем во временный файл
        const fromHash = this.shareService.readCodeFromHash();
        if (fromHash) {
            this.workspace.createFile('shared.lat', fromHash);
        }

        // Восстанавливаем активный файл
        const active = this.workspace.getActive();
        if (active) this.editor.setCode(active.code);

        // Каждое изменение кода: персистентность + автоперезапуск
        this.editor.onChange(() => {
            const id = this.workspace.activeId;
            this.workspace.updateCode(id, this.editor.getCode());
            this.hotReload.notifyChange();
        });

        // События тулбара
        this.toolbarView.onCompile(() => this.handleCompile(false));
        this.toolbarView.onCompileWithAI(() => this.handleCompile(true));
        this.toolbarView.onCheckSyntax(() => this.handleCheckSyntax());
        this.toolbarView.onShare(() => this.handleShare());
        this.toolbarView.onHotReloadToggle((enabled) => {
            this.hotReload.toggle(enabled);
            this.outputView.setStatus(
                enabled ? '✓ Auto-run enabled' : 'Auto-run disabled',
                enabled ? 'success' : 'default');
        });
        this.toolbarView.onBuildWasm(() => this.handleBuildWasm());
        this.toolbarView.onNewFile(() => this.handleNewFile());

        // Дерево файлов
        this.fileTreeView.onClick('select', (id) => this.handleSelectFile(id));
        this.fileTreeView.onClick('delete', (id) => this.handleDeleteFile(id));
        this.fileTreeView.onClick('rename', (id, name) => this.handleRenameFile(id, name));
        // Папка examples/ в дереве проекта
        this.fileTreeView.onClick('selectExample', (id) => this.handleLoadExample(id));

        // События табов вывода
        this.outputView.onTabSwitch((tabName) => {
            this.outputView.switchTab(tabName);
            if (tabName === 'wasm') this.handleWasmTab();
        });

        // Настройки AI
        this.setupAISettings();

        // Меню (File/Edit/View/Run/AI/Help) — все пункты рабочие
        this.setupMenubar();

        // Первичный рендер
        this.refreshFileTree();
        this.refreshStatusBar();
    }

    // ========================================================
    // Верхнее меню — все пункты вызывают реальные действия
    // ========================================================
    setupMenubar() {
        const menu = this.menubarView;
        menu.installGlobalClose();
        menu.on('file.new', () => this.handleNewFile());
        menu.on('file.save', () => this.handleSave());
        menu.on('file.share', () => this.handleShare());
        menu.on('edit.undo', () => this.execEditor('undo'));
        menu.on('edit.redo', () => this.execEditor('redo'));
        menu.on('edit.selectAll', () => this.execEditor('selectAll'));
        menu.on('edit.format', () => this.handleFormat());
        menu.on('view.aiSettings', () => this.aiSettingsView.togglePanel());
        menu.on('view.output', () => this.outputView.switchTab('output'));
        menu.on('view.wasm', () => { this.outputView.switchTab('wasm'); this.handleWasmTab(); });
        menu.on('view.insights', () => this.outputView.switchTab('ast'));
        menu.on('run.run', () => this.handleCompile(false));
        menu.on('run.runAI', () => this.handleCompile(true));
        menu.on('run.check', () => this.handleCheckSyntax());
        menu.on('ai.settings', () => this.aiSettingsView.togglePanel());
        menu.on('ai.test', () => this.handleTestAIGateway());
        menu.on('ai.runAI', () => this.handleCompile(true));
        menu.on('help.about', () => this.handleAbout());

        // File → Examples → <группа> → <пример>
        const examplesMenu = [
            {
                label: 'File', items: [
                    { label: 'New File', action: 'file.new' },
                    { label: 'Rename File', action: 'file.rename' },
                    { label: 'Delete File', action: 'file.delete' },
                    { label: 'Save', shortcut: 'Ctrl/⌘+S', action: 'file.save' },
                    { label: 'Share', action: 'file.share' },
                    { label: 'Examples', children: this.buildExampleItems() },
                ],
            },
            {
                label: 'Edit', items: [
                    { label: 'Undo', shortcut: 'Ctrl/⌘+Z', action: 'edit.undo' },
                    { label: 'Redo', shortcut: 'Ctrl/⌘+Shift+Z', action: 'edit.redo' },
                    { label: 'Select All', shortcut: 'Ctrl/⌘+A', action: 'edit.selectAll' },
                    { label: 'Format Code', shortcut: 'Ctrl/⌘+Alt+L', action: 'edit.format' },
                ],
            },
            {
                label: 'View', items: [
                    { label: 'AI Gateway Settings', action: 'view.aiSettings' },
                    { label: 'Output', action: 'view.output' },
                    { label: 'WASM', action: 'view.wasm' },
                    { label: 'AI Insights', action: 'view.insights' },
                ],
            },
            {
                label: 'Run', items: [
                    { label: 'Run', shortcut: 'Ctrl/⌘+Enter', action: 'run.run' },
                    { label: 'Run with AI', shortcut: 'Ctrl/⌘+Shift+Enter', action: 'run.runAI' },
                    { label: 'Check Syntax', action: 'run.check' },
                ],
            },
            {
                label: 'AI', items: [
                    { label: 'AI Gateway Settings', action: 'ai.settings' },
                    { label: 'Test Connection', action: 'ai.test' },
                    { label: 'Run with AI', action: 'ai.runAI' },
                ],
            },
            {
                label: 'Help', items: [
                    { label: 'About', action: 'help.about' },
                ],
            },
        ];

        // Rename/Delete применяем к активному файлу (борьба с отсутствием контекста)
        menu.on('file.rename', () => {
            const active = this.workspace.getActive();
            if (!active) return;
            Modal.prompt({
                title: 'Переименование файла',
                message: 'Новое имя файла:',
                inputValue: active.name,
            }).then((next) => {
                if (next && next.trim()) this.handleRenameFile(active.id, next.trim());
            });
        });
        menu.on('file.delete', () => this.handleDeleteFile(this.workspace.activeId));

        // Обработчики выбора примеров (File → Examples → ...)
        for (const ex of this.examples) {
            menu.on(`example.${ex.id}`, () => this.handleLoadExample(ex.id));
        }

        menu.render(examplesMenu);
    }

    /** Строит пункты подменю File → Examples из групп примеров. */
    buildExampleItems() {
        const byGroup = new Map();
        for (const ex of this.examples) {
            const group = ex.group || 'Misc';
            if (!byGroup.has(group)) byGroup.set(group, []);
            byGroup.get(group).push(ex);
        }
        const ordered = [
            ...this.exampleGroups.filter(g => byGroup.has(g)),
            ...[...byGroup.keys()].filter(g => !this.exampleGroups.includes(g)),
        ];
        return ordered.map(group => ({
            label: group,
            children: byGroup.get(group).map(ex => ({
                label: ex.title,
                action: `example.${ex.id}`,
            })),
        }));
    }

    /** Выполняет команду редактирования в скрытом textarea (undo/redo/selectAll). */
    execEditor(cmd) {
        const ta = this.editor.textarea;
        if (!ta) return;
        ta.focus();
        try {
            document.execCommand(cmd);
        } catch (e) {
            /* ignore */
        }
        this.editor.syncFromTextarea();
    }
}

// Подмешиваем обработчики из контроллеров
Object.assign(LatentIDEController.prototype,
    fileControllerMethods, commandControllerMethods, wasmControllerMethods,
    aiSettingsControllerMethods);

// Запуск IDE: лениво грузим каталог примеров (манифест) и только один
// стартовый исходник. Остальные .lat подтягиваются по клику через
// loadExampleById — в сборке Vite это отдельный чанк `examples`.
let ide = null;

async function bootstrap() {
    try {
        const [{ examples, groups }, starter] = await Promise.all([
            loadExampleCatalog(),
            loadExampleById('sorting').catch(() => undefined),
        ]);
        const catalog = examples.map((meta) =>
            (starter && meta.id === starter.id ? { ...meta, code: starter.code } : meta));
        ide = new LatentIDEController(catalog, { starter, groups });
    } catch (e) {
        console.error('Не удалось загрузить примеры:', e);
        ide = new LatentIDEController([]);
    }
    installHotkeys(() => ide);
}

bootstrap();