//! Lock-free ring-buffer channel для Latent.

use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

/// Lock-free channel для Latent
pub struct Channel<T> {
    buffer: Vec<AtomicPtr<T>>,
    pub(super) capacity: usize,
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

            // Слот занят — перечитываем счётчики и повторяем (§7.4 Части VII).
            // НЕ двигаем tail: иначе в ринге появится «дырка» без значения.
            std::hint::spin_loop();
        }
    }

    /// Неблокирующий приём: возвращает Err("empty"), если данных нет.
    /// В кооперативном рантайме ожидание организует event loop, а не спин
    /// (§7.5 Части VII — спин в единственном потоке это deadlock).
    pub fn try_recv(&self) -> Result<T, &'static str> {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        if head == tail {
            if self.closed.load(Ordering::Relaxed) == 1 {
                return Err("Channel closed");
            }
            return Err("empty");
        }

        let index = head % self.capacity;
        let slot = &self.buffer[index];

        let value_ptr = slot.load(Ordering::Acquire);
        if value_ptr.is_null() {
            return Err("empty");
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

        Err("empty")
    }

    /// Блокирующий приём. В однопоточном окружении вызывать нельзя — вместо
    /// спина возвращаем ошибку, чтобы не заморозить поток.
    pub fn recv(&self) -> Result<T, &'static str> {
        // Спин в единственном потоке — самоубийство (§7.5 Части VII).
        self.try_recv()
    }

    pub fn close(&self) {
        self.closed.store(1, Ordering::Relaxed);
    }
}