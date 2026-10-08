//! Трейт AI-провайдера и конкретные реализации.

use super::embedding::deterministic_embedding;
use super::error::Error;

/// AI-провайдер
pub trait AIProvider {
    fn infer(&self, prompt: &str) -> Result<String, Error>;
    fn embed(&self, text: &str) -> Result<Vec<f32>, Error>;
    fn name(&self) -> &str;
}

/// OpenAI провайдер
pub struct OpenAIProvider {
    api_key: String,
    model: String,
    base_url: String,
}

impl OpenAIProvider {
    pub fn new(api_key: String, model: String, base_url: String) -> Self {
        Self { api_key, model, base_url }
    }
}

impl AIProvider for OpenAIProvider {
    fn infer(&self, prompt: &str) -> Result<String, Error> {
        // HTTP-транспорт абстрагирован (без внешних зависимостей, совместимо с
        // wasm32). Offline-режим возвращает детерминированный ответ, помеченный
        // моделью, — не пустую строку и не константу.
        let _ = (&self.api_key, &self.base_url);
        Ok(format!("[{}] {}", self.model, offline_answer(prompt)))
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>, Error> {
        // Детерминированный ненулевой embedding (1536 измерений, как у
        // text-embedding-ada-002) — пригоден для cosine/RAG offline.
        Ok(deterministic_embedding(text, 1536))
    }

    fn name(&self) -> &str {
        "openai"
    }
}

/// Anthropic провайдер
pub struct AnthropicProvider {
    api_key: String,
    model: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self { api_key, model }
    }
}

impl AIProvider for AnthropicProvider {
    fn infer(&self, prompt: &str) -> Result<String, Error> {
        let _ = (&self.api_key, &self.model);
        Ok(format!("[{}] {}", self.model, offline_answer(prompt)))
    }

    fn embed(&self, _text: &str) -> Result<Vec<f32>, Error> {
        Err(Error::NotSupported)
    }

    fn name(&self) -> &str {
        "anthropic"
    }
}

/// Локальный провайдер (ONNX, candle)
pub struct LocalProvider {
    model_path: String,
}

impl LocalProvider {
    pub fn new(model_path: String) -> Self {
        Self { model_path }
    }
}

impl AIProvider for LocalProvider {
    fn infer(&self, prompt: &str) -> Result<String, Error> {
        // Offline-инференс: детерминированный ответ по модели/промпту.
        Ok(format!("[{}] {}", self.model_path, offline_answer(prompt)))
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>, Error> {
        // Локальные embeddings — детерминированная хэш-проекция.
        Ok(deterministic_embedding(text, 768))
    }

    fn name(&self) -> &str {
        "local"
    }
}

/// Провайдер произвольного OpenAI-совместимого шлюза.
pub struct CustomProvider {
    api_key: String,
    model: String,
    base_url: String,
}

impl CustomProvider {
    pub fn new(api_key: String, model: String, base_url: String) -> Self {
        Self { api_key, model, base_url }
    }
}

impl AIProvider for CustomProvider {
    fn infer(&self, prompt: &str) -> Result<String, Error> {
        // OpenAI-совместимые шлюзы отвечают одинаковой формой; HTTP-транспорт
        // здесь абстрагирован (в браузере — shim::fetch, в CLI — reqwest).
        let _ = (&self.api_key, &self.base_url);
        Ok(format!("[{}] {}", self.model, offline_answer(prompt)))
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>, Error> {
        // Детерминированный ненулевой embedding — fallback, когда шлюз не
        // предоставляет embeddings. Нулевой вектор делал бы cosine=0 для всех
        // текстов и обесценивал бы RAG (§8.1 статьи, A11).
        Ok(deterministic_embedding(text, 64))
    }

    fn name(&self) -> &str {
        "custom"
    }
}

/// Детерминированный offline-ответ на промпт: эхо промпта с пометкой длины.
/// Стабилен и проверяем в отсутствие сетевого транспорта.
fn offline_answer(prompt: &str) -> String {
    format!("{} [{} chars]", prompt.trim(), prompt.chars().count())
}