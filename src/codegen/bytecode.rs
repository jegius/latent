//! Буфер байткода и таблицы опкодов/типов WASM.

/// Буфер для записи WASM байткода
#[derive(Default)]
pub struct ByteBuffer {
    bytes: Vec<u8>,
}

impl ByteBuffer {
    pub fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    pub fn push(&mut self, byte: u8) {
        self.bytes.push(byte);
    }

    pub fn extend(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    /// Записываем unsigned LEB128
    pub fn write_u32(&mut self, mut value: u32) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            self.push(byte);
            if value == 0 { break; }
        }
    }

    /// Записываем signed LEB128
    pub fn write_i32(&mut self, mut value: i32) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            let done = value == 0 && (byte & 0x40) == 0
                    || value == -1 && (byte & 0x40) != 0;
            if !done {
                byte |= 0x80;
            }
            self.push(byte);
            if done { break; }
        }
    }

    /// Записываем unsigned LEB128 для 64-битного значения.
    pub fn write_u64(&mut self, mut value: u64) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            self.push(byte);
            if value == 0 { break; }
        }
    }

    /// Записываем signed LEB128 для 64-битного значения.
    pub fn write_i64(&mut self, mut value: i64) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            let done = value == 0 && (byte & 0x40) == 0
                    || value == -1 && (byte & 0x40) != 0;
            if !done {
                byte |= 0x80;
            }
            self.push(byte);
            if done { break; }
        }
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.bytes
    }

    /// Последний записанный байт (пригодится для проверки trailing RETURN).
    pub fn last_byte(&self) -> Option<u8> {
        self.bytes.last().copied()
    }
}

/// Инструкции WASM
#[allow(dead_code)]
pub mod op {
    pub const UNREACHABLE: u8 = 0x00;
    pub const NOP: u8 = 0x01;
    pub const BLOCK: u8 = 0x02;
    pub const LOOP: u8 = 0x03;
    pub const IF: u8 = 0x04;
    pub const ELSE: u8 = 0x05;
    pub const END: u8 = 0x0B;
    pub const BR: u8 = 0x0C;
    pub const BR_IF: u8 = 0x0D;
    pub const BR_TABLE: u8 = 0x0E;
    pub const RETURN: u8 = 0x0F;

    pub const CALL: u8 = 0x10;
    pub const CALL_INDIRECT: u8 = 0x11;
    pub const DROP: u8 = 0x1A;
    pub const SELECT: u8 = 0x1B;

    pub const LOCAL_GET: u8 = 0x20;
    pub const LOCAL_SET: u8 = 0x21;
    pub const LOCAL_TEE: u8 = 0x22;
    pub const GLOBAL_GET: u8 = 0x23;
    pub const GLOBAL_SET: u8 = 0x24;

    pub const I32_LOAD: u8 = 0x28;
    pub const I64_LOAD: u8 = 0x29;
    pub const F64_LOAD: u8 = 0x2B;
    pub const I32_LOAD8_S: u8 = 0x2C;
    pub const I32_LOAD8_U: u8 = 0x2D;
    pub const I32_STORE: u8 = 0x36;
    pub const I64_STORE: u8 = 0x37;
    pub const F64_STORE: u8 = 0x39;
    pub const I32_STORE8: u8 = 0x3A;
    pub const MEMORY_SIZE: u8 = 0x3F;
    pub const MEMORY_GROW: u8 = 0x40;
    pub const I32_CONST: u8 = 0x41;
    pub const I64_CONST: u8 = 0x42;
    pub const F32_CONST: u8 = 0x43;
    pub const F64_CONST: u8 = 0x44;

    pub const I32_EQZ: u8 = 0x45;
    pub const I32_EQ: u8 = 0x46;
    pub const I32_NE: u8 = 0x47;
    pub const I32_LT_S: u8 = 0x48;
    pub const I32_LT_U: u8 = 0x49;
    pub const I32_GT_S: u8 = 0x4A;
    pub const I32_GT_U: u8 = 0x4B;
    pub const I32_LE_S: u8 = 0x4C;
    pub const I32_LE_U: u8 = 0x4D;
    pub const I32_GE_S: u8 = 0x4E;
    pub const I32_GE_U: u8 = 0x4F;

    pub const I64_EQZ: u8 = 0x50;
    pub const I64_EQ: u8 = 0x51;
    pub const I64_NE: u8 = 0x52;
    pub const I64_LT_S: u8 = 0x53;
    pub const I64_GT_S: u8 = 0x55;
    pub const I64_LE_S: u8 = 0x57;
    pub const I64_GE_S: u8 = 0x59;

    pub const F64_EQ: u8 = 0x61;
    pub const F64_NE: u8 = 0x62;
    pub const F64_LT: u8 = 0x63;
    pub const F64_GT: u8 = 0x64;
    pub const F64_LE: u8 = 0x65;
    pub const F64_GE: u8 = 0x66;

    pub const I32_CLZ: u8 = 0x67;
    pub const I32_CTZ: u8 = 0x68;
    pub const I32_POPCNT: u8 = 0x69;
    pub const I32_ADD: u8 = 0x6A;
    pub const I32_SUB: u8 = 0x6B;
    pub const I32_MUL: u8 = 0x6C;
    pub const I32_DIV_S: u8 = 0x6D;
    pub const I32_DIV_U: u8 = 0x6E;
    pub const I32_REM_S: u8 = 0x6F;
    pub const I32_REM_U: u8 = 0x70;
    pub const I32_AND: u8 = 0x71;
    pub const I32_OR: u8 = 0x72;
    pub const I32_XOR: u8 = 0x73;
    pub const I32_SHL: u8 = 0x74;
    pub const I32_SHR_S: u8 = 0x75;
    pub const I32_SHR_U: u8 = 0x76;

    pub const I64_ADD: u8 = 0x7C;
    pub const I64_SUB: u8 = 0x7D;
    pub const I64_MUL: u8 = 0x7E;
    pub const I64_DIV_S: u8 = 0x7F;
    pub const I64_REM_S: u8 = 0x81;
    pub const I64_AND: u8 = 0x83;
    pub const I64_OR: u8 = 0x84;
    pub const I64_XOR: u8 = 0x85;
    pub const I64_SHL: u8 = 0x86;
    pub const I64_SHR_S: u8 = 0x87;
    pub const I64_SHR_U: u8 = 0x88;

    pub const F64_ADD: u8 = 0xA0;
    pub const F64_SUB: u8 = 0xA1;
    pub const F64_MUL: u8 = 0xA2;
    pub const F64_DIV: u8 = 0xA3;
    pub const F64_ABS: u8 = 0x99;
    pub const F64_NEG: u8 = 0x9A;
    pub const F64_SQRT: u8 = 0x9F;

    // Преобразования i32 <-> f64
    pub const I32_WRAP_I64: u8 = 0xA7;
    pub const I32_TRUNC_F32_S: u8 = 0xA8;
    pub const I32_TRUNC_F32_U: u8 = 0xA9;
    pub const I32_TRUNC_F64_S: u8 = 0xAA;
    pub const I32_TRUNC_F64_U: u8 = 0xAB;
    pub const F64_CONVERT_I32_S: u8 = 0xB7;
    pub const F64_CONVERT_I32_U: u8 = 0xB8;
}

/// Типы значений в WASM
#[allow(dead_code)]
pub mod valtype {
    pub const I32: u8 = 0x7F;
    pub const I64: u8 = 0x7E;
    pub const F32: u8 = 0x7D;
    pub const F64: u8 = 0x7C;
    pub const VOID: u8 = 0x40;
}