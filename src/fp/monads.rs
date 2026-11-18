//! Монады Result, Option и Promise.

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