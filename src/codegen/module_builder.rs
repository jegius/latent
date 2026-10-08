//! Сборка секций WASM-модуля и регистрация функций/импортов.

use super::bytecode::{op, valtype, ByteBuffer};
use super::context::{
    latent_to_static, latent_to_wasm, parse_ast_type, ClassLayout, FieldInfo, StaticTy,
};
use crate::ast::*;
use std::collections::HashMap;

/// Генератор WASM кода
pub struct WasmCodegen {
    pub(super) module: ByteBuffer,
    pub(super) type_section: ByteBuffer,
    pub(super) type_count: u32,
    pub(super) import_section: ByteBuffer,
    pub(super) import_count: u32,
    pub(super) func_section: ByteBuffer,
    pub(super) func_count: u32,
    #[allow(dead_code)]
    #[allow(dead_code)]
    pub(super) memory_section: ByteBuffer,
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
    /// Упорядоченный список тел хелперов (порядок = порядок code-секции).
    #[allow(dead_code)]
    pub(super) helper_count: u32,
    /// Таблица функций (для косвенных вызовов): имена в порядке индексов.
    #[allow(dead_code)]
    pub(super) function_table: Vec<String>,
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
            memory_section: ByteBuffer::new(),
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
            helper_count: 0,
            function_table: Vec::new(),
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

    /// Эмитит i32.load с memarg (align=2, offset=0).
    pub(super) fn emit_i32_load(&self, body: &mut ByteBuffer) {
        body.push(op::I32_LOAD);
        body.write_u32(2); // align = 2^2 = 4 байта
        body.write_u32(0); // offset
    }

    /// Эмитит i32.store с memarg (align=2, offset=0).
    pub(super) fn emit_i32_store(&self, body: &mut ByteBuffer) {
        body.push(op::I32_STORE);
        body.write_u32(2);
        body.write_u32(0);
    }

    /// Эмитит f64.load с memarg (align=3, offset=0).
    pub(super) fn emit_f64_load(&self, body: &mut ByteBuffer) {
        body.push(op::F64_LOAD);
        body.write_u32(3);
        body.write_u32(0);
    }

    /// Эмитит f64.store с memarg (align=3, offset=0).
    #[allow(dead_code)]
    pub(super) fn emit_f64_store(&self, body: &mut ByteBuffer) {
        body.push(op::F64_STORE);
        body.write_u32(3);
        body.write_u32(0);
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

/// Эмитит call хелпера по имени.
    pub(super) fn emit_helper_call(&self, body: &mut ByteBuffer, name: &str) {
        body.push(op::CALL);
        body.write_u32(self.helper_idx(name));
    }

    /// Первый проход: регистрирует методы классов как функции `Class_method`
    /// с неявным первым параметром `this`.
    fn collect_class_methods(&mut self, program: &Program) {
        for stmt in &program.statements {
            if let StmtKind::Class { name, methods, .. } = &stmt.kind {
                for m in methods {
                    if let StmtKind::Fn { name: method_name, params, ret_ty, body, .. } = &m.kind {
                        let mangled = format!("{}_{}", name, method_name);
                        let mut all_params = vec![Param {
                            name: "this".to_string(),
                            ty: Some(crate::ast::Type::Named(name.clone())),
                        }];
                        all_params.extend(params.iter().cloned());

                        let param_types: Vec<u8> = all_params.iter()
                            .map(|p| p.ty.as_ref()
                                .map(|t| latent_to_wasm(&parse_ast_type(t)))
                                .unwrap_or(valtype::I32))
                            .collect();
                        let result_types: Vec<u8> = match ret_ty {
                            Some(ret) => vec![latent_to_wasm(&parse_ast_type(ret))],
                            None => if body_returns_value(body) { vec![valtype::I32] } else { vec![] },
                        };

                        let type_idx = self.add_func_type_cached(&param_types, &result_types);
                        let func_idx = self.import_count + self.func_count;
                        self.func_count += 1;
                        if result_types.is_empty() {
                            self.void_functions.insert(mangled.clone());
                        }
                        self.fn_return_static.insert(
                            mangled.clone(),
                            ret_ty.as_ref().map(|t| latent_to_static(&parse_ast_type(t)))
                                .unwrap_or(StaticTy::Int),
                        );
                        self.func_section.write_u32(type_idx);
                        self.functions.insert(mangled, (func_idx, type_idx));
                    }
                }
            }
        }
    }

    /// Второй проход: тела методов классов.
    fn compile_class_methods(&mut self, name: &str, methods: &[Stmt]) -> Result<(), String> {
        for m in methods {
            if let StmtKind::Fn { name: method_name, params, ret_ty, body, .. } = &m.kind {
                let mangled = format!("{}_{}", name, method_name);
                let mut all_params = vec![Param {
                    name: "this".to_string(),
                    ty: Some(crate::ast::Type::Named(name.to_string())),
                }];
                all_params.extend(params.iter().cloned());
                let _ = &body;
                self.compile_function(&mangled, &all_params, ret_ty, body)?;
            }
        }
        Ok(())
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

    /// Первый проход: таблица тегов enum-вариантов (+ встроенные Result/Option).
    fn collect_enum_variants(&mut self, program: &Program) {
        self.register_builtin_variants();
        for stmt in &program.statements {
            if let StmtKind::Enum { variants, .. } = &stmt.kind {
                for (tag, v) in variants.iter().enumerate() {
                    self.enum_variants
                        .insert(v.name.clone(), (tag as i32, v.fields.len()));
                }
            }
        }
    }

    /// Первый проход: layout всех классов.
    fn collect_class_layouts(&mut self, program: &Program) {
        for stmt in &program.statements {
            if let StmtKind::Class { name, fields, .. } = &stmt.kind {
                let mut layout = ClassLayout {
                    fields: Vec::new(),
                    size: 0,
                    align: 4,
                };

                for field in fields {
                    let (size, valtype) = match field.ty.as_ref() {
                        Some(crate::ast::Type::Named(name)) if name == "float" => (8, valtype::F64),
                        _ => (4, valtype::I32),
                    };

                    let mask = size - 1;
                    layout.size = (layout.size + mask) & !mask;

                    layout.fields.push(FieldInfo {
                        name: field.name.clone(),
                        offset: layout.size,
                        valtype,
                    });

                    layout.size += size;
                }

                let mask = layout.align - 1;
                layout.size = (layout.size + mask) & !mask;

                self.class_layouts.insert(name.clone(), layout);
            }
        }
    }

    /// Первый проход: сигнатуры всех функций.
    fn collect_function_signatures(&mut self, program: &Program) {
        for stmt in &program.statements {
            if let StmtKind::Fn { name, params, ret_ty, body, .. } = &stmt.kind {
                let param_types: Vec<u8> = params.iter()
                    .map(|p| p.ty.as_ref()
                        .map(|t| latent_to_wasm(&parse_ast_type(t)))
                        .unwrap_or(valtype::I32))
                    .collect();

                let result_types: Vec<u8> = match ret_ty {
                    Some(ret) => vec![latent_to_wasm(&parse_ast_type(ret))],
                    // Функция без аннотации, но с `return expr` возвращает i32.
                    None => if body_returns_value(body) { vec![valtype::I32] } else { vec![] },
                };

                let type_idx = self.add_func_type_cached(&param_types, &result_types);
                let func_idx = self.import_count + self.func_count;
                self.func_count += 1;

                if result_types.is_empty() {
                    self.void_functions.insert(name.clone());
                }

                // Статический тип результата — для print/конкатенации.
                let ret_static = match ret_ty {
                    Some(t) => latent_to_static(&parse_ast_type(t)),
                    None => StaticTy::Int,
                };
                self.fn_return_static.insert(name.clone(), ret_static);

                self.func_section.write_u32(type_idx);
                self.functions.insert(name.clone(), (func_idx, type_idx));
            }
        }
    }
}

/// Есть ли в теле функции `return <expr>;` (тогда функция возвращает i32,
/// даже без явной аннотации — как в engine #1).
fn body_returns_value(body: &[Stmt]) -> bool {
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
