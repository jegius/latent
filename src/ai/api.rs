//! Высокоуровневые AI-функции (совместимый API).

use super::embedding::deterministic_embedding;
use super::error::Error;
use super::factory::{create_provider, AIConfig};

/// AI inference
pub fn ai_infer(model: &str, prompt: &str) -> Result<String, Error> {
    let config = AIConfig {
        provider: "openai".to_string(),
        model: model.to_string(),
        api_key: "".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
    };
    let provider = create_provider(&config);
    provider.infer(prompt)
}

/// AI embeddings
pub fn ai_embed(text: &str) -> Vec<f32> {
    // Детерминированный ненулевой embedding вместо нулевой заглушки:
    // нулевой вектор обесценивал бы cosine_similarity и RAG (§8.1).
    deterministic_embedding(text, 1536)
}

pub use super::rag::ai_rag;