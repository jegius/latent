//! Реестр функций для function calling.

use super::error::Error;
use std::cell::RefCell;
use std::collections::HashMap;

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

// Глобальный реестр функций
thread_local! {
    pub static FUNCTION_REGISTRY: RefCell<FunctionRegistry> =
        RefCell::new(FunctionRegistry::new());
}