//! Литерал массива в линейной памяти: `[len][elem0][elem1]...`.

use super::super::bytecode::op;
use super::super::context::FuncContext;
use super::super::module_builder::WasmCodegen;
use super::super::runtime_helpers::ALLOC;
use crate::ast::*;

impl WasmCodegen {
    /// Литерал массива в линейной памяти: [len][elem0][elem1]...
    pub(in crate::codegen) fn compile_array(
        &mut self,
        elements: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let elem_size = 4;
        let header_size = 4;
        let total_size = header_size + elements.len() as u32 * elem_size;

        let temp_local = ctx.reserve_local();

        // Выделяем через рантайм-аллокатор (растёт при необходимости).
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(total_size as i32);
        self.emit_helper_call(&mut ctx.body, ALLOC);
        ctx.body.push(op::LOCAL_TEE);
        ctx.body.write_u32(temp_local);

        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(elements.len() as i32);
        self.emit_i32_store(&mut ctx.body);

        for (i, elem) in elements.iter().enumerate() {
            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(temp_local);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32((header_size + i as u32 * elem_size) as i32);
            ctx.body.push(op::I32_ADD);
            self.compile_expr(elem, ctx)?;
            self.emit_i32_store(&mut ctx.body);
        }

        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(temp_local);
        Ok(())
    }
}
