//! AI Core для языка Latent.
//!
//! Реализует streaming inference, function calling, RAG и fine-tuning.
//!
//! Декомпозирован по зонам ответственности:
//! * [`error`] — ошибка AI;
//! * [`provider`] — трейт провайдера и конкретные реализации;
//! * [`factory`] — конфигурация и фабрика провайдеров;
//! * [`embedding`] — детерминированные embeddings и cosine similarity;
//! * [`registry`] — реестр функций для function calling;
//! * [`rag`] — векторная база и RAG-конвейер;
//! * [`stream`] — потоковая выдача токенов;
//! * [`repair`] — self-repair исходника;
//! * [`finetune`] — LoRA fine-tuning (заготовка);
//! * [`api`] — высокоуровневые `ai_infer`/`ai_embed`/`ai_rag`.

mod api;
mod embedding;
mod error;
mod factory;
mod finetune;
mod provider;
mod rag;
mod registry;
mod repair;
mod stream;

pub use api::{ai_embed, ai_infer, ai_rag};
pub use embedding::deterministic_embedding;
pub use error::Error;
pub use factory::{create_provider, AIConfig};
pub use finetune::FineTuner;
pub use provider::{AIProvider, AnthropicProvider, CustomProvider, LocalProvider, OpenAIProvider};
pub use rag::{cosine_similarity, VectorDB};
pub use registry::{FunctionRegistry, FunctionSchema, ParameterSchema, FUNCTION_REGISTRY};
pub use registry::Value;
pub use repair::self_repair;
pub use stream::AIStream;

#[cfg(test)]
mod tests;