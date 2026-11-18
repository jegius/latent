//! Дополнительные тесты покрытия функциональных модулей (`fp/*`).

use super::*;
use std::collections::HashMap;

#[test]
fn test_result_monad_full_surface() {
    let ok: Result<i32, String> = Result::Ok(2);
    assert!(ok.is_ok());
    assert!(!ok.is_err());
    assert_eq!(ok.map(|v| v + 1).unwrap_or(0), 3);
    assert_eq!(Result::<i32, String>::Ok(2).flat_map(|v| Result::Ok(v * 2)).unwrap_or(0), 4);
    let err: Result<i32, String> = Result::Err("e".into());
    assert!(err.is_err());
    assert_eq!(err.clone().map(|v| v + 1).unwrap_or(9), 9);
    assert_eq!(err.flat_map(|v| Result::<i32, String>::Ok(v)).unwrap_or(7), 7);
}

#[test]
fn test_option_promise_and_patterns() {
    assert!(OptionType::Some(1).is_some());
    assert!(!OptionType::<i32>::None.is_some());
    assert!(OptionType::<i32>::None.is_none());
    assert_eq!(OptionType::Some(1).map(|v| v + 1).unwrap_or(0), 2);
    assert_eq!(OptionType::Some(2).flat_map(|v| OptionType::Some(v * 3)).unwrap_or(0), 6);
    assert_eq!(OptionType::<i32>::None.unwrap_or(5), 5);

    let promise: Promise<i32> = Promise::new();
    let _ = &promise;
}

#[test]
fn test_match_pattern_all_forms() {
    let value = Value::Int(1);
    assert!(matches!(match_pattern(&Pattern::Wildcard, &value), MatchResult::Matched(_)));
    assert!(matches!(match_pattern(&Pattern::Literal(Value::Int(1)), &value), MatchResult::Matched(_)));
    assert!(matches!(match_pattern(&Pattern::Literal(Value::Int(2)), &value), MatchResult::NotMatched));
    match match_pattern(&Pattern::Identifier("x".into()), &value) {
        MatchResult::Matched(bindings) => assert_eq!(bindings.get("x"), Some(&value)),
        MatchResult::NotMatched => panic!("identifier должен связываться"),
    }
    // Конструктор по объекту с полем type.
    let mut obj = HashMap::new();
    obj.insert("type".to_string(), Value::String("Some".into()));
    obj.insert("_0".to_string(), Value::Int(5));
    let pattern = Pattern::Constructor("Some".into(), vec![Pattern::Identifier("v".into())]);
    match match_pattern(&pattern, &Value::Object(obj)) {
        MatchResult::Matched(bindings) => assert_eq!(bindings.get("v"), Some(&Value::Int(5))),
        MatchResult::NotMatched => panic!("конструктор должен совпасть"),
    }
}

#[test]
fn test_closure_and_converter() {
    let closure = Closure::new(|args: &[Value]| args.first().cloned().unwrap_or(Value::Null), HashMap::new());
    assert_eq!(closure.call(&[Value::Int(3)]), Value::Int(3));
    let mut conv = ClosureConverter::new();
    let name = conv.convert("f", vec!["x".to_string()]);
    assert!(name.contains('f'));
}

#[test]
fn test_persistent_vector() {
    let v = PersistentVector::new().append(1).append(2).append(3);
    assert_eq!(v.len(), 3);
    assert!(!v.is_empty());
    assert_eq!(v.get(1), Some(&2));
    assert_eq!(v.get(9), None);
    let mapped = v.map(|x| x * 2);
    assert_eq!(mapped.get(2), Some(&6));
    let filtered = v.filter(|x| *x > 1);
    assert_eq!(filtered.len(), 2);
    assert_eq!(PersistentVector::from_vec(vec![1, 2]).len(), 2);
    assert!(PersistentVector::<i32>::new().is_empty());
}

#[test]
fn test_value_equality_and_debug() {
    assert_eq!(Value::Int(1), Value::Int(1));
    assert_ne!(Value::Int(1), Value::Int(2));
    assert_ne!(Value::String("1".into()), Value::Int(1));
    assert_eq!(Value::Bool(true), Value::Bool(true));
    assert_eq!(Value::Null, Value::Null);
    assert_ne!(Value::Float(1.5), Value::Float(2.5));
    assert_eq!(Value::Float(1.0), Value::Float(1.0));
}
