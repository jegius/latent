//! Кооперативный event loop: микротаски и пакеты макротасок.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

/// Event Loop для Latent
pub struct EventLoop {
    microtasks: RefCell<VecDeque<Box<dyn FnOnce()>>>,
    macrotasks: RefCell<VecDeque<Box<dyn FnOnce()>>>,
    /// Отложенные задачи: (дедлайн в мс от эпохи, задача).
    timers: RefCell<Vec<(u64, Box<dyn FnOnce()>)>>,
    running: RefCell<bool>,
}

impl EventLoop {
    pub fn new() -> Self {
        Self {
            microtasks: RefCell::new(VecDeque::new()),
            macrotasks: RefCell::new(VecDeque::new()),
            timers: RefCell::new(Vec::new()),
            running: RefCell::new(false),
        }
    }

    pub fn enqueue_microtask<F: FnOnce() + 'static>(&self, task: F) {
        self.microtasks.borrow_mut().push_back(Box::new(task));
    }

    pub fn enqueue_macrotask<F: FnOnce() + 'static>(&self, task: F) {
        self.macrotasks.borrow_mut().push_back(Box::new(task));
    }

    /// Регистрирует отложенную задачу, которая станет доступной после `deadline`.
    pub fn enqueue_timer<F: FnOnce() + 'static>(&self, deadline: u64, task: F) {
        self.timers.borrow_mut().push((deadline, Box::new(task)));
    }

    /// Текущее время в мс от эпохи (через [`crate::runtime::shim::now`]).
    fn now_ms(&self) -> u64 {
        crate::runtime::shim::now()
    }

    /// Переводит все таймеры с наступившим дедлайном в очередь макротасок.
    fn promote_due_timers(&self) {
        let now = self.now_ms();
        let mut timers = self.timers.borrow_mut();
        let mut i = 0;
        while i < timers.len() {
            if timers[i].0 <= now {
                let (_, task) = timers.swap_remove(i);
                self.macrotasks.borrow_mut().push_back(task);
            } else {
                i += 1;
            }
        }
    }

    pub fn run_microtasks(&self) {
        while let Some(task) = self.microtasks.borrow_mut().pop_front() {
            task();
        }
    }

    /// Выполняет пакет macrotask'ов (не более 10). Возвращает true, если
    /// в очереди остались задачи. Перед пакетом активируются таймеры,
    /// дедлайн которых уже наступил.
    pub fn run_macrotasks(&self) -> bool {
        self.promote_due_timers();
        for _ in 0..10 {
            if let Some(task) = self.macrotasks.borrow_mut().pop_front() {
                task();
            } else {
                break;
            }
        }
        !self.macrotasks.borrow().is_empty()
    }

    pub fn yield_(&self) {
        // Явная передача управления
    }

    /// Запускает цикл: опустошает микротаски до дна и гоняет macrotasks
    /// пакетами по 10, пока очередь не опустеет (§6.2 Части VII). Guard от
    /// повторного входа защищает от реентерабельности.
    pub fn schedule(&self) {
        if *self.running.borrow() {
            return;
        }
        *self.running.borrow_mut() = true;

        loop {
            self.run_microtasks();
            let more = self.run_macrotasks();
            if !more {
                break;
            }
        }

        *self.running.borrow_mut() = false;
    }
}

// Глобальный event loop
thread_local! {
    pub static EVENT_LOOP: Rc<EventLoop> = Rc::new(EventLoop::new());
}