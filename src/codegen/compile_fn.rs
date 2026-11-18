//! Кодогенерация тела одной функции и лямбда-хелперов.

use super::bytecode::{op, valtype, ByteBuffer};
use super::context::{latent_to_wasm, parse_ast_type, FuncContext};
use super::module_builder::WasmCodegen;
use crate::ast::*;

impl WasmCodegen {
    pub(super) fn compile_function(
        &mut self,
        name: &str,
        params: &[Param],
        ret_ty: &Option<crate::ast::Type>,
        body: &[Stmt],
    ) -> Result<(), String> {
        let ret_wasm = ret_ty.as_ref()
            .map(|t| latent_to_wasm(&parse_ast_type(t)))
            .unwrap_or(valtype::I32);
        // Согласовано с collect_function_signatures: функция без аннотации,
        // но с `return expr`, тоже возвращает i32 — иначе сигнатура обещает
        // результат, а тело не оставляет значения на стеке (невалидный WASM).
        let has_result = ret_ty.is_some() || super::module_builder::body_returns_value(body);
        let (_, func_body) = self.build_function_typed(params, has_result, ret_wasm, body, &[], false)?;
        self.write_code(func_body);
        let _ = name;
        Ok(())
    }

    /// Собирает тело функции/лямбды (без завершающего END).
    /// * `has_result` — объявлен ли результат;
    /// * `ret_wasm` — WASM-тип результата;
    /// * `captured` — имена захваченных переменных; если непусто, первым
    ///   параметром идёт env-указатель, а в прологе значения читаются из env.
    /// * `force_env` — всегда резервировать env-слот (для лямбд), даже если
    ///   список захватов пуст: `call_indirect` ожидает env-параметр.
    pub(super) fn build_function_typed(
        &mut self,
        params: &[Param],
        has_result: bool,
        ret_wasm: u8,
        body: &[Stmt],
        captured: &[String],
        force_env: bool,
    ) -> Result<(Vec<u8>, ByteBuffer), String> {
        let mut ctx = FuncContext::new(has_result);
        let env_param = force_env || !captured.is_empty();

        if env_param {
            // Локальный 0 = env-указатель (i32).
            ctx.local_types.push(valtype::I32);
            ctx.local_static.push(super::context::StaticTy::Unknown);
            ctx.local_class.push(None);
            ctx.local_count += 1;
        }

        for param in params {
            let ann = param.ty.as_ref().map(super::context::ast_to_static);
            let ty = param.ty.as_ref()
                .map(|t| latent_to_wasm(&parse_ast_type(t)))
                .unwrap_or(valtype::I32);
            let st = ann.unwrap_or(super::context::StaticTy::Unknown);
            // Имя класса параметра (для this/объектов).
            let class = param.ty.as_ref().and_then(|t| match t {
                crate::ast::Type::Named(n)
                    if !matches!(n.as_str(), "int" | "float" | "bool" | "string" | "void" | "unit" | "null") =>
                    Some(n.clone()),
                _ => None,
            });
            ctx.declare_class(&param.name, ty, st, class);
        }

        // Пролог: распаковка захваченных переменных из env.
        for (i, name) in captured.iter().enumerate() {
            let l = ctx.reserve_local_ty(valtype::I32);
            // l = i32.load(env + 4*i)   (env = local 0)
            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(0);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32((i * 4) as i32);
            ctx.body.push(op::I32_ADD);
            ctx.body.push(op::I32_LOAD);
            ctx.body.write_u32(2);
            ctx.body.write_u32(0);
            ctx.body.push(op::LOCAL_SET);
            ctx.body.write_u32(l);
            ctx.locals.insert(name.clone(), (l, valtype::I32));
        }

        for stmt in body {
            self.compile_stmt(stmt, &mut ctx)?;
        }

        if ctx.has_result && ctx.body.last_byte() != Some(op::RETURN) {
            if ret_wasm == valtype::F64 {
                ctx.body.push(op::F64_CONST);
                ctx.body.extend(&0f64.to_le_bytes());
            } else {
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32(0);
            }
        }

        let mut func_body = ByteBuffer::new();
        // Чисел параметров больше может быть у лямбд (env), поэтому число
        // «не-локальных» слотов = env + params.
        let declared_params = if env_param { params.len() as u32 + 1 } else { params.len() as u32 };
        Self::write_locals(&mut func_body, &ctx.local_types, declared_params);
        func_body.extend(&ctx.body.into_vec());
        Ok((ctx.local_types, func_body))
    }

    fn write_code(&mut self, func_body: ByteBuffer) {
        let mut fb = func_body;
        fb.push(op::END);
        let bytes = fb.into_vec();
        self.code_section.write_u32(bytes.len() as u32);
        self.code_section.extend(&bytes);
        self.code_count += 1;
    }

    /// Записывает вектор локальных переменных в формате WASM: серии групп
    /// `[count][valtype]` для локальных ПОСЛЕ параметров.
    pub(super) fn write_locals(dst: &mut ByteBuffer, all_types: &[u8], param_count: u32) {
        let extra = &all_types[param_count as usize..];
        let mut groups: Vec<(u32, u8)> = Vec::new();
        for &t in extra {
            match groups.last_mut() {
                Some((c, ty)) if *ty == t => *c += 1,
                _ => groups.push((1, t)),
            }
        }
        dst.write_u32(groups.len() as u32);
        for (count, ty) in groups {
            dst.write_u32(count);
            dst.push(ty);
        }
    }
}