// views/ai-settings-view.js — слой отображения панели настроек AI Gateway.
// Отвечает только за DOM: чтение/запись полей, переключение видимости.
// Не содержит бизнес-логики.

export class AISettingsView {
    constructor() {
        this.panel = document.getElementById('ai-settings');
        this.toggleBtn = document.getElementById('ai-settings-btn');
        this.testBtn = document.getElementById('ai-test-btn');
        this.providerSelect = document.getElementById('ai-provider');
        this.baseUrlInput = document.getElementById('ai-baseurl');
        this.modelInput = document.getElementById('ai-model');
        this.apiKeyInput = document.getElementById('ai-apikey');
    }

    /**
     * Читает текущие значения полей формы.
     * @returns {{provider: string, baseUrl: string, model: string, apiKey: string}}
     */
    readValues() {
        return {
            provider: this.providerSelect.value,
            baseUrl: this.baseUrlInput.value,
            model: this.modelInput.value,
            apiKey: this.apiKeyInput.value,
        };
    }

    /**
     * Записывает значения в поля формы.
     * @param {{provider?: string, baseUrl?: string, model?: string, apiKey?: string}} settings
     */
    writeValues(settings) {
        if (settings.provider !== undefined) this.providerSelect.value = settings.provider;
        if (settings.baseUrl !== undefined) this.baseUrlInput.value = settings.baseUrl;
        if (settings.model !== undefined) this.modelInput.value = settings.model;
        if (settings.apiKey !== undefined) this.apiKeyInput.value = settings.apiKey;
    }

    /**
     * Переключает видимость панели настроек.
     */
    togglePanel() {
        const visible = this.panel.style.display !== 'none';
        this.panel.style.display = visible ? 'none' : 'block';
    }

    /**
     * Регистрирует обработчик кнопки переключения панели.
     * @param {() => void} handler
     */
    onToggle(handler) {
        this.toggleBtn.addEventListener('click', handler);
    }

    /**
     * Регистрирует обработчик изменения любого поля настроек.
     * @param {() => void} handler
     */
    onChange(handler) {
        this.providerSelect.addEventListener('change', handler);
        this.baseUrlInput.addEventListener('change', handler);
        this.modelInput.addEventListener('change', handler);
        this.apiKeyInput.addEventListener('change', handler);
    }

    /**
     * Регистрирует обработчик кнопки проверки соединения.
     * @param {() => void} handler
     */
    onTestConnection(handler) {
        this.testBtn.addEventListener('click', handler);
    }
}
