//! Дополнительные тесты покрытия AI-подсистемы (`ai/*`), не связанной с
//! `compile_source` (host-only функции).

use super::*;

fn config(provider: &str) -> AIConfig {
    AIConfig {
        provider: provider.to_string(),
        model: "m".to_string(),
        api_key: "k".to_string(),
        base_url: "http://localhost".to_string(),
    }
}

#[test]
fn test_factory_all_branches() {
    for name in ["openai", "anthropic", "local", "custom", "unknown-provider"] {
        let p = create_provider(&config(name));
        assert!(!p.name().is_empty());
    }
}

#[test]
fn test_providers_infer_and_embed() {
    for name in ["openai", "anthropic", "local", "custom", "other"] {
        let p = create_provider(&config(name));
        // Провайдеры offline: infer/embed либо дают детерминированный ответ,
        // либо честную ошибку — но не паникуют.
        let _ = p.infer("hello");
        let _ = p.embed("text");
    }
}

#[test]
fn test_api_helpers() {
    assert!(ai_infer("local", "prompt").is_ok());
    assert!(!ai_embed("text").is_empty());
    assert_eq!(deterministic_embedding("a", 4).len(), 4);
    assert_eq!(deterministic_embedding("a", 4), deterministic_embedding("a", 4));
    assert_ne!(deterministic_embedding("a", 4), deterministic_embedding("b", 4));
}

#[test]
fn test_vector_db_and_rag() {
    let mut db = VectorDB::new();
    db.add("alpha", "doc1");
    db.add("beta", "doc2");
    let hits = db.search("alpha", 2);
    assert!(!hits.is_empty());
    let sim = cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]);
    assert!((sim - 1.0).abs() < 1e-6);
    assert_eq!(cosine_similarity(&[1.0], &[0.0, 0.0]), 0.0);
    assert!(ai_rag("local", &db, "alpha").is_ok());
}

#[test]
fn test_registry_register_call_schema() {
    let mut reg = FunctionRegistry::new();
    reg.register("double", |args| match args.first() {
        Some(Value::Int(n)) => Value::Int(n * 2),
        _ => Value::Int(0),
    });
    assert!(matches!(reg.call("double", vec![Value::Int(21)]).unwrap(), Value::Int(42)));
    assert!(reg.call("missing", vec![]).is_err());
    assert_eq!(reg.get_schema().len(), 1);
}

#[test]
fn test_stream_and_finetune_and_repair() {
    let mut stream = AIStream::new("a b c".to_string());
    assert!(stream.next_token().is_some());
    let mut collected = String::new();
    stream.for_each(|tok| collected.push_str(tok));
    let _ = stream.collect();

    let mut tuner = FineTuner::new("base".to_string(), 4);
    assert!(tuner.param_count() > 0);
    let loss = tuner.train_step("in", "out");
    assert!(loss.is_finite());
    assert!(tuner.weight_norm().is_finite());

    let provider = LocalProvider::new("local".to_string());
    assert!(self_repair(&provider, "fn main() {}", "err").is_ok());
}
