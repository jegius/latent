//! Конфигурация AI и фабрика провайдеров.

use super::provider::{
    AIProvider, AnthropicProvider, CustomProvider, LocalProvider, OpenAIProvider,
};

/// Конфигурация AI
pub struct AIConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: String,
}

/// Фабрика провайдеров
pub fn create_provider(config: &AIConfig) -> Box<dyn AIProvider> {
    match config.provider.as_str() {
        "openai" => Box::new(OpenAIProvider::new(
            config.api_key.clone(),
            config.model.clone(),
            config.base_url.clone(),
        )),
        "anthropic" => Box::new(AnthropicProvider::new(
            config.api_key.clone(),
            config.model.clone(),
        )),
        "local" => Box::new(LocalProvider::new(config.model.clone())),
        // `custom` — любой OpenAI-совместимый шлюз (vLLM, llama.cpp-server, Azure).
        "custom" => Box::new(CustomProvider::new(
            config.api_key.clone(),
            config.model.clone(),
            config.base_url.clone(),
        )),
        // Неизвестный провайдер — не паникуем, а используем локальную заглушку.
        other => Box::new(LocalProvider::new(format!("unknown:{}", other))),
    }
}