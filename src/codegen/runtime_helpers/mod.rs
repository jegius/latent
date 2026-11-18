//! Рантайм-хелперы, эмитируемые прямо в WASM (без host-импортов).
//!
//! Закрывает блокеры селф-хостинга, невыразимые на уровне AST:
//! * байтовый доступ и сдвиги (`i32.load8_u`/`i32.store8`, `shl`/`shr`);
//! * рост памяти (`memory.grow`/`memory.size`);
//! * операции над строками (длина, конкатенация, сравнение, символ);
//! * преобразования `int`↔`string` и `float`→`string`.
//!
//! Строковое представление едино для всего компилятора: `[len u32 LE][utf8]`.
//! Все хелперы — обычные функции модуля, доступные по индексу.
//!
//! Декомпозиция по зонам ответственности (SRP):
//! * [`alloc`] — bump-аллокатор с ростом памяти;
//! * [`mem`] — побайтовое копирование;
//! * [`string`] — длина/конкатенация/сравнение/символ/парсинг строк;
//! * [`int`] — `int`→`string`;
//! * [`f64`] — `float`→`string`.
//!
//! Общие примитивы эмиссии (`begin_body`, `finish_body`, `i32c`, `call`,
//! `g_heap`) живут здесь, чтобы подмодули не дублировали байтовые
//! последовательности.

use super::bytecode::{op, valtype, ByteBuffer};
use super::module_builder::WasmCodegen;

mod alloc;
mod f64;
mod int;
mod mem;
mod string;

/// Имена рантайм-хелперов (ключи в [`WasmCodegen::helpers`]).
pub(super) const ALLOC: &str = "__latent_alloc";
pub(super) const MEM_COPY: &str = "__latent_mem_copy";
pub(super) const STR_LEN: &str = "__latent_str_len";
pub(super) const STR_CONCAT: &str = "__latent_str_concat";
pub(super) const STR_EQ: &str = "__latent_str_eq";
pub(super) const STR_CMP: &str = "__latent_str_cmp";
pub(super) const STR_CHAR_AT: &str = "__latent_str_char_at";
pub(super) const I32_TO_STR: &str = "__latent_i32_to_str";
pub(super) const F64_TO_STR: &str = "__latent_f64_to_str";
pub(super) const STR_TO_I32: &str = "__latent_str_to_i32";

/// Размер страницы памяти WASM.
pub(super) const PAGE: i32 = 65536;

impl WasmCodegen {
    /// Регистрирует сигнатуры всех рантайм-хелперов. Вызывается после
    /// регистрации пользовательских функций, чтобы индексы были стабильны.
    pub(super) fn register_helpers(&mut self) {
        let alloc_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(ALLOC, alloc_ty);

        let copy_ty = self.add_func_type(&[valtype::I32, valtype::I32, valtype::I32], &[]);
        self.register_helper(MEM_COPY, copy_ty);

        let len_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(STR_LEN, len_ty);

        let concat_ty = self.add_func_type(&[valtype::I32, valtype::I32], &[valtype::I32]);
        self.register_helper(STR_CONCAT, concat_ty);

        let eq_ty = self.add_func_type(&[valtype::I32, valtype::I32], &[valtype::I32]);
        self.register_helper(STR_EQ, eq_ty);
        self.register_helper(STR_CMP, eq_ty);

        let char_ty = self.add_func_type(&[valtype::I32, valtype::I32], &[valtype::I32]);
        self.register_helper(STR_CHAR_AT, char_ty);

        let i32s_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(I32_TO_STR, i32s_ty);

        let f64s_ty = self.add_func_type(&[valtype::F64], &[valtype::I32]);
        self.register_helper(F64_TO_STR, f64s_ty);

        let s2i_ty = self.add_func_type(&[valtype::I32], &[valtype::I32]);
        self.register_helper(STR_TO_I32, s2i_ty);
    }

    fn register_helper(&mut self, name: &str, type_idx: u32) {
        let func_idx = self.import_count + self.func_count;
        self.func_count += 1;
        self.func_section.write_u32(type_idx);
        self.helpers.insert(name.to_string(), (func_idx, type_idx));
    }

    /// Индекс хелпера (гарантированно зарегистрирован).
    pub(super) fn helper_idx(&self, name: &str) -> u32 {
        self.helpers.get(name).map(|(i, _)| *i).unwrap_or(0)
    }

    /// Эмитит тела всех хелперов в code-секцию (в том же порядке, что и
    /// записи в func-секции). Вызывается после тел пользовательских функций.
    pub(super) fn emit_helper_bodies(&mut self) {
        self.emit_alloc_body();
        self.emit_mem_copy_body();
        self.emit_str_len_body();
        self.emit_str_concat_body();
        self.emit_str_eq_body();
        self.emit_str_cmp_body();
        self.emit_str_char_at_body();
        self.emit_i32_to_str_body();
        self.emit_f64_to_str_body();
        self.emit_str_to_i32_body();
    }

    /// Начинает тело функции с `n` i32-локалями (все хелперы используют i32,
    /// кроме f64-хелпера, который задаёт локали сам).
    fn begin_body(&mut self, extra_locals: u32) -> ByteBuffer {
        let mut b = ByteBuffer::new();
        if extra_locals > 0 {
            b.write_u32(1);
            b.write_u32(extra_locals);
            b.push(valtype::I32);
        } else {
            b.write_u32(0);
        }
        b
    }

    fn finish_body(&mut self, b: ByteBuffer) {
        let mut body = b;
        body.push(op::END);
        let bytes = body.into_vec();
        self.code_section.write_u32(bytes.len() as u32);
        self.code_section.extend(&bytes);
        self.code_count += 1;
    }

    fn g_heap(&self, b: &mut ByteBuffer) {
        b.push(op::GLOBAL_GET);
        b.write_u32(self.heap_global_idx);
    }

    fn i32c(&self, b: &mut ByteBuffer, v: i32) {
        b.push(op::I32_CONST);
        b.write_i32(v);
    }

    fn call(&self, b: &mut ByteBuffer, name: &str) {
        b.push(op::CALL);
        b.write_u32(self.helper_idx(name));
    }
}
