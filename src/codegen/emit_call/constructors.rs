//! Конструктор класса: `new Class(args)`.

use super::super::bytecode::op;
use super::super::context::FuncContext;
use super::super::module_builder::WasmCodegen;
use crate::ast::*;

impl WasmCodegen {
    /// Компилирует `new Class(args)`; возвращает `Some(Ok(()))`, если класс найден.
    pub(super) fn try_compile_new(
        &mut self,
        name: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<Option<()>, String> {
        let class_name = name[4..].to_string();

        if let Some(layout) = self.class_layouts.get(&class_name) {
            let temp = ctx.reserve_local();

            ctx.body.push(op::GLOBAL_GET);
            ctx.body.write_u32(self.heap_global_idx);
            ctx.body.push(op::LOCAL_TEE);
            ctx.body.write_u32(temp);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(layout.size as i32);
            ctx.body.push(op::I32_ADD);
            ctx.body.push(op::GLOBAL_SET);
            ctx.body.write_u32(self.heap_global_idx);

            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(temp);

            for arg in args {
                self.compile_expr(arg, ctx)?;
            }

            let ctor_name = format!("{}_init", class_name);
            let ctor = self.functions.get(&ctor_name)
                .or_else(|| self.functions.get(&format!("{}_new", class_name)))
                .cloned();
            if let Some((func_idx, _)) = ctor {
                ctx.body.push(op::CALL);
                ctx.body.write_u32(func_idx);
                // Если конструктор не void — снимаем его результат со стека.
                if !self.void_functions.contains(&ctor_name)
                    && !self.void_functions.contains(&format!("{}_new", class_name)) {
                    ctx.body.push(op::DROP);
                }
            }

            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(temp);

            return Ok(Some(()));
        }
        Ok(None)
    }
}
