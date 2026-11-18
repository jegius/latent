//! Bump-аллокатор памяти и пул строковых констант.

use super::bytecode::ByteBuffer;
use super::module_builder::WasmCodegen;

impl WasmCodegen {
    pub(super) fn alloc_memory(&mut self, size: u32, align: u32) -> u32 {
        let mask = align - 1;
        self.memory_offset = (self.memory_offset + mask) & !mask;
        let addr = self.memory_offset;
        self.memory_offset += size;
        addr
    }

    /// Добавляет строку в data-секцию (с дедупликацией по содержимому).
    /// Формат в памяти: [len u32 LE][utf8 bytes].
    pub(super) fn add_string(&mut self, text: &str) -> u32 {
        if let Some(&addr) = self.strings.get(text) {
            return addr;
        }

        let addr = self.alloc_memory(text.len() as u32 + 4, 4);
        let len_bytes = (text.len() as u32).to_le_bytes();

        self.data_section.push(0x00);
        self.data_section.push(0x41);
        self.data_section.write_i32(addr as i32);
        self.data_section.push(0x0B);

        let mut data = ByteBuffer::new();
        data.extend(&len_bytes);
        data.extend(text.as_bytes());
        let data_bytes = data.into_vec();

        self.data_section.write_u32(data_bytes.len() as u32);
        self.data_section.extend(&data_bytes);
        self.data_count += 1;

        self.strings.insert(text.to_string(), addr);
        addr
    }
}