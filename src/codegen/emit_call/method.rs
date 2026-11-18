//! Методы объектов: пользовательские методы классов, `arr.push/pop`,
//! строковые конверсии, `.length()`.

use super::super::bytecode::op;
use super::super::context::{FuncContext, StaticTy};
use super::super::module_builder::WasmCodegen;
use super::super::runtime_helpers::{F64_TO_STR, I32_TO_STR, STR_TO_I32};
use crate::ast::*;

impl WasmCodegen {
    /// Метод-вызовы (arr.push/pop, строковые). Порядок: сначала объект.
    pub(super) fn compile_method_call(
        &mut self,
        object: &Expr,
        field: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        // Метод класса: `obj.method(args)` → `Class_method(obj, args)`.
        let class_name = self.infer_class_name(object, ctx);
        if !class_name.is_empty() {
            let mangled = format!("{}_{}", class_name, field);
            if let Some((func_idx, _)) = self.functions.get(&mangled).cloned() {
                self.compile_expr(object, ctx)?;
                for a in args {
                    self.compile_expr(a, ctx)?;
                }
                ctx.body.push(op::CALL);
                ctx.body.write_u32(func_idx);
                return Ok(());
            }
        }
        match field {
            "push" => self.compile_push(object, args, ctx),
            "pop" => self.compile_pop(object, ctx),
            // Строковые методы.
            "to_str" | "toString" => {
                let t = self.static_ty_of(object, ctx);
                self.compile_expr(object, ctx)?;
                match t {
                    StaticTy::Float => self.emit_helper_call(&mut ctx.body, F64_TO_STR),
                    StaticTy::Str => {}
                    _ => self.emit_helper_call(&mut ctx.body, I32_TO_STR),
                }
                Ok(())
            }
            "to_int" | "toInt" => {
                let t = self.static_ty_of(object, ctx);
                self.compile_expr(object, ctx)?;
                match t {
                    StaticTy::Str => self.emit_helper_call(&mut ctx.body, STR_TO_I32),
                    StaticTy::Float => ctx.body.push(op::I32_TRUNC_F64_S),
                    _ => {}
                }
                Ok(())
            }
            // .length уже обработан в Field. Для совместимости с `arr.length()`:
            "length" => {
                self.compile_expr(object, ctx)?;
                self.emit_i32_load(&mut ctx.body);
                Ok(())
            }
            _ => Err(format!(
                "Метод '{}' не поддерживается движком №2 (требует host-рантайма)",
                field
            )),
        }
    }

    /// arr.push(x): arr[len]=x; arr.length = len+1; результат — arr.
    pub(super) fn compile_push(
        &mut self,
        object: &Expr,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        self.compile_expr(object, ctx)?;
        let arr_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(arr_local);
        for a in args { self.compile_expr(a, ctx)?; }
        let val_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(val_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(val_local);
        self.emit_i32_store(&mut ctx.body);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(1);
        ctx.body.push(op::I32_ADD);
        self.emit_i32_store(&mut ctx.body);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        Ok(())
    }

    /// arr.pop(): len--; результат arr[len].
    fn compile_pop(&mut self, object: &Expr, ctx: &mut FuncContext) -> Result<(), String> {
        self.compile_expr(object, ctx)?;
        let arr_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(1);
        ctx.body.push(op::I32_SUB);
        self.emit_i32_store(&mut ctx.body);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
        self.emit_i32_load(&mut ctx.body);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        self.emit_i32_load(&mut ctx.body);
        Ok(())
    }
}
