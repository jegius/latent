// views/output-view.js — слой отображения панели вывода.
// Отвечает только за DOM: табы, статусы, текстовый вывод.
// Не содержит бизнес-логики.

export class OutputView {
    constructor() {
        this.statusEl = document.getElementById('status');
        this.consoleOutputEl = document.getElementById('console-output');
        this.wasmOutputEl = document.getElementById('wasm-output');
        this.astOutputEl = document.getElementById('ast-output');
        this.aiGatewayStatusEl = document.getElementById('ai-gateway-status');
    }

    /**
     * Переключает активную вкладку.
     * @param {string} tabName — 'output' | 'wasm' | 'ast'
     */
    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
        const tabContent = document.getElementById(tabName);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) tabContent.classList.add('active');
    }

    /**
     * Регистрирует обработчик переключения табов.
     * @param {(tabName: string) => void} handler
     */
    onTabSwitch(handler) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => handler(tab.dataset.tab));
        });
    }

    /**
     * Устанавливает текст статуса в тулбаре.
     * @param {string} text
     * @param {'default'|'success'|'error'|'info'} kind
     */
    setStatus(text, kind = 'default') {
        this.statusEl.textContent = text;
        const colors = {
            default: '',
            success: 'green',
            error: 'red',
            info: '#569cd6',
        };
        this.statusEl.style.color = colors[kind] || '';
    }

    /**
     * Очищает консольный вывод.
     */
    clearConsole() {
        this.consoleOutputEl.textContent = '';
    }

    /**
     * Добавляет строку в консольный вывод.
     * @param {string} text
     */
    appendConsole(text) {
        this.consoleOutputEl.textContent += text;
    }

    /**
     * Устанавливает содержимое вкладки WASM.
     * @param {string} text
     */
    setWasmOutput(text) {
        this.wasmOutputEl.textContent = text;
    }

    /**
     * Устанавливает содержимое вкладки AI Insights.
     * @param {string} text
     */
    setAstOutput(text) {
        this.astOutputEl.textContent = text;
    }

    /**
     * Устанавливает статус AI Gateway.
     * @param {string} text
     * @param {'default'|'ok'|'fail'} kind
     */
    setAIGatewayStatus(text, kind = 'default') {
        this.aiGatewayStatusEl.textContent = text;
        this.aiGatewayStatusEl.className = kind === 'default' ? '' : kind;
    }
}
