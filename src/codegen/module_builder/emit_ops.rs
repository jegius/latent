//! Переиспользуемые эмиттеры: load/store и вызов рантайм-хелпера.

use super::super::bytecode::{op, ByteBuffer};
use super::super::module_builder::WasmCodegen;

impl WasmCodegen {
    /// Эмитит i32.load с memarg (align=2, offset=0).
    pub(in crate::codegen) fn emit_i32_load(&self, body: &mut ByteBuffer) {
        body.push(op::I32_LOAD);
        body.write_u32(2); // align = 2^2 = 4 байта
        body.write_u32(0); // offset
    }

    /// Эмитит i32.store с memarg (align=2, offset=0).
    pub(in crate::codegen) fn emit_i32_store(&self, body: &mut ByteBuffer) {
        body.push(op::I32_STORE);
        body.write_u32(2);
        body.write_u32(0);
    }

    /// Эмитит f64.load с memarg (align=3, offset=0).
    pub(in crate::codegen) fn emit_f64_load(&self, body: &mut ByteBuffer) {
        body.push(op::F64_LOAD);
        body.write_u32(3);
        body.write_u32(0);
    }

    /// Эмитит f64.store с memarg (align=3, offset=0).
    pub(in crate::codegen) fn emit_f64_store(&self, body: &mut ByteBuffer) {
        body.push(op::F64_STORE);
        body.write_u32(3);
        body.write_u32(0);
    }

    /// Эмитит call хелпера по имени.
    pub(in crate::codegen) fn emit_helper_call(&self, body: &mut ByteBuffer, name: &str) {
        body.push(op::CALL);
        body.write_u32(self.helper_idx(name));
    }
}
