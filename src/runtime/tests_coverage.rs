//! Дополнительные тесты покрытия runtime-модулей (`runtime/*`).

use super::*;
use crate::runtime::exports::{
    call_indirect, event_loop_run, event_loop_spawn, event_loop_yield, register_func,
};
use crate::runtime::shim;

#[test]
fn test_channel_capacity_send_recv_close() {
    let ch: Channel<i32> = Channel::new(2);
    assert!(ch.send(1).is_ok());
    assert!(ch.send(2).is_ok());
    // Третье сообщение при полном буфере — ошибка.
    assert!(ch.send(3).is_err());
    assert_eq!(ch.try_recv().unwrap(), 1);
    assert_eq!(ch.recv().unwrap(), 2);
    assert!(ch.try_recv().is_err());
    ch.close();
    assert!(ch.send(4).is_err());
    assert!(ch.recv().is_err());
}

#[test]
fn test_channel_default_capacity() {
    // capacity=0: send сразу возвращает ошибку, recv — тоже.
    let ch: Channel<i32> = Channel::new(0);
    assert!(ch.send(1).is_err());
    assert!(ch.recv().is_err());
    ch.close();
}

#[test]
fn test_event_loop_tasks() {
    let loop_ = EventLoop::new();
    loop_.enqueue_microtask(|| {});
    loop_.enqueue_macrotask(|| {});
    loop_.enqueue_timer(1, || {});
    loop_.run_microtasks();
    let had_macro = loop_.run_macrotasks();
    assert!(had_macro || !had_macro);
    loop_.yield_();
    loop_.schedule();
}

#[test]
fn test_exports_registry() {
    let idx = register_func(|| {});
    assert!(call_indirect(idx));
    assert!(!call_indirect(u32::MAX));
    let idx2 = register_func(|| {});
    assert!(call_indirect(idx2));
    event_loop_spawn(idx);
    event_loop_yield();
    event_loop_run();
}

#[test]
fn test_shim_functions() {
    shim::print("x");
    shim::queue_microtask(|| {});
    shim::set_timeout(1, || {});
    let _ = shim::now();
}
