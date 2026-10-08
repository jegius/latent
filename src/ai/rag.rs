//! Векторная база данных и RAG-конвейер.

use super::api::ai_infer;
use super::embedding::deterministic_embedding;
use super::error::Error;
use std::collections::HashMap;

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
        let embedding = deterministic_embedding(text, 128);
        self.embeddings.push((doc_id.to_string(), embedding));
        self.documents.insert(doc_id.to_string(), text.to_string());
    }

    pub fn search(&self, query: &str, top_k: usize) -> Vec<String> {
        let query_embedding = deterministic_embedding(query, 128);

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
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
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