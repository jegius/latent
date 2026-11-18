//! Замыкание и конвертация замыканий в explicit environments.

use super::value::Value;
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

/// Closure conversion — преобразование замыканий в explicit environments
pub struct ClosureConverter {
    counter: usize,
}

impl ClosureConverter {
    pub fn new() -> Self {
        Self { counter: 0 }
    }

    pub fn convert(&mut self, name: &str, _free_vars: Vec<String>) -> String {
        let env_name = format!("__closure_env_{}_{}", name, self.counter);
        self.counter += 1;
        env_name
    }
}