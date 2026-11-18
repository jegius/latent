//! Побайтовое копирование памяти: `__latent_mem_copy(dst, src, len)`.

use super::*;

impl WasmCodegen {
    /// mem_copy(dst, src, len): побайтовое копирование.
    /// params: 0 dst, 1 src, 2 len; declared locals: 3 $i
    pub(super) fn emit_mem_copy_body(&mut self) {
        let mut b = self.begin_body(1);
        // i = 0
        self.i32c(&mut b, 0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        b.push(op::BLOCK); b.push(valtype::VOID);
        b.push(op::LOOP); b.push(valtype::VOID);
        // if i >= len break
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_GE_U);
        b.push(op::BR_IF); b.write_u32(1);
        // dst[i] = src[i]
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_GET); b.write_u32(1);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_ADD);
        b.push(op::I32_LOAD8_U); b.write_u32(0); b.write_u32(0);
        b.push(op::I32_STORE8); b.write_u32(0); b.write_u32(0);
        // i++
        b.push(op::LOCAL_GET); b.write_u32(3);
        self.i32c(&mut b, 1);
        b.push(op::I32_ADD);
        b.push(op::LOCAL_SET); b.write_u32(3);
        b.push(op::BR); b.write_u32(0);
        b.push(op::END);
        b.push(op::END);
        self.finish_body(b);
    }
}
