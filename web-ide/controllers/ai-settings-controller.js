// controllers/ai-settings-controller.js — настройки AI Gateway на стороне контроллера.
// Единственная ответственность: связывание AISettingsView и AISettingsService.
// Методы применяются к прототипу LatentIDEController (миксин).

export const aiSettingsControllerMethods = {
    setupAISettings() {
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

        this.aiSettingsView.onToggle(() => this.aiSettingsView.togglePanel());

        this.aiSettingsView.onChange(() => {
            this.aiSettingsService.apply(this.aiSettingsView.readValues());
            this.aiSettingsService.save();
        });

        this.aiSettingsView.onTestConnection(() => this.handleTestAIGateway());
    },

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
    },
};