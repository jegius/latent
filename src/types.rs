//! Типы данных языка Latent.
//!
//! Определяет базовые типы, AI-типы и типы для многопоточности.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Базовые типы Latent
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LatentType {
    Int,
    Float,
    Bool,
    String,
    Null,
    Unit,
    Array(Box<LatentType>),
    Fn(Vec<LatentType>, Box<LatentType>),
    Generic(String, Vec<LatentType>),
    Union(Vec<LatentType>),
}

impl fmt::Display for LatentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LatentType::Int => write!(f, "int"),
            LatentType::Float => write!(f, "float"),
            LatentType::Bool => write!(f, "bool"),
            LatentType::String => write!(f, "string"),
            LatentType::Null => write!(f, "null"),
            LatentType::Unit => write!(f, "unit"),
            LatentType::Array(inner) => write!(f, "[{}]", inner),
            LatentType::Fn(args, ret) => {
                let args_str: Vec<String> = args.iter().map(|a| a.to_string()).collect();
                write!(f, "fn({}) -> {}", args_str.join(", "), ret)
            }
            LatentType::Generic(name, args) => {
                let args_str: Vec<String> = args.iter().map(|a| a.to_string()).collect();
                write!(f, "{}<{}>", name, args_str.join(", "))
            }
            LatentType::Union(types) => {
                let types_str: Vec<String> = types.iter().map(|t| t.to_string()).collect();
                write!(f, "{}", types_str.join(" | "))
            }
        }
    }
}

/// AI-типы
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AIType {
    Model(Box<LatentType>),
    Embedding(usize),
    Tensor(Vec<usize>),
    Agent,
}

impl fmt::Display for AIType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AIType::Model(inner) => write!(f, "Model<{}>", inner),
            AIType::Embedding(n) => write!(f, "Embedding<{}>", n),
            AIType::Tensor(dims) => {
                let dims_str: Vec<String> = dims.iter().map(|d| d.to_string()).collect();
                write!(f, "Tensor<[{}]>", dims_str.join(", "))
            }
            AIType::Agent => write!(f, "Agent"),
        }
    }
}

/// Типы для многопоточности
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ConcurrencyType {
    Channel(Box<LatentType>),
    Promise(Box<LatentType>),
}

impl fmt::Display for ConcurrencyType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConcurrencyType::Channel(inner) => write!(f, "Channel<{}>", inner),
            ConcurrencyType::Promise(inner) => write!(f, "Promise<{}>", inner),
        }
    }
}

/// Проверяет совместимость типов
pub fn types_compatible(expected: &LatentType, actual: &LatentType) -> bool {
    match (expected, actual) {
        (LatentType::Int, LatentType::Int) => true,
        (LatentType::Float, LatentType::Float) => true,
        (LatentType::Bool, LatentType::Bool) => true,
        (LatentType::String, LatentType::String) => true,
        (LatentType::Null, LatentType::Null) => true,
        (LatentType::Unit, LatentType::Unit) => true,
        (LatentType::Array(a), LatentType::Array(b)) => types_compatible(a, b),
        (LatentType::Fn(a1, r1), LatentType::Fn(a2, r2)) => {
            a1.len() == a2.len()
                && a1.iter().zip(a2.iter()).all(|(x, y)| types_compatible(x, y))
                && types_compatible(r1, r2)
        }
        (LatentType::Generic(n1, a1), LatentType::Generic(n2, a2)) => {
            n1 == n2 && a1.len() == a2.len()
                && a1.iter().zip(a2.iter()).all(|(x, y)| types_compatible(x, y))
        }
        (LatentType::Union(types), actual) => types.iter().any(|t| types_compatible(t, actual)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_type_display() {
        assert_eq!(LatentType::Int.to_string(), "int");
        assert_eq!(LatentType::Float.to_string(), "float");
        assert_eq!(LatentType::Array(Box::new(LatentType::Int)).to_string(), "[int]");
        assert_eq!(
            LatentType::Fn(vec![LatentType::Int, LatentType::Int], Box::new(LatentType::Int)).to_string(),
            "fn(int, int) -> int"
        );
    }

    #[test]
    fn test_ai_type_display() {
        assert_eq!(AIType::Model(Box::new(LatentType::String)).to_string(), "Model<string>");
        assert_eq!(AIType::Embedding(1536).to_string(), "Embedding<1536>");
        assert_eq!(AIType::Tensor(vec![2, 3]).to_string(), "Tensor<[2, 3]>");
    }

    #[test]
    fn test_concurrency_type_display() {
        assert_eq!(ConcurrencyType::Channel(Box::new(LatentType::Int)).to_string(), "Channel<int>");
        assert_eq!(ConcurrencyType::Promise(Box::new(LatentType::String)).to_string(), "Promise<string>");
    }

    #[test]
    fn test_types_compatible() {
        assert!(types_compatible(&LatentType::Int, &LatentType::Int));
        assert!(!types_compatible(&LatentType::Int, &LatentType::String));
        assert!(types_compatible(
            &LatentType::Array(Box::new(LatentType::Int)),
            &LatentType::Array(Box::new(LatentType::Int))
        ));
        assert!(!types_compatible(
            &LatentType::Array(Box::new(LatentType::Int)),
            &LatentType::Array(Box::new(LatentType::String))
        ));
    }

    #[test]
    fn test_union_compatibility() {
        let union = LatentType::Union(vec![LatentType::Int, LatentType::Null]);
        assert!(types_compatible(&union, &LatentType::Int));
        assert!(types_compatible(&union, &LatentType::Null));
        assert!(!types_compatible(&union, &LatentType::String));
    }
}
