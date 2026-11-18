//! Тесты runtime.

use super::*;
use std::cell::RefCell;
use std::rc::Rc;

#[test]
fn test_event_loop_creation() {
    let el = EventLoop::new();
    // Новый loop не выполняется.
    assert!(el.run_macrotasks() == false);
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

#[test]
fn test_try_recv_empty_does_not_hang() {
    // Раньше recv() уходил в бесконечный спин — теперь должен вернуть Err("empty").
    let ch: Channel<i32> = Channel::new(4);
    assert_eq!(ch.try_recv(), Err("empty"));
}

#[test]
fn test_recv_empty_returns_error_not_spin() {
    let ch: Channel<i32> = Channel::new(4);
    assert_eq!(ch.recv(), Err("empty"));
}

#[test]
fn test_recv_closed_empty() {
    let ch: Channel<i32> = Channel::new(4);
    ch.close();
    assert_eq!(ch.recv(), Err("Channel closed"));
}

#[test]
fn test_send_after_full_does_not_corrupt_tail() {
    let ch = Channel::new(1);
    ch.send(1).unwrap();
    // Канал полон (capacity=1) — второй send обязан вернуть Err и не двигать tail.
    assert!(ch.send(2).is_err());
    // Первое значение всё ещё читается корректно.
    assert_eq!(ch.recv().unwrap(), 1);
}

#[test]
fn test_event_loop_schedule_runs_all_macrotasks() {
    let el = EventLoop::new();
    let counter = Rc::new(RefCell::new(0));
    for _ in 0..25 {
        let c = counter.clone();
        el.enqueue_macrotask(move || { *c.borrow_mut() += 1; });
    }
    el.schedule();
    // Пакет из 10 не должен «потерять» остальные 15 задач.
    assert_eq!(*counter.borrow(), 25);
}

#[test]
fn test_event_loop_microtasks_drain_first() {
    let el = EventLoop::new();
    let order = Rc::new(RefCell::new(Vec::new()));
    let o1 = order.clone();
    el.enqueue_macrotask(move || o1.borrow_mut().push("macro"));
    let o2 = order.clone();
    el.enqueue_microtask(move || o2.borrow_mut().push("micro"));
    el.schedule();
    assert_eq!(&*order.borrow(), &["micro", "macro"]);
}

#[test]
fn test_run_macrotasks_reports_remaining() {
    let el = EventLoop::new();
    for _ in 0..15 {
        el.enqueue_macrotask(|| {});
    }
    assert!(el.run_macrotasks(), "должны остаться задачи после пакета из 10");
    assert!(!el.run_macrotasks(), "после второго пакета очередь пуста");
}

// ---- Реестр host-функций (аналог funcref-таблицы / call_indirect) --------

#[test]
fn test_func_registry_register_and_call() {
    let reg = exports::FuncRegistry::new();
    let called = Rc::new(RefCell::new(false));
    let c = called.clone();
    let idx = reg.register(move || { *c.borrow_mut() = true; });
    assert!(reg.call(idx), "зарегистрированная функция вызывается");
    assert!(*called.borrow(), "функция действительно выполнена");
    assert!(!reg.call(999), "несуществующий индекс → false");
}

#[test]
fn test_func_registry_global() {
    let idx = exports::register_func(|| {});
    assert!(exports::call_indirect(idx), "глобальный реестр находит функцию");
}

#[test]
fn test_event_loop_spawn_runs_registered() {
    // Регистрируем функцию и планируем её; после schedule она выполнится.
    let called = Rc::new(RefCell::new(0));
    let c = called.clone();
    let idx = exports::register_func(move || { *c.borrow_mut() += 1; });
    // Планирование через event loop напрямую (без глобального состояния тестов).
    let el = EventLoop::new();
    let c2 = called.clone();
    el.enqueue_macrotask(move || {
        assert!(exports::call_indirect(idx));
        let _ = &c2;
    });
    el.schedule();
    assert_eq!(*called.borrow(), 1);
}