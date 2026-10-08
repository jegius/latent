//! Окружение типизации — стек областей видимости.

use super::types::{free_vars, Type};
use std::collections::{HashMap, HashSet};

/// Окружение — стек областей видимости
pub struct Environment {
    pub(super) scopes: Vec<HashMap<String, Type>>,
}

impl Environment {
    pub fn new() -> Self {
        let mut env = Self { scopes: vec![HashMap::new()] };
        env.bind("print", Type::Fn(vec![Type::String], Box::new(Type::Unit)));
        env.bind("sqrt", Type::Fn(vec![Type::Float], Box::new(Type::Float)));
        // channel<T>() -> channel (встроенный тип канала)
        env.bind("channel", Type::Fn(
            vec![],
            Box::new(Type::Named("channel".to_string()))
        ));
        // assert(condition: bool) -> unit
        env.bind("assert", Type::Fn(vec![Type::Bool], Box::new(Type::Unit)));
        env
    }

    pub fn enter_scope(&mut self) {
        self.scopes.push(HashMap::new());
    }

    pub fn exit_scope(&mut self) {
        self.scopes.pop();
    }

    pub fn bind(&mut self, name: &str, ty: Type) {
        let current = self.scopes.last_mut().unwrap();
        current.insert(name.to_string(), ty);
    }

    pub fn lookup(&self, name: &str) -> Option<&Type> {
        for scope in self.scopes.iter().rev() {
            if let Some(ty) = scope.get(name) {
                return Some(ty);
            }
        }
        None
    }

    pub(super) fn free_vars(&self) -> HashSet<String> {
        let mut set = HashSet::new();
        for scope in &self.scopes {
            for ty in scope.values() {
                set.extend(free_vars(ty));
            }
        }
        set
    }
}