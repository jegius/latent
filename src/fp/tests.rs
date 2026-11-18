//! Тесты модуля функционального программирования.

use super::*;
use std::collections::HashMap;

#[test]
fn test_closure() {
    let mut env = HashMap::new();
    env.insert("x".to_string(), Value::Int(10));

    let closure = Closure::new(move |args| {
        if let Value::Int(y) = args[0] {
            Value::Int(10 + y)
        } else {
            Value::Int(0)
        }
    }, env);

    let result = closure.call(&[Value::Int(5)]);
    match result {
        Value::Int(n) => assert_eq!(n, 15),
        _ => panic!("Expected int"),
    }
}

#[test]
fn test_result_map() {
    let result: Result<i32, String> = Result::Ok(5);
    let doubled = result.map(|x| x * 2);
    assert!(doubled.is_ok());
}

#[test]
fn test_result_flat_map() {
    let result: Result<i32, String> = Result::Ok(5);
    let doubled = result.flat_map(|x| Result::Ok(x * 2));
    assert!(doubled.is_ok());
}

#[test]
fn test_result_unwrap_or() {
    let result: Result<i32, String> = Result::Ok(5);
    assert_eq!(result.unwrap_or(0), 5);

    let result: Result<i32, String> = Result::Err("error".to_string());
    assert_eq!(result.unwrap_or(0), 0);
}

#[test]
fn test_option_map() {
    let option: OptionType<i32> = OptionType::Some(5);
    let doubled = option.map(|x| x * 2);
    assert!(doubled.is_some());
}

#[test]
fn test_option_unwrap_or() {
    let option: OptionType<i32> = OptionType::Some(5);
    assert_eq!(option.unwrap_or(0), 5);

    let option: OptionType<i32> = OptionType::None;
    assert_eq!(option.unwrap_or(0), 0);
}

#[test]
fn test_promise() {
    let mut promise = Promise::new();
    promise.resolve(42);
    // Promise resolved
}

#[test]
fn test_persistent_vector() {
    let vec = PersistentVector::from_vec(vec![1, 2, 3]);
    assert_eq!(vec.len(), 3);

    let new_vec = vec.append(4);
    assert_eq!(vec.len(), 3);
    assert_eq!(new_vec.len(), 4);
}

#[test]
fn test_persistent_vector_map() {
    let vec = PersistentVector::from_vec(vec![1, 2, 3]);
    let doubled = vec.map(|x| x * 2);
    assert_eq!(doubled.get(0), Some(&2));
    assert_eq!(doubled.get(1), Some(&4));
    assert_eq!(doubled.get(2), Some(&6));
}

#[test]
fn test_persistent_vector_filter() {
    let vec = PersistentVector::from_vec(vec![1, 2, 3, 4, 5]);
    let evens = vec.filter(|x| x % 2 == 0);
    assert_eq!(evens.len(), 2);
}

#[test]
fn test_pattern_matching() {
    let pattern = Pattern::Identifier("x".to_string());
    let value = Value::Int(42);

    match match_pattern(&pattern, &value) {
        MatchResult::Matched(bindings) => {
            assert!(bindings.contains_key("x"));
        }
        MatchResult::NotMatched => panic!("Expected match"),
    }
}

#[test]
fn test_closure_converter() {
    let mut converter = ClosureConverter::new();
    let env_name = converter.convert("add", vec!["x".to_string(), "y".to_string()]);
    assert!(env_name.starts_with("__closure_env_add_"));
}