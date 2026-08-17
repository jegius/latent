// main.js — точка входа Latent IDE.
// Тонкий контроллер: связывает слой отображения (views/) с бизнес-логикой (services/).
// Не содержит ни DOM-манипуляций напрямую, ни логики компиляции.

import { CanvasEditor } from './views/canvas-editor.js';
import { OutputView } from './views/output-view.js';
import { ToolbarView } from './views/toolbar-view.js';
import { AISettingsView } from './views/ai-settings-view.js';
import { CompilerService } from './services/compiler-service.js';
import { AISettingsService } from './services/ai-settings-service.js';
import { EXAMPLES, getExampleById } from './examples.js';

// Пример кода по умолчанию — первый пример из коллекции
const DEFAULT_CODE = EXAMPLES[0].code;

/**
 * Контроллер IDE: координирует View и Service.
 */
class LatentIDEController {
    constructor() {
        // Сервисный слой (бизнес-логика)
        this.compilerService = new CompilerService();
        this.aiSettingsService = new AISettingsService();

        // Слой отображения
        this.editor = new CanvasEditor('editor-canvas', 'editor');
        this.outputView = new OutputView();
        this.toolbarView = new ToolbarView();
        this.aiSettingsView = new AISettingsView();

        this.init();
    }

    init() {
        this.editor.setCode(DEFAULT_CODE);

        // События тулбара
        this.toolbarView.onCompile(() => this.handleCompile(false));
        this.toolbarView.onCompileWithAI(() => this.handleCompile(true));
        this.toolbarView.onCheckSyntax(() => this.handleCheckSyntax());

        // Выпадающий список примеров
        this.toolbarView.populateExamples(EXAMPLES);
        this.toolbarView.onExampleSelected((id) => this.handleLoadExample(id));

        // События табов
        this.outputView.onTabSwitch((tabName) => this.outputView.switchTab(tabName));

        // Настройки AI
        this.setupAISettings();
    }

    // ========================================================
    // Обработчики команд (координация Service → View)
    // ========================================================

    /**
     * Компилирует и запускает код, обновляет все вкладки вывода.
     * @param {boolean} withAI
     */
    async handleCompile(withAI) {
        const source = this.editor.getCode();

        try {
            this.outputView.setStatus(withAI ? 'Compiling with AI...' : 'Compiling...');
            this.outputView.clearConsole();

            const { result, logs, bytecode, analysis } =
                await this.compilerService.compileAndRun(source, withAI);

            this.outputView.setStatus(withAI ? 'Running with AI...' : 'Running...');

            // Вкладка Output
            for (const line of logs) {
                this.outputView.appendConsole(line + '\n');
            }
            const label = withAI ? 'AI Result' : 'Result';
            this.outputView.appendConsole(`\n${label}: ${this.compilerService.formatResult(result)}\n`);

            if (withAI) {
                this.outputView.appendConsole(`\n--- AI Code Insights ---\n`);
                this.outputView.appendConsole(`Functions: ${analysis.functions} (${analysis.functionNames.join(', ')})\n`);
                this.outputView.appendConsole(`Loops: ${analysis.loops}, Conditionals: ${analysis.conditionals}\n`);
                this.outputView.appendConsole(`Estimated complexity: ${analysis.complexity}\n`);
                this.outputView.appendConsole(`Lines: ${analysis.lines}, Tokens: ${analysis.tokens}\n`);
            }

            // Вкладка WASM — hex-дамп скомпилированного байткода
            this.outputView.setWasmOutput(this.compilerService.formatBytecode(bytecode));

            // Вкладка AI Insights
            this.outputView.setAstOutput(JSON.stringify(analysis, null, 2));

            this.outputView.setStatus(withAI ? '✓ Done (AI)' : '✓ Done', 'success');
        } catch (e) {
            this.outputView.setStatus('✗ Error', 'error');
            this.outputView.clearConsole();
            this.outputView.appendConsole(`Error: ${e.message}\n`);
            this.outputView.setWasmOutput(`Compilation failed:\n${e.message}`);
        }
    }

    /**
     * Проверяет синтаксис кода.
     */
    async handleCheckSyntax() {
        const source = this.editor.getCode();
        try {
            await this.compilerService.checkSyntax(source);
            this.outputView.setStatus('✓ Syntax OK', 'success');
        } catch (e) {
            this.outputView.setStatus(`✗ ${e.message}`, 'error');
        }
    }

    /**
     * Загружает выбранный пример в редактор.
     * @param {string} id — идентификатор примера из EXAMPLES
     */
    handleLoadExample(id) {
        const example = getExampleById(id);
        if (!example) {
            this.outputView.setStatus(`✗ Example '${id}' not found`, 'error');
            return;
        }
        this.editor.setCode(example.code);
        const hint = example.needsAI
            ? ' — click "🤖 Compile & Run with AI"'
            : ' — click "▶ Compile & Run"';
        this.outputView.setStatus(`Loaded: ${example.title}${hint}`, 'info');
    }

    // ========================================================
    // Настройки AI Gateway (координация AISettingsView ↔ AISettingsService)
    // ========================================================

    setupAISettings() {
        // Загружаем сохранённые настройки
        const saved = this.aiSettingsService.load();
        if (saved) {
            this.aiSettingsView.writeValues({
                provider: saved.provider || 'ollama',
                baseUrl: saved.baseUrl || 'http://localhost:11434',
                model: saved.model || 'qwen3:4b',
                apiKey: saved.apiKey || '',
            });
        }
        this.aiSettingsService.apply(this.aiSettingsView.readValues());

        // Переключение видимости панели
        this.aiSettingsView.onToggle(() => this.aiSettingsView.togglePanel());

        // Применение настроек при изменении полей
        this.aiSettingsView.onChange(() => {
            this.aiSettingsService.apply(this.aiSettingsView.readValues());
            this.aiSettingsService.save();
        });

        // Проверка соединения
        this.aiSettingsView.onTestConnection(() => this.handleTestAIGateway());
    }

    /**
     * Проверяет соединение с AI-гейтвеем и выводит статус.
     */
    async handleTestAIGateway() {
        this.outputView.setAIGatewayStatus('checking...');
        this.aiSettingsService.apply(this.aiSettingsView.readValues());

        const result = await this.aiSettingsService.testConnection();
        if (result.ok) {
            const models = result.models
                ? ` — models: ${result.models.slice(0, 3).join(', ')}${result.models.length > 3 ? '…' : ''}`
                : '';
            this.outputView.setAIGatewayStatus(`✓ connected${models}`, 'ok');
        } else {
            this.outputView.setAIGatewayStatus(`✗ ${result.error}`, 'fail');
        }
    }
}

// Запуск IDE
new LatentIDEController();
