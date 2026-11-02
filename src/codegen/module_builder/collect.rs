//! Первый проход кодогенерации: layout'ы классов, варианты enum,
//! сигнатуры функций и методов классов.

use super::super::bytecode::valtype;
use super::super::context::{
    latent_to_static, latent_to_wasm, parse_ast_type, ClassLayout, FieldInfo, StaticTy,
};
use super::super::module_builder::{body_returns_value, WasmCodegen};
use crate::ast::*;

impl WasmCodegen {
    /// Первый проход: таблица тегов enum-вариантов (+ встроенные Result/Option).
    pub(super) fn collect_enum_variants(&mut self, program: &Program) {
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
    pub(super) fn collect_class_layouts(&mut self, program: &Program) {
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
    pub(super) fn collect_function_signatures(&mut self, program: &Program) {
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

    /// Первый проход: регистрирует методы классов как функции `Class_method`
    /// с неявным первым параметром `this`.
    pub(super) fn collect_class_methods(&mut self, program: &Program) {
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
    pub(super) fn compile_class_methods(&mut self, name: &str, methods: &[Stmt]) -> Result<(), String> {
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
}
