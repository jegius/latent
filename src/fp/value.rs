//! Значение для функционального программирования.

use super::closure::Closure;
use super::monads::{OptionType, Promise, Result};
use std::collections::HashMap;
use std::rc::Rc;

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