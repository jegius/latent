//! Генератор кода (codegen) для языка Latent.
//!
//! Превращает типизированное AST в бинарный WebAssembly модуль.
//! Реализует stack machine, locals, linear memory и bump allocator.
//!
//! Декомпозирован по зонам ответственности:
//! * [`bytecode`] — буфер байткода и константы опкодов/valtype;
//! * [`context`] — контекст функции и layout классов;
//! * [`module_builder`] — сборка секций WASM-модуля;
//! * [`emit_stmt`] — кодогенерация инструкций;
//! * [`emit_expr`] — кодогенерация выражений и match;
//! * [`memory`] — bump-аллокатор строк.

mod bytecode;
mod compile_fn;
mod context;
mod emit_call;
mod emit_expr;
mod emit_enum;
mod emit_lambda;
mod emit_match;
mod emit_stmt;
mod memory;
mod module_builder;
mod runtime_helpers;
mod sections;

pub use bytecode::ByteBuffer;
pub use module_builder::WasmCodegen;

#[cfg(test)]
mod tests;