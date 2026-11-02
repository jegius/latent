//! Индексация, доступ к полям и присваивания.

use super::super::bytecode::{op, valtype};
use super::super::context::{FuncContext, StaticTy};
use super::super::module_builder::WasmCodegen;
use super::super::runtime_helpers::STR_CHAR_AT;
use crate::ast::*;

impl WasmCodegen {
    /// `x = value`, `arr[i] = value`, `obj.field = value`.
    pub(super) fn compile_assign(
        &mut self,
        target: &Expr,
        value: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        match &target.kind {
            ExprKind::Identifier(name) => {
                self.compile_expr(value, ctx)?;
                if let Some((idx, _)) = ctx.locals.get(name) {
                    ctx.body.push(op::LOCAL_SET);
                    ctx.body.write_u32(*idx);
                    ctx.body.push(op::LOCAL_GET);
                    ctx.body.write_u32(*idx);
                    Ok(())
                } else {
                    Err(format!("Undefined variable: {}", name))
                }
            }
            ExprKind::Index { object, index } => {
                self.compile_index_assign(object, index, value, ctx)
            }
            ExprKind::Field { object, field } => {
                self.compile_field_assign(object, field, value, ctx)
            }
            _ => Err("Complex assignment not yet supported".to_string()),
        }
    }

    /// Индексация строки → байт-символ; массива → элемент (i32-слово).
    pub(super) fn compile_index(
        &mut self,
        object: &Expr,
        index: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        if self.static_ty_of(object, ctx) == StaticTy::Str {
            self.compile_expr(object, ctx)?;
            self.compile_expr(index, ctx)?;
            self.emit_helper_call(&mut ctx.body, STR_CHAR_AT);
            return Ok(());
        }
        self.compile_expr(object, ctx)?;
        self.compile_expr(index, ctx)?;
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        self.emit_i32_load(&mut ctx.body);
        Ok(())
    }

    /// Доступ к полю: `.length` (заголовок) или поле класса по layout'у.
    pub(super) fn compile_field(
        &mut self,
        object: &Expr,
        field: &str,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        // .length: строка — заголовок; массив — заголовок.
        if field == "length" {
            self.compile_expr(object, ctx)?;
            self.emit_i32_load(&mut ctx.body);
            return Ok(());
        }
        self.compile_expr(object, ctx)?;

        let class_name = self.infer_class_name(object, ctx);
        if let Some(layout) = self.class_layouts.get(&class_name) {
            if let Some(field_info) = layout.fields.iter().find(|f| f.name == *field) {
                if field_info.offset > 0 {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(field_info.offset as i32);
                    ctx.body.push(op::I32_ADD);
                }
                if field_info.valtype == valtype::F64 {
                    self.emit_f64_load(&mut ctx.body);
                } else {
                    self.emit_i32_load(&mut ctx.body);
                }
                Ok(())
            } else {
                Err(format!("Unknown field: {}.{}", class_name, field))
            }
        } else {
            Err(format!("Unknown class: {}", class_name))
        }
    }

    /// Присваивание в элемент массива `arr[i] = value`.
    fn compile_index_assign(
        &mut self,
        object: &Expr,
        index: &Expr,
        value: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        self.compile_expr(value, ctx)?;
        let val_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(val_local);

        self.compile_expr(object, ctx)?;
        self.compile_expr(index, ctx)?;

        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_MUL);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);

        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        self.emit_i32_store(&mut ctx.body);

        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        Ok(())
    }

    /// Присваивание в поле объекта: `obj.field = value` / `this.x = x`.
    fn compile_field_assign(
        &mut self,
        object: &Expr,
        field: &str,
        value: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let class_name = self.infer_class_name(object, ctx);
        let (offset, field_vt) = if let Some(layout) = self.class_layouts.get(&class_name) {
            let info = layout.fields.iter().find(|f| f.name == field)
                .ok_or_else(|| format!("Unknown field: {}.{}", class_name, field))?;
            (info.offset, info.valtype)
        } else {
            return Err(format!("Unknown class: {}", class_name));
        };

        // value → temp
        self.compile_expr(value, ctx)?;
        let val_local = ctx.reserve_local_ty(field_vt);
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(val_local);

        // addr = obj + offset
        self.compile_expr(object, ctx)?;
        if offset > 0 {
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(offset as i32);
            ctx.body.push(op::I32_ADD);
        }
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        if field_vt == valtype::F64 {
            self.emit_f64_store(&mut ctx.body);
        } else {
            self.emit_i32_store(&mut ctx.body);
        }
        // Значение присваивания — записанное значение.
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(val_local);
        Ok(())
    }
}
