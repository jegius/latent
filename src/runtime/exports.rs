//! Экспортируемые функции для WASM-таблицы и реестр host-функций.
//!
//! `call_indirect` в native-рантайме (тот, что использует event loop для
//! отложенного запуска горутин) реализован через реестр `Rc<dyn Fn>`:
//! хост регистрирует функцию по индексу, event loop вызывает её по индексу.

use super::event_loop::EVENT_LOOP;
use std::cell::RefCell;
use std::rc::Rc;

/// Реестр host-функций, вызываемых по индексу из таблицы.
pub struct FuncRegistry {
    funcs: RefCell<Vec<Option<Rc<dyn Fn()>>>>,
}

impl Default for FuncRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl FuncRegistry {
    pub fn new() -> Self {
        Self { funcs: RefCell::new(Vec::new()) }
    }

    /// Регистрирует функцию, возвращает её индекс.
    pub fn register<F: Fn() + 'static>(&self, f: F) -> u32 {
        let mut funcs = self.funcs.borrow_mut();
        let idx = funcs.len() as u32;
        funcs.push(Some(Rc::new(f)));
        idx
    }

    /// Вызывает функцию по индексу. Возвращает false, если индекс пуст.
    pub fn call(&self, idx: u32) -> bool {
        let f = self.funcs.borrow().get(idx as usize).cloned().flatten();
        match f {
            Some(f) => {
                f();
                true
            }
            None => false,
        }
    }

    /// Число зарегистрированных слотов.
    pub fn len(&self) -> usize {
        self.funcs.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        self.funcs.borrow().is_empty()
    }
}

thread_local! {
    /// Глобальный реестр host-функций (аналог WASM funcref-таблицы).
    pub static FUNC_REGISTRY: FuncRegistry = FuncRegistry::new();
}

/// Регистрирует функцию в глобальном реестре.
pub fn register_func<F: Fn() + 'static>(f: F) -> u32 {
    FUNC_REGISTRY.with(|r| r.register(f))
}

/// Планирует вызов host-функции по индексу как macrotask.
pub fn event_loop_spawn(func_idx: u32) {
    EVENT_LOOP.with(|el| {
        el.enqueue_macrotask(move || {
            call_indirect(func_idx);
        });
    });
}

pub fn event_loop_yield() {
    EVENT_LOOP.with(|el| {
        el.yield_();
    });
}

pub fn event_loop_run() {
    EVENT_LOOP.with(|el| {
        el.schedule();
    });
}

/// Косвенный вызов host-функции по индексу через реестр.
/// Возвращает true, если функция найдена и вызвана.
pub fn call_indirect(func_idx: u32) -> bool {
    FUNC_REGISTRY.with(|r| r.call(func_idx))
}