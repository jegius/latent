//! Runtime для языка Latent.
//!
//! Реализует event loop, channels и goroutines в WASM.

use std::collections::VecDeque;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, AtomicPtr, Ordering};
use std::ptr;

/// Event Loop для Latent
pub struct EventLoop {
    microtasks: RefCell<VecDeque<Box<dyn FnOnce()>>>,
    macrotasks: RefCell<VecDeque<Box<dyn FnOnce()>>>,
    running: RefCell<bool>,
}

impl EventLoop {
    pub fn new() -> Self {
        Self {
            microtasks: RefCell::new(VecDeque::new()),
            macrotasks: RefCell::new(VecDeque::new()),
            running: RefCell::new(false),
        }
    }

    pub fn enqueue_microtask<F: FnOnce() + 'static>(&self, task: F) {
        self.microtasks.borrow_mut().push_back(Box::new(task));
    }

    pub fn enqueue_macrotask<F: FnOnce() + 'static>(&self, task: F) {
        self.macrotasks.borrow_mut().push_back(Box::new(task));
    }

    pub fn run_microtasks(&self) {
        while let Some(task) = self.microtasks.borrow_mut().pop_front() {
            task();
        }
    }

    pub fn run_macrotasks(&self) {
        for _ in 0..10 {
            if let Some(task) = self.macrotasks.borrow_mut().pop_front() {
                task();
            } else {
                break;
            }
        }
    }

    pub fn yield_(&self) {
        // Явная передача управления
    }
}

/// Глобальный event loop
thread_local! {
    pub static EVENT_LOOP: Rc<EventLoop> = Rc::new(EventLoop::new());
}

/// Lock-free channel для Latent
pub struct Channel<T> {
    buffer: Vec<AtomicPtr<T>>,
    capacity: usize,
    head: AtomicUsize,
    tail: AtomicUsize,
    closed: AtomicUsize,
}

impl<T> Channel<T> {
    pub fn new(capacity: usize) -> Self {
        let mut buffer = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buffer.push(AtomicPtr::new(ptr::null_mut()));
        }

        Self {
            buffer,
            capacity,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            closed: AtomicUsize::new(0),
        }
    }

    pub fn send(&self, value: T) -> Result<(), &'static str> {
        if self.closed.load(Ordering::Relaxed) == 1 {
            return Err("Channel closed");
        }

        let value_ptr = Box::into_raw(Box::new(value));

        loop {
            let tail = self.tail.load(Ordering::Acquire);
            let head = self.head.load(Ordering::Acquire);

            if tail.wrapping_sub(head) >= self.capacity {
                return Err("Channel full");
            }

            let index = tail % self.capacity;
            let slot = &self.buffer[index];

            if slot.compare_exchange(
                ptr::null_mut(),
                value_ptr,
                Ordering::AcqRel,
                Ordering::Acquire
            ).is_ok() {
                self.tail.store(tail.wrapping_add(1), Ordering::Release);
                return Ok(());
            }

            self.tail.compare_exchange(
                tail,
                tail.wrapping_add(1),
                Ordering::AcqRel,
                Ordering::Acquire
            ).ok();
        }
    }

    pub fn recv(&self) -> Result<T, &'static str> {
        loop {
            let head = self.head.load(Ordering::Acquire);
            let tail = self.tail.load(Ordering::Acquire);

            if head == tail {
                if self.closed.load(Ordering::Relaxed) == 1 {
                    return Err("Channel closed");
                }
                std::hint::spin_loop();
                continue;
            }

            let index = head % self.capacity;
            let slot = &self.buffer[index];

            let value_ptr = slot.load(Ordering::Acquire);
            if value_ptr.is_null() {
                std::hint::spin_loop();
                continue;
            }

            if slot.compare_exchange(
                value_ptr,
                ptr::null_mut(),
                Ordering::AcqRel,
                Ordering::Acquire
            ).is_ok() {
                self.head.store(head.wrapping_add(1), Ordering::Release);

                let value = unsafe { Box::from_raw(value_ptr) };
                return Ok(*value);
            }
        }
    }

    pub fn close(&self) {
        self.closed.store(1, Ordering::Relaxed);
    }
}

/// Shim для JS-вызовов
pub mod shim {
    pub fn queue_microtask<F: FnOnce() + 'static>(_task: F) {
        // В WASM это будет вызов JS queueMicrotask
        // Пока заглушка
    }

    pub fn set_timeout<F: FnOnce() + 'static>(_ms: u32, _task: F) {
        // В WASM это будет вызов JS setTimeout
        // Пока заглушка
    }

    pub fn print(_s: &str) {
        // В WASM это будет вызов JS console.log
        // Пока заглушка
    }

    pub fn now() -> u64 {
        // В WASM это будет вызов JS Date.now()
        // Пока заглушка
        0
    }
}

/// Экспорт функций для WASM
pub mod exports {
    use super::*;

    pub fn event_loop_spawn(func_idx: u32) {
        EVENT_LOOP.with(|el| {
            el.enqueue_macrotask(move || {
                // Вызываем функцию по индексу через таблицу
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
            el.run_microtasks();
            el.run_macrotasks();
        });
    }

    fn call_indirect(_func_idx: u32) {
        // Вызов функции по индексу через таблицу WASM
        // Пока заглушка
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_loop_creation() {
        let el = EventLoop::new();
        assert!(!*el.running.borrow());
    }

    #[test]
    fn test_channel_creation() {
        let ch: Channel<i32> = Channel::new(10);
        assert_eq!(ch.capacity, 10);
    }

    #[test]
    fn test_channel_send_recv() {
        let ch = Channel::new(10);
        ch.send(42).unwrap();
        let value = ch.recv().unwrap();
        assert_eq!(value, 42);
    }

    #[test]
    fn test_channel_multiple() {
        let ch = Channel::new(10);
        ch.send(1).unwrap();
        ch.send(2).unwrap();
        ch.send(3).unwrap();

        assert_eq!(ch.recv().unwrap(), 1);
        assert_eq!(ch.recv().unwrap(), 2);
        assert_eq!(ch.recv().unwrap(), 3);
    }

    #[test]
    fn test_channel_close() {
        let ch = Channel::new(10);
        ch.close();
        assert!(ch.send(42).is_err());
    }
}
