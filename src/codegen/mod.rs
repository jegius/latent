//! Генератор кода (codegen) для языка Latent.
//!
//! Превращает типизированное AST в бинарный WebAssembly модуль.
//! Реализует stack machine, locals, linear memory и bump allocator.
//!
//! Декомпозирован по зонам ответственности (SRP):
//! * [`bytecode`] — буфер байткода и константы опкодов/valtype;
//! * [`context`] — контекст функции, статические типы и layout классов;
//! * [`module_builder`] — состояние модуля, порядок проходов и переиспользуемые
//!   эмиттеры (`i32.load/store`, `emit_helper_call`);
//! * [`compile_fn`] — тело функции: локали, env лямбд, финальный return;
//! * [`emit_stmt`] — кодогенерация инструкций;
//! * [`emit_expr`] — кодогенерация выражений, бинарных операций и доступа к полям;
//! * [`emit_call`] — вызовы функций, конструкторы, методы и литералы массивов;
//! * [`emit_lambda`] — closure conversion и косвенные вызовы;
//! * [`emit_match`] / [`emit_enum`] — sum-типы и pattern matching;
//! * [`runtime_helpers`] — рантайм-хелперы (аллокатор, строки, конверсии);
//! * [`memory`] — пул строковых констант в data-секции;
//! * [`sections`] — эмиссия секций WASM-модуля.

mod bytecode;
mod compile_fn;
mod context;
mod emit_call;
mod emit_enum;
mod emit_expr;
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
