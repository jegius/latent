//! Shim для JS-вызовов из WASM.
//!
//! Предоставляет хостовые примитивы (вывод, часы, планирование задач) без
//! заглушек: на `wasm32` они делегируются импортам хоста, на нативных сборках
//! (CLI/тесты) — реальным реализациям поверх `std`.
//!
//! * [`print`] — вывод строки в `stdout` (нативный) или через хост `env.print`;
//! * [`now`] — монотонные миллисекунды (нативный — системное время, wasm — хост);
//! * [`queue_microtask`] / [`set_timeout`] — кооперативное планирование через
//!   глобальный [`EVENT_LOOP`](crate::runtime::event_loop::EVENT_LOOP).

use crate::runtime::event_loop::EVENT_LOOP;

/// Ставит задачу в очередь микротасок — она выполнится до следующего пакета
/// макротасок при ближайшем `EventLoop::schedule`.
pub fn queue_microtask<F: FnOnce() + 'static>(task: F) {
    EVENT_LOOP.with(|el| el.enqueue_microtask(task));
}

/// Планирует выполнение задачи не раньше чем через `ms` миллисекунд.
///
/// В кооперативном рантайме фактический запуск происходит при вызове
/// [`EventLoop::schedule`](crate::runtime::event_loop::EventLoop::schedule)
/// после наступления дедлайна.
pub fn set_timeout<F: FnOnce() + 'static>(ms: u32, task: F) {
    let deadline = now() + ms as u64;
    EVENT_LOOP.with(|el| el.enqueue_timer(deadline, task));
}

/// Выводит строку в хост: в `stdout` на нативных сборках, через `env.print`
/// на `wasm32`.
pub fn print(s: &str) {
    #[cfg(target_arch = "wasm32")]
    host::print(s);

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::io::Write;
        let mut out = std::io::stdout();
        let _ = out.write_all(s.as_bytes());
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }
}

/// Текущее время в миллисекундах от эпохи. На `wasm32` берётся у хоста, на
/// нативных сборках — системные часы.
pub fn now() -> u64 {
    #[cfg(target_arch = "wasm32")]
    {
        host::now()
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

/// Хостовые импорты для `wasm32`: реализуются JS-окружением (движок №1/№2).
#[cfg(target_arch = "wasm32")]
mod host {
    extern "C" {
        /// Печатает UTF-8 строку по указателю/длине.
        #[link_name = "latent_host_print"]
        fn js_print(ptr: *const u8, len: usize);

        /// Возвращает текущее время в миллисекундах от эпохи.
        #[link_name = "latent_host_now"]
        fn js_now() -> f64;
    }

    pub fn print(s: &str) {
        unsafe { js_print(s.as_ptr(), s.len()) };
    }

    pub fn now() -> u64 {
        unsafe { js_now() as u64 }
    }
}