//! AI Core для языка Latent.
//!
//! Реализует streaming inference, function calling, RAG и fine-tuning.

use std::collections::HashMap;
use std::cell::RefCell;

/// AI-провайдер
pub trait AIProvider {
    fn infer(&self, prompt: &str) -> Result<String, Error>;
    fn embed(&self, text: &str) -> Result<Vec<f32>, Error>;
    fn name(&self) -> &str;
}

/// Ошибка AI
#[derive(Debug, Clone)]
pub enum Error {
    NotSupported,
    FunctionNotFound,
    NetworkError(String),
    ParseError(String),
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
        // В реальной реализации — HTTP вызов OpenAI API
        // Пока заглушка
        Ok(format!("OpenAI response to: {}", prompt))
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>, Error> {
        // В реальной реализации — HTTP вызов OpenAI Embeddings API
        // Пока заглушка
        Ok(vec![0.0; 1536])
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
        // В реальной реализации — HTTP вызов Anthropic API
        // Пока заглушка
        Ok(format!("Anthropic response to: {}", prompt))
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
        // В реальной реализации — локальный inference через ONNX
        // Пока заглушка
        Ok(format!("Local response to: {}", prompt))
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>, Error> {
        // В реальной реализации — локальные embeddings
        // Пока заглушка
        Ok(vec![0.0; 768])
    }

    fn name(&self) -> &str {
        "local"
    }
}

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
        _ => panic!("Unknown provider: {}", config.provider),
    }
}

/// Function Registry для function calling
pub struct FunctionRegistry {
    functions: HashMap<String, Box<dyn Fn(Vec<Value>) -> Value>>,
}

impl FunctionRegistry {
    pub fn new() -> Self {
        Self {
            functions: HashMap::new(),
        }
    }

    pub fn register<F>(&mut self, name: &str, func: F)
    where
        F: Fn(Vec<Value>) -> Value + 'static,
    {
        self.functions.insert(name.to_string(), Box::new(func));
    }

    pub fn call(&self, name: &str, args: Vec<Value>) -> Result<Value, Error> {
        let func = self.functions.get(name)
            .ok_or(Error::FunctionNotFound)?;
        Ok(func(args))
    }

    pub fn get_schema(&self) -> Vec<FunctionSchema> {
        self.functions.keys().map(|name| {
            FunctionSchema {
                name: name.clone(),
                description: format!("Function {}", name),
                parameters: vec![],
            }
        }).collect()
    }
}

/// Схема функции для AI
pub struct FunctionSchema {
    pub name: String,
    pub description: String,
    pub parameters: Vec<ParameterSchema>,
}

/// Схема параметра
pub struct ParameterSchema {
    pub name: String,
    pub ty: String,
    pub description: String,
}

/// Значение для function calling
#[derive(Debug, Clone)]
pub enum Value {
    Int(i64),
    Float(f64),
    String(String),
    Bool(bool),
    Array(Vec<Value>),
    Object(HashMap<String, Value>),
}

/// Глобальный реестр функций
thread_local! {
    pub static FUNCTION_REGISTRY: RefCell<FunctionRegistry> =
        RefCell::new(FunctionRegistry::new());
}

/// Векторная база данных для RAG
pub struct VectorDB {
    embeddings: Vec<(String, Vec<f32>)>,
    documents: HashMap<String, String>,
}

impl VectorDB {
    pub fn new() -> Self {
        Self {
            embeddings: Vec::new(),
            documents: HashMap::new(),
        }
    }

    pub fn add(&mut self, text: &str, doc_id: &str) {
        let embedding = ai_embed(text);
        self.embeddings.push((doc_id.to_string(), embedding));
        self.documents.insert(doc_id.to_string(), text.to_string());
    }

    pub fn search(&self, query: &str, top_k: usize) -> Vec<String> {
        let query_embedding = ai_embed(query);

        let mut scores: Vec<(String, f32)> = self.embeddings
            .iter()
            .map(|(doc_id, emb)| {
                let sim = cosine_similarity(&query_embedding, emb);
                (doc_id.clone(), sim)
            })
            .collect();

        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        scores.iter()
            .take(top_k)
            .map(|(doc_id, _)| self.documents[doc_id].clone())
            .collect()
    }
}

/// Косинусная схожесть
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

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
    // В реальной реализации — вызов AI API
    // Пока заглушка
    vec![0.0; 1536]
}

/// RAG pipeline
pub fn ai_rag(model: &str, db: &VectorDB, query: &str) -> Result<String, Error> {
    let docs = db.search(query, 3);
    let context = docs.join("\n\n");
    let prompt = format!(
        "Answer the question based on the following context:\n\n{}\n\nQuestion: {}",
        context, query
    );
    ai_infer(model, &prompt)
}

/// Streaming inference
pub struct AIStream {
    buffer: String,
    position: usize,
}

impl AIStream {
    pub fn new(text: String) -> Self {
        Self {
            buffer: text,
            position: 0,
        }
    }

    pub fn next_token(&mut self) -> Option<String> {
        if self.position >= self.buffer.len() {
            return None;
        }

        let start = self.position;
        let mut end = start;

        // Ищем конец слова
        while end < self.buffer.len() && !self.buffer[end..].starts_with(' ') {
            end += 1;
        }

        self.position = end + 1; // +1 для пробела

        Some(self.buffer[start..end].to_string())
    }

    pub fn collect(&mut self) -> String {
        self.buffer.clone()
    }
}

/// Fine-tuning с LoRA
pub struct FineTuner {
    base_model: String,
    lora_weights: Vec<f32>,
    rank: usize,
}

impl FineTuner {
    pub fn new(base_model: String, rank: usize) -> Self {
        let lora_size = 1024 * rank * 2; // Упрощённо
        Self {
            base_model,
            lora_weights: vec![0.0; lora_size],
            rank,
        }
    }

    pub fn train_step(&mut self, input: &str, target: &str) -> f32 {
        // В реальной реализации — forward pass, loss, backward pass
        // Пока заглушка
        0.5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_provider() {
        let provider = OpenAIProvider::new(
            "key".to_string(),
            "gpt-4".to_string(),
            "https://api.openai.com/v1".to_string(),
        );
        assert_eq!(provider.name(), "openai");
    }

    #[test]
    fn test_anthropic_provider() {
        let provider = AnthropicProvider::new("key".to_string(), "claude-3".to_string());
        assert_eq!(provider.name(), "anthropic");
    }

    #[test]
    fn test_local_provider() {
        let provider = LocalProvider::new("model.onnx".to_string());
        assert_eq!(provider.name(), "local");
    }

    #[test]
    fn test_function_registry() {
        let mut registry = FunctionRegistry::new();
        registry.register("add", |args| {
            if let (Value::Int(a), Value::Int(b)) = (&args[0], &args[1]) {
                Value::Int(a + b)
            } else {
                Value::Int(0)
            }
        });

        let result = registry.call("add", vec![Value::Int(1), Value::Int(2)]).unwrap();
        match result {
            Value::Int(n) => assert_eq!(n, 3),
            _ => panic!("Expected int"),
        }
    }

    #[test]
    fn test_vector_db() {
        let mut db = VectorDB::new();
        db.add("Latent is a programming language", "doc1");
        db.add("It compiles to WebAssembly", "doc2");

        let results = db.search("What is Latent?", 2);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert_eq!(cosine_similarity(&a, &b), 1.0);

        let c = vec![0.0, 1.0, 0.0];
        assert_eq!(cosine_similarity(&a, &c), 0.0);
    }

    #[test]
    fn test_ai_stream() {
        let mut stream = AIStream::new("Hello world from Latent".to_string());
        assert_eq!(stream.next_token(), Some("Hello".to_string()));
        assert_eq!(stream.next_token(), Some("world".to_string()));
        assert_eq!(stream.next_token(), Some("from".to_string()));
        assert_eq!(stream.next_token(), Some("Latent".to_string()));
        assert_eq!(stream.next_token(), None);
    }

    #[test]
    fn test_fine_tuner() {
        let mut tuner = FineTuner::new("llama-3-8b".to_string(), 8);
        let loss = tuner.train_step("input", "target");
        assert!(loss >= 0.0);
    }
}
