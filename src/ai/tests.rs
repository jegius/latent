//! Тесты AI-подсистемы.

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
fn test_custom_provider() {
    let p = CustomProvider::new(
        "key".to_string(),
        "my-model".to_string(),
        "http://localhost:8000/v1".to_string(),
    );
    assert_eq!(p.name(), "custom");
    assert!(p.infer("hi").unwrap().contains("my-model"));
}

#[test]
fn test_create_provider_unknown_does_not_panic() {
    let config = AIConfig {
        provider: "mystery".to_string(),
        model: "m".to_string(),
        api_key: String::new(),
        base_url: String::new(),
    };
    let p = create_provider(&config);
    assert_eq!(p.name(), "local");
}

#[test]
fn test_create_provider_custom() {
    let config = AIConfig {
        provider: "custom".to_string(),
        model: "m".to_string(),
        api_key: "k".to_string(),
        base_url: "http://x".to_string(),
    };
    assert_eq!(create_provider(&config).name(), "custom");
}

#[test]
fn test_deterministic_embedding_nonzero_and_stable() {
    let a = deterministic_embedding("hello world", 64);
    let b = deterministic_embedding("hello world", 64);
    assert_eq!(a, b, "embedding должен быть детерминированным");
    assert!(a.iter().any(|&x| x != 0.0), "embedding не должен быть нулевым");
    // нормализован: L2 ≈ 1
    let norm: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 1e-5, "embedding должен быть L2-нормализован");
}

#[test]
fn test_ai_embed_non_degenerate() {
    let e = ai_embed("latent");
    assert_eq!(e.len(), 1536);
    assert!(e.iter().any(|&x| x != 0.0));
}

#[test]
fn test_self_repair_calls_provider() {
    let provider = LocalProvider::new("m".to_string());
    let out = self_repair(&provider, "fn main() {", "Unexpected EOF").unwrap();
    assert!(out.contains("Unexpected EOF"));
}

#[test]
fn test_ai_stream_next_token_no_offbyone() {
    let mut s = AIStream::new("one two three".to_string());
    assert_eq!(s.next_token().unwrap(), "one");
    assert_eq!(s.next_token().unwrap(), "two");
    assert_eq!(s.next_token().unwrap(), "three");
    assert_eq!(s.next_token(), None);
}

#[test]
fn test_ai_stream_collect_returns_remainder() {
    let mut s = AIStream::new("alpha beta".to_string());
    assert_eq!(s.next_token().unwrap(), "alpha");
    assert_eq!(s.collect().trim(), "beta");
    assert_eq!(s.next_token(), None);
}

#[test]
fn test_ai_stream_for_each() {
    let mut s = AIStream::new("a b c".to_string());
    let mut toks = Vec::new();
    s.for_each(|t| toks.push(t.to_string()));
    assert_eq!(toks, vec!["a", "b", "c"]);
}

#[test]
fn test_ai_stream_multibyte() {
    let mut s = AIStream::new("привет мир".to_string());
    assert_eq!(s.next_token().unwrap(), "привет");
    assert_eq!(s.next_token().unwrap(), "мир");
    assert_eq!(s.next_token(), None);
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

#[test]
fn test_fine_tuner_updates_weights() {
    let mut tuner = FineTuner::new("m".to_string(), 4);
    assert_eq!(tuner.weight_norm(), 0.0, "до обучения веса нулевые");
    tuner.train_step("abc", "xyz");
    assert!(tuner.weight_norm() > 0.0, "шаг обучения должен менять веса");
    assert_eq!(tuner.param_count(), 1024 * 4 * 2);
}

#[test]
fn test_fine_tuner_loss_decreases_on_identical_targets() {
    let mut tuner = FineTuner::new("m".to_string(), 4);
    // Идентичные вход/цель → нулевая ошибка.
    let loss = tuner.train_step("same", "same");
    assert!(loss < 1e-6, "loss для идентичных строк должен быть ~0");
}

#[test]
fn test_openai_embed_non_degenerate() {
    let p = OpenAIProvider::new("k".to_string(), "m".to_string(), "u".to_string());
    let e = p.embed("hello").unwrap();
    assert_eq!(e.len(), 1536);
    assert!(e.iter().any(|&x| x != 0.0));
}