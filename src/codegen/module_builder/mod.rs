//! Сборка секций WASM-модуля: состояние генератора и порядок проходов.
//!
//! Декомпозиция по зонам ответственности:
//! * [`collect`] — первый проход: layout'ы классов, варианты enum, сигнатуры
//!   функций и методов;
//! * [`emit_ops`] — переиспользуемые эмиттеры (`i32.load/store`, `f64.load/store`,
//!   вызов рантайм-хелпера).

use super::bytecode::{valtype, ByteBuffer};
use super::context::{ClassLayout, StaticTy};
use crate::ast::*;
use std::collections::HashMap;

mod collect;
mod emit_ops;

/// Генератор WASM кода
pub struct WasmCodegen {
    pub(super) module: ByteBuffer,
    pub(super) type_section: ByteBuffer,
    pub(super) type_count: u32,
    pub(super) import_section: ByteBuffer,
    pub(super) import_count: u32,
    pub(super) func_section: ByteBuffer,
    pub(super) func_count: u32,
    pub(super) export_section: ByteBuffer,
    pub(super) export_count: u32,
    pub(super) code_section: ByteBuffer,
    pub(super) code_count: u32,
    pub(super) data_section: ByteBuffer,
    pub(super) data_count: u32,
    pub(super) functions: HashMap<String, (u32, u32)>,
    pub(super) memory_offset: u32,
    pub(super) strings: HashMap<String, u32>,
    pub(super) class_layouts: HashMap<String, ClassLayout>,
    pub(super) heap_global_idx: u32,
    /// Индекс импортированной функции `print` в пространстве функций.
    pub(super) print_func_idx: u32,
    /// Имена функций без результата — их вызов не оставляет значения на стеке.
    pub(super) void_functions: std::collections::HashSet<String>,
    /// Рантайм-хелперы: имя → (индекс функции, индекс типа).
    pub(super) helpers: HashMap<String, (u32, u32)>,
    /// Таблица конструкторов enum-вариантов: имя варианта → (tag, арность).
    pub(super) enum_variants: HashMap<String, (i32, usize)>,
    /// Число страниц памяти (start). Растёт в рантайме через memory.grow.
    pub(super) memory_pages: u32,
    /// Кеш сигнатур функций (params, results) → index типа (дедупликация).
    pub(super) type_cache: HashMap<(Vec<u8>, Vec<u8>), u32>,
    /// Лямбды, обнаруженные при генерации тел (в порядке регистрации).
    pub(super) lambdas: Vec<super::emit_lambda::LambdaInfo>,
    /// Ключ лямбды (offset позиции) → индекс в `lambdas`.
    pub(super) lambda_map: HashMap<usize, u32>,
    /// Статический тип результата пользовательской функции.
    pub(super) fn_return_static: HashMap<String, StaticTy>,
}

impl WasmCodegen {
    pub fn new() -> Self {
        let mut codegen = Self {
            module: ByteBuffer::new(),
            type_section: ByteBuffer::new(),
            func_section: ByteBuffer::new(),
            export_section: ByteBuffer::new(),
            code_section: ByteBuffer::new(),
            data_section: ByteBuffer::new(),
            import_section: ByteBuffer::new(),
            type_count: 0,
            func_count: 0,
            import_count: 0,
            export_count: 0,
            code_count: 0,
            data_count: 0,
            functions: HashMap::new(),
            memory_offset: 1024,
            strings: HashMap::new(),
            class_layouts: HashMap::new(),
            heap_global_idx: 0,
            print_func_idx: 0,
            void_functions: std::collections::HashSet::new(),
            helpers: HashMap::new(),
            enum_variants: HashMap::new(),
            memory_pages: 16,
            type_cache: HashMap::new(),
            lambdas: Vec::new(),
            lambda_map: HashMap::new(),
            fn_return_static: HashMap::new(),
        };
        codegen.add_import_print();
        codegen
    }

    /// Регистрирует импорт `env.print(i32)` — хост читает строку из памяти и
    /// печатает. Импорт занимает индекс 0 в пространстве функций, ВСЕ
    /// пользовательские функции сдвигаются на 1 (§6.2).
    fn add_import_print(&mut self) {
        // Тип print: (i32) -> void
        let type_idx = self.add_func_type(&[valtype::I32], &[]);
        // Импорт: module="env", name="print", kind=func(0), type_idx
        self.import_section.write_u32(3);
        self.import_section.extend(b"env");
        self.import_section.write_u32(5);
        self.import_section.extend(b"print");
        self.import_section.push(0x00); // func import
        self.import_section.write_u32(type_idx);
        self.import_count += 1;
        self.print_func_idx = 0;
    }

    fn write_header(&mut self) {
        self.module.extend(&[0x00, 0x61, 0x73, 0x6D]);
        self.module.extend(&[0x01, 0x00, 0x00, 0x00]);
    }

    pub(crate) fn write_section(&mut self, id: u8, content: ByteBuffer) {
        self.module.push(id);
        let bytes = content.into_vec();
        self.module.write_u32(bytes.len() as u32);
        self.module.extend(&bytes);
    }

    pub(super) fn add_func_type(&mut self, params: &[u8], results: &[u8]) -> u32 {
        let idx = self.type_count;
        self.type_count += 1;

        self.type_section.push(0x60);
        self.type_section.write_u32(params.len() as u32);
        for p in params {
            self.type_section.push(*p);
        }
        self.type_section.write_u32(results.len() as u32);
        for r in results {
            self.type_section.push(*r);
        }

        idx
    }

    /// Дедуплицирующий вариант: одна и та же сигнатура → один индекс типа.
    /// Обязателен для `call_indirect` (тип вызова должен точно совпадать с
    /// типом функции в таблице).
    pub(super) fn add_func_type_cached(&mut self, params: &[u8], results: &[u8]) -> u32 {
        let key = (params.to_vec(), results.to_vec());
        if let Some(&idx) = self.type_cache.get(&key) {
            return idx;
        }
        let idx = self.add_func_type(params, results);
        self.type_cache.insert(key, idx);
        idx
    }

    pub fn compile(&mut self, program: &Program) -> Result<Vec<u8>, String> {
        self.write_header();

        self.collect_class_layouts(program);
        self.collect_enum_variants(program);
        self.collect_function_signatures(program);
        self.collect_class_methods(program);
        self.collect_lambdas(program);
        self.register_helpers();

        // Второй проход: тела пользовательских функций.
        for stmt in &program.statements {
            if let StmtKind::Fn { name, params, ret_ty, body, .. } = &stmt.kind {
                self.compile_function(name, params, ret_ty, body)?;
            }
        }

        // Тела методов классов (this — неявный первый параметр).
        for stmt in &program.statements {
            if let StmtKind::Class { name, methods, .. } = &stmt.kind {
                self.compile_class_methods(name, methods)?;
            }
        }

        // Затем — тела лямбд и рантайм-хелперов (в порядке регистрации).
        self.emit_lambda_bodies()?;
        self.emit_helper_bodies();

        self.emit_exports();
        self.emit_sections();

        Ok(std::mem::take(&mut self.module).into_vec())
    }
}

/// Есть ли в теле функции `return <expr>;` (тогда функция возвращает i32,
/// даже без явной аннотации — как в engine #1).
pub(super) fn body_returns_value(body: &[Stmt]) -> bool {
    fn stmt_returns(s: &Stmt) -> bool {
        match &s.kind {
            StmtKind::Return(Some(_)) => true,
            StmtKind::If { then_branch, else_branch, .. } => {
                then_branch.iter().any(stmt_returns)
                    || else_branch.as_ref().map(|b| b.iter().any(stmt_returns)).unwrap_or(false)
            }
            StmtKind::While { body, .. } | StmtKind::For { body, .. }
            | StmtKind::ForC { body, .. } | StmtKind::Spawn(body) => body.iter().any(stmt_returns),
            _ => false,
        }
    }
    body.iter().any(stmt_returns)
}
