//! Bump-аллокатор: `__latent_alloc(size) -> ptr` с ростом памяти.

use super::*;

impl WasmCodegen {
    /// alloc(size)->ptr: bump-аллокатор с ростом памяти.
    /// param 0 = size; declared local 1 = ptr, 2 = need_pages, 3 = cur.
    pub(super) fn emit_alloc_body(&mut self) {
        let mut b = self.begin_body(3);
        // ptr = heap
        self.g_heap(&mut b);
        b.push(op::LOCAL_SET); b.write_u32(1);
        // heap = heap + size  (param 0 = size)
        self.g_heap(&mut b);
        b.push(op::LOCAL_GET); b.write_u32(0);
        b.push(op::I32_ADD);
        b.push(op::GLOBAL_SET); b.write_u32(self.heap_global_idx);
        // need_pages = (heap + 65535) / 65536
        self.g_heap(&mut b);
        self.i32c(&mut b, PAGE - 1);
        b.push(op::I32_ADD);
        self.i32c(&mut b, PAGE);
        b.push(op::I32_DIV_U);
        b.push(op::LOCAL_SET); b.write_u32(2);
        // cur = memory.size
        b.push(op::MEMORY_SIZE); b.write_u32(0);
        b.push(op::LOCAL_SET); b.write_u32(3);
        // if cur < need_pages { grow(need-cur) drop }
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::I32_LT_U);
        b.push(op::IF); b.push(valtype::VOID);
        b.push(op::LOCAL_GET); b.write_u32(2);
        b.push(op::LOCAL_GET); b.write_u32(3);
        b.push(op::I32_SUB);
        b.push(op::MEMORY_GROW); b.write_u32(0);
        b.push(op::DROP);
        b.push(op::END);
        b.push(op::LOCAL_GET); b.write_u32(1); // return ptr
        self.finish_body(b);
    }
}
