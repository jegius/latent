//! Эмиссия экспортов и секций WASM-модуля.

use super::bytecode::{op, valtype, ByteBuffer};
use super::module_builder::WasmCodegen;

impl WasmCodegen {
    /// Экспортирует память и `main`, если он есть.
    pub(crate) fn emit_exports(&mut self) {
        self.export_section.write_u32(6);
        self.export_section.extend(b"memory");
        self.export_section.push(0x02);
        self.export_section.write_u32(0);
        self.export_count += 1;

        if self.functions.contains_key("main") {
            let (func_idx, _) = self.functions["main"];
            self.export_section.write_u32(4);
            self.export_section.extend(b"main");
            self.export_section.push(0x00);
            self.export_section.write_u32(func_idx);
            self.export_count += 1;
        }
    }

    /// Записывает все секции в модуль в правильном порядке.
    pub(crate) fn emit_sections(&mut self) {
        if self.type_count > 0 {
            let mut ts = ByteBuffer::new();
            ts.write_u32(self.type_count);
            ts.extend(&std::mem::take(&mut self.type_section).into_vec());
            self.write_section(1, ts);
        }

        if self.import_count > 0 {
            let mut isec = ByteBuffer::new();
            isec.write_u32(self.import_count);
            isec.extend(&std::mem::take(&mut self.import_section).into_vec());
            self.write_section(2, isec);
        }

        if self.func_count > 0 {
            let mut fs = ByteBuffer::new();
            fs.write_u32(self.func_count);
            fs.extend(&std::mem::take(&mut self.func_section).into_vec());
            self.write_section(3, fs);
        }

        // Table section (ID 4): одна таблица funcref, если есть косвенные вызовы.
        // Все функции, начиная с индекса импортов, лежат в таблице по слотам.
        let total_funcs = self.import_count + self.func_count;
        let need_table = !self.lambdas.is_empty();
        if need_table {
            let mut tb = ByteBuffer::new();
            tb.write_u32(1); // 1 table
            tb.push(0x70); // funcref
            tb.push(0x00); // limits: min only
            tb.write_u32(total_funcs);
            self.write_section(4, tb);
        }

        // Memory section (ID 5)
        let mut mem = ByteBuffer::new();
        mem.write_u32(1);
        mem.push(0x00);
        mem.write_u32(self.memory_pages);
        self.write_section(5, mem);

        // Global section (ID 6): (global $heap_ptr (mut i32) (i32.const memory_offset))
        {
            let mut glob = ByteBuffer::new();
            glob.write_u32(1);
            glob.push(valtype::I32);
            glob.push(0x01);
            glob.push(op::I32_CONST);
            glob.write_i32(self.memory_offset as i32);
            glob.push(op::END);
            self.write_section(6, glob);
        }

        if self.export_count > 0 {
            let mut es = ByteBuffer::new();
            es.write_u32(self.export_count);
            es.extend(&std::mem::take(&mut self.export_section).into_vec());
            self.write_section(7, es);
        }

        // Element section (ID 9): все функции модуля в таблице (шт. total_funcs).
        if need_table {
            let mut elem = ByteBuffer::new();
            elem.write_u32(1); // 1 segment
            elem.push(0x00); // active, table 0
            // offset expr: i32.const 0; end
            elem.push(op::I32_CONST);
            elem.write_i32(0);
            elem.push(op::END);
            elem.write_u32(total_funcs); // число функций
            for i in 0..total_funcs {
                elem.write_u32(i);
            }
            self.write_section(9, elem);
        }

        if self.code_count > 0 {
            let mut cs = ByteBuffer::new();
            cs.write_u32(self.code_count);
            cs.extend(&std::mem::take(&mut self.code_section).into_vec());
            self.write_section(10, cs);
        }

        if self.data_count > 0 {
            let mut ds = ByteBuffer::new();
            ds.write_u32(self.data_count);
            ds.extend(&std::mem::take(&mut self.data_section).into_vec());
            self.write_section(11, ds);
        }
    }
}