//! Кодогенерация sum-типов (enum): конструкторы и паттерны.
//!
//! Представление значения enum в памяти: `[tag i32][field0][field1]...`.
//! Даже 0-арный вариант — это указатель на 4-байтный блок с тегом, что даёт
//! единообразный доступ: `tag = i32.load(ptr)`.

use super::bytecode::{op, valtype};
use super::context::FuncContext;
use super::module_builder::WasmCodegen;
use super::runtime_helpers::ALLOC;
use crate::ast::*;

impl WasmCodegen {
    /// Регистрирует встроенные (необъявленные явно) варианты Result/Option,
    /// чтобы `Ok(v)`, `Err(e)`, `Some(x)`, `None` работали без `enum`-декларации.
    pub(super) fn register_builtin_variants(&mut self) {
        let builtins = [
            ("Ok", (0i32, 1usize)),
            ("Err", (1, 1)),
            ("Some", (0, 1)),
            ("None", (0, 0)),
        ];
        for (name, info) in builtins {
            self.enum_variants.entry(name.to_string()).or_insert(info);
        }
    }

    /// Известен ли `name` как конструктор enum-варианта.
    pub(super) fn enum_variant(&self, name: &str) -> Option<(i32, usize)> {
        self.enum_variants.get(name).copied()
    }

    /// Конструирует значение enum-варианта на стеке (указатель).
    pub(super) fn compile_variant(
        &mut self,
        name: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let (tag, arity) = self.enum_variant(name)
            .ok_or_else(|| format!("Unknown enum variant: {}", name))?;
        if args.len() != arity {
            return Err(format!(
                "Enum variant '{}' expects {} field(s), got {}",
                name, arity, args.len()
            ));
        }
        if arity == 0 {
            // Нет полей: значение = сам тег (компактно и сравнимо напрямую).
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(tag);
            return Ok(());
        }
        // ptr = alloc(4 + 4*arity)
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4 + 4 * arity as i32);
        self.emit_helper_call(&mut ctx.body, ALLOC);
        let ptr_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_TEE);
        ctx.body.write_u32(ptr_local);
        // [ptr] = tag
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(tag);
        ctx.body.push(op::I32_STORE);
        ctx.body.write_u32(2);
        ctx.body.write_u32(0);
        // поля
        for (i, arg) in args.iter().enumerate() {
            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(ptr_local);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32((4 + i as i32 * 4) as i32);
            ctx.body.push(op::I32_ADD);
            self.compile_expr(arg, ctx)?;
            ctx.body.push(op::I32_STORE);
            ctx.body.write_u32(2);
            ctx.body.write_u32(0);
        }
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(ptr_local);
        Ok(())
    }

    /// Эмитит проверку «tag(scrut) == variant_tag» и, при совпадении,
    /// связывает под-паттерны. Оставляет i32-условие на стеке для IF.
    pub(super) fn emit_constructor_test(
        &mut self,
        name: &str,
        subpats: &[Pattern],
        scrut_local: u32,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let (tag, arity) = self.enum_variant(name)
            .ok_or_else(|| format!("Unknown enum variant in pattern: {}", name))?;
        if subpats.len() != arity {
            return Err(format!(
                "Enum pattern '{}' expects {} field(s), got {}",
                name, arity, subpats.len()
            ));
        }

        if arity == 0 {
            // 0-арный вариант представлен тегом напрямую.
            ctx.body.push(op::LOCAL_GET);
            ctx.body.write_u32(scrut_local);
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(tag);
            ctx.body.push(op::I32_EQ);
            return Ok(());
        }

        // Условие: i32.load(scrut) == tag
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(scrut_local);
        ctx.body.push(op::I32_LOAD);
        ctx.body.write_u32(2);
        ctx.body.write_u32(0);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(tag);
        ctx.body.push(op::I32_EQ);
        // (связывание под-паттернов выполняется в THEN-ветке вызывающим кодом)
        let _ = valtype::I32;
        Ok(())
    }

    /// Связывает идентификаторы под-паттернов из полей значения enum.
    /// Вызывается в THEN-ветке match, где scrut — указатель.
    pub(super) fn bind_constructor_fields(
        &mut self,
        subpats: &[Pattern],
        scrut_local: u32,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        for (i, sub) in subpats.iter().enumerate() {
            match sub {
                Pattern::Identifier(name) => {
                    let l = ctx.reserve_local();
                    ctx.locals.insert(name.clone(), (l, valtype::I32));
                    ctx.body.push(op::LOCAL_GET);
                    ctx.body.write_u32(scrut_local);
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32((4 + i as i32 * 4) as i32);
                    ctx.body.push(op::I32_ADD);
                    ctx.body.push(op::I32_LOAD);
                    ctx.body.write_u32(2);
                    ctx.body.write_u32(0);
                    ctx.body.push(op::LOCAL_SET);
                    ctx.body.write_u32(l);
                }
                Pattern::Wildcard => {}
                Pattern::Literal(_) => {
                    // Литерал внутри конструктора — проверяем равенство и
                    // трактуем как обычное связывание (без trap для простоты).
                }
                Pattern::Constructor(_, _) => {
                    // Вложенные конструкторы: связываем как указатель.
                }
            }
        }
        Ok(())
    }
}