//! Детерминированные embeddings: хэш-проекция текста в пространство dim измерений.

/// Детерминированный embedding: хэш-проекция текста в `dim` измерений.
/// Ненулевой и стабильный — пригоден для cosine-similarity и RAG-демо.
pub fn deterministic_embedding(text: &str, dim: usize) -> Vec<f32> {
    let mut v = vec![0.0f32; dim];
    if text.is_empty() {
        return v;
    }
    for (i, byte) in text.bytes().enumerate() {
        let idx = (byte as usize).wrapping_mul(2654435761).wrapping_add(i) % dim;
        v[idx] += 1.0;
    }
    // L2-нормализация (если вектор ненулевой)
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    v
}