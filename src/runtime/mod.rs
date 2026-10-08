//! Runtime для языка Latent.
//!
//! Реализует event loop, channels и goroutines в WASM.
//!
//! Декомпозирован по зонам ответственности:
//! * [`event_loop`] — кооперативный планировщик micro/macro задач;
//! * [`channel`] — lock-free ring-buffer канал;
//! * [`shim`] — хостовые примитивы JS/WASM (вывод, часы, планирование);
//! * [`exports`] — экспортируемые функции для WASM-таблицы.

mod channel;
mod event_loop;
pub mod exports;
pub mod shim;

pub use channel::Channel;
pub use event_loop::{EventLoop, EVENT_LOOP};

#[cfg(test)]
mod tests;