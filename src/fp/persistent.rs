//! Persistent (immutable) vector.

use std::rc::Rc;

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

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
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