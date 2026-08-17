//! Функциональное программирование для языка Latent.
//!
//! Реализует closures, monads (Result, Option, Promise) и pattern matching.

use std::collections::HashMap;
use std::rc::Rc;

/// Closure — функция с захваченным окружением
pub struct Closure {
    pub func: Rc<dyn Fn(&[Value]) -> Value>,
    pub env: HashMap<String, Value>,
}

impl std::fmt::Debug for Closure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Closure")
            .field("env", &self.env)
            .finish()
    }
}

impl Closure {
    pub fn new<F>(func: F, env: HashMap<String, Value>) -> Self
    where
        F: Fn(&[Value]) -> Value + 'static,
    {
        Self {
            func: Rc::new(func),
            env,
        }
    }

    pub fn call(&self, args: &[Value]) -> Value {
        (self.func)(args)
    }
}

/// Значение для FP
#[derive(Debug, Clone)]
pub enum Value {
    Int(i64),
    Float(f64),
    String(String),
    Bool(bool),
    Null,
    Array(Vec<Value>),
    Object(HashMap<String, Value>),
    Closure(Rc<Closure>),
    Result(Box<Result<Value, Value>>),
    Option(Box<OptionType<Value>>),
    Promise(Rc<Promise<Value>>),
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Int(a), Value::Int(b)) => a == b,
            (Value::Float(a), Value::Float(b)) => a == b,
            (Value::String(a), Value::String(b)) => a == b,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Null, Value::Null) => true,
            (Value::Array(a), Value::Array(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => a == b,
            _ => false,
        }
    }
}

/// Result монада
#[derive(Debug, Clone)]
pub enum Result<T, E> {
    Ok(T),
    Err(E),
}

impl<T, E> Result<T, E> {
    pub fn map<U, F>(self, f: F) -> Result<U, E>
    where
        F: FnOnce(T) -> U,
    {
        match self {
            Result::Ok(value) => Result::Ok(f(value)),
            Result::Err(e) => Result::Err(e),
        }
    }

    pub fn flat_map<U, F>(self, f: F) -> Result<U, E>
    where
        F: FnOnce(T) -> Result<U, E>,
    {
        match self {
            Result::Ok(value) => f(value),
            Result::Err(e) => Result::Err(e),
        }
    }

    pub fn unwrap_or(self, default: T) -> T {
        match self {
            Result::Ok(value) => value,
            Result::Err(_) => default,
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Result::Ok(_))
    }

    pub fn is_err(&self) -> bool {
        matches!(self, Result::Err(_))
    }
}

/// Option монада
#[derive(Debug, Clone)]
pub enum OptionType<T> {
    Some(T),
    None,
}

impl<T> OptionType<T> {
    pub fn map<U, F>(self, f: F) -> OptionType<U>
    where
        F: FnOnce(T) -> U,
    {
        match self {
            OptionType::Some(value) => OptionType::Some(f(value)),
            OptionType::None => OptionType::None,
        }
    }

    pub fn flat_map<U, F>(self, f: F) -> OptionType<U>
    where
        F: FnOnce(T) -> OptionType<U>,
    {
        match self {
            OptionType::Some(value) => f(value),
            OptionType::None => OptionType::None,
        }
    }

    pub fn unwrap_or(self, default: T) -> T {
        match self {
            OptionType::Some(value) => value,
            OptionType::None => default,
        }
    }

    pub fn is_some(&self) -> bool {
        matches!(self, OptionType::Some(_))
    }

    pub fn is_none(&self) -> bool {
        matches!(self, OptionType::None)
    }
}

/// Promise монада
pub struct Promise<T> {
    value: std::option::Option<T>,
    callbacks: Vec<Box<dyn FnOnce(&T)>>,
}

impl<T> std::fmt::Debug for Promise<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Promise")
            .field("has_value", &self.value.is_some())
            .finish()
    }
}

impl<T> Promise<T> {
    pub fn new() -> Self {
        Self {
            value: std::option::Option::None,
            callbacks: Vec::new(),
        }
    }

    pub fn resolve(&mut self, value: T) {
        self.value = std::option::Option::Some(value);
        if let std::option::Option::Some(ref v) = self.value {
            for callback in self.callbacks.drain(..) {
                callback(v);
            }
        }
    }

    pub fn then<F>(&mut self, callback: F)
    where
        F: FnOnce(&T) + 'static,
    {
        if let std::option::Option::Some(ref v) = self.value {
            callback(v);
        } else {
            self.callbacks.push(Box::new(callback));
        }
    }

    pub fn map<U, F>(self, f: F) -> Promise<U>
    where
        F: FnOnce(T) -> U + 'static,
        T: 'static,
    {
        let mut new_promise = Promise::new();
        if let std::option::Option::Some(v) = self.value {
            new_promise.resolve(f(v));
        }
        new_promise
    }
}

/// Persistent Vector — immutable data structure
#[derive(Debug, Clone)]
pub struct PersistentVector<T> {
    items: Rc<Vec<T>>,
}

impl<T: Clone> PersistentVector<T> {
    pub fn new() -> Self {
        Self {
            items: Rc::new(Vec::new()),
        }
    }

    pub fn from_vec(items: Vec<T>) -> Self {
        Self {
            items: Rc::new(items),
        }
    }

    pub fn append(&self, item: T) -> Self {
        let mut new_items = (*self.items).clone();
        new_items.push(item);
        Self {
            items: Rc::new(new_items),
        }
    }

    pub fn get(&self, index: usize) -> Option<&T> {
        self.items.get(index)
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn map<U, F>(&self, f: F) -> PersistentVector<U>
    where
        F: Fn(&T) -> U,
        U: Clone,
    {
        let new_items: Vec<U> = self.items.iter().map(f).collect();
        PersistentVector::from_vec(new_items)
    }

    pub fn filter<F>(&self, f: F) -> PersistentVector<T>
    where
        F: Fn(&T) -> bool,
    {
        let new_items: Vec<T> = self.items.iter().filter(|x| f(x)).cloned().collect();
        PersistentVector::from_vec(new_items)
    }
}

/// Pattern matching
pub enum Pattern {
    Wildcard,
    Literal(Value),
    Identifier(String),
    Constructor(String, Vec<Pattern>),
}

/// Match result
pub enum MatchResult {
    Matched(HashMap<String, Value>),
    NotMatched,
}

/// Pattern matching engine
pub fn match_pattern(pattern: &Pattern, value: &Value) -> MatchResult {
    match (pattern, value) {
        (Pattern::Wildcard, _) => MatchResult::Matched(HashMap::new()),
        (Pattern::Literal(lit), value) if lit == value => {
            MatchResult::Matched(HashMap::new())
        }
        (Pattern::Identifier(name), value) => {
            let mut bindings = HashMap::new();
            bindings.insert(name.clone(), value.clone());
            MatchResult::Matched(bindings)
        }
        (Pattern::Constructor(name, args), Value::Object(obj)) => {
            if let Some(Value::String(ctor)) = obj.get("type") {
                if ctor == name {
                    let mut bindings = HashMap::new();
                    for (i, arg) in args.iter().enumerate() {
                        if let Some(field_value) = obj.get(&format!("_{}", i)) {
                            if let MatchResult::Matched(b) = match_pattern(arg, field_value) {
                                bindings.extend(b);
                            } else {
                                return MatchResult::NotMatched;
                            }
                        }
                    }
                    return MatchResult::Matched(bindings);
                }
            }
            MatchResult::NotMatched
        }
        _ => MatchResult::NotMatched,
    }
}

/// Closure conversion — преобразование замыканий в explicit environments
pub struct ClosureConverter {
    counter: usize,
}

impl ClosureConverter {
    pub fn new() -> Self {
        Self { counter: 0 }
    }

    pub fn convert(&mut self, name: &str, free_vars: Vec<String>) -> String {
        let env_name = format!("__closure_env_{}_{}", name, self.counter);
        self.counter += 1;
        env_name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
