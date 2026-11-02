//! Прямые вызовы: пользовательские функции, встроенные и примитивы памяти.

use super::super::bytecode::{op, valtype};
use super::super::context::{FuncContext, StaticTy};
use super::super::module_builder::WasmCodegen;
use super::super::runtime_helpers::{ALLOC, F64_TO_STR, I32_TO_STR, MEM_COPY, STR_EQ, STR_TO_I32};
use crate::ast::*;

/// Встроенные, требующие host-рантайма: движок №2 даёт по ним понятную ошибку.
const HOST_BUILTINS: &[&str] = &[
    "tensor", "semantic", "matmul", "cosine_similarity", "dot", "magnitude",
    "zeros", "ones", "snapshot", "ai_contract", "enforce_contract",
    "ai_infer", "ai_embed", "ai_stream", "stream_next",
    "channel",
];

impl WasmCodegen {
    /// Вызов по имени: встроенные и пользовательские функции.
    pub(super) fn compile_direct_call(
        &mut self,
        name: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        // Примитивы линейной памяти: необходимы для селф-хостинга —
        // кодогенератор на самом Latent должен уметь писать байты WASM.
        if let Some(result) = self.compile_memory_builtin(name, args, ctx)? {
            return Ok(result);
        }
        if name == "print" {
            for arg in args {
                // Не-строковые аргументы конвертируем в строку, чтобы
                // `print(42)` и `print(arr.length)` печатали число, а не
                // интерпретировали его как указатель.
                let t = self.static_ty_of(arg, ctx);
                self.compile_expr(arg, ctx)?;
                match t {
                    StaticTy::Str => {}
                    StaticTy::Float => self.emit_helper_call(&mut ctx.body, F64_TO_STR),
                    _ => self.emit_helper_call(&mut ctx.body, I32_TO_STR),
                }
                ctx.body.push(op::CALL);
                ctx.body.write_u32(self.print_func_idx);
            }
            return Ok(());
        }
        if name == "len" {
            // len(arr|str) → длина из заголовка (общее представление).
            if let Some(a) = args.first() {
                self.compile_expr(a, ctx)?;
            } else {
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(0);
            }
            self.emit_i32_load(&mut ctx.body);
            return Ok(());
        }
        if name == "push" {
            // push(arr, x) — функциональная форма метода arr.push(x).
            if args.len() >= 2 {
                return self.compile_push(&args[0], &args[1..], ctx);
            }
            return Err("push expects (array, value)".to_string());
        }
        if name == "str" {
            // str(x): строку оставляем, число конвертируем.
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                match t {
                    StaticTy::Float => self.emit_helper_call(&mut ctx.body, F64_TO_STR),
                    StaticTy::Str => {}
                    _ => self.emit_helper_call(&mut ctx.body, I32_TO_STR),
                }
            } else {
                let addr = self.add_string("");
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(addr as i32);
            }
            return Ok(());
        }
        if name == "int" {
            // int(x): строку парсим, float усекаем, int как есть.
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                match t {
                    StaticTy::Str => self.emit_helper_call(&mut ctx.body, STR_TO_I32),
                    StaticTy::Float => ctx.body.push(op::I32_TRUNC_F64_S),
                    _ => {}
                }
            } else {
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(0);
            }
            return Ok(());
        }
        if name == "float" {
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                match t {
                    StaticTy::Float => {}
                    StaticTy::Str => {
                        self.emit_helper_call(&mut ctx.body, STR_TO_I32);
                        ctx.body.push(op::F64_CONVERT_I32_S);
                    }
                    _ => ctx.body.push(op::F64_CONVERT_I32_S),
                }
            } else {
                ctx.body.push(op::F64_CONST);
                ctx.body.extend(&0f64.to_le_bytes());
            }
            return Ok(());
        }
        if name == "sqrt" {
            if let Some(a) = args.first() {
                let t = self.static_ty_of(a, ctx);
                self.compile_expr(a, ctx)?;
                if t != StaticTy::Float {
                    ctx.body.push(op::F64_CONVERT_I32_S);
                }
                ctx.body.push(op::F64_SQRT);
            }
            return Ok(());
        }
        if name == "assert" {
            if let Some(a) = args.first() {
                self.compile_expr(a, ctx)?;
                ctx.body.push(op::I32_EQZ);
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::UNREACHABLE);
                ctx.body.push(op::END);
            }
            return Ok(());
        }
        if name == "assert_eq" {
            if args.len() >= 2 {
                let left_is_str = self.static_ty_of(&args[0], ctx) == StaticTy::Str;
                let right_is_str = self.static_ty_of(&args[1], ctx) == StaticTy::Str;
                self.compile_expr(&args[0], ctx)?;
                self.compile_expr(&args[1], ctx)?;
                if left_is_str || right_is_str {
                    self.emit_helper_call(&mut ctx.body, STR_EQ);
                } else {
                    ctx.body.push(op::I32_EQ);
                }
                ctx.body.push(op::I32_EQZ);
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::UNREACHABLE);
                ctx.body.push(op::END);
            }
            return Ok(());
        }
        if HOST_BUILTINS.contains(&name) {
            return Err(format!(
                "Builtin '{}' не поддерживается движком №2 (требует host-рантайма)",
                name
            ));
        }
        for arg in args {
            self.compile_expr(arg, ctx)?;
        }
        if let Some((func_idx, _)) = self.functions.get(name).cloned() {
            ctx.body.push(op::CALL);
            ctx.body.write_u32(func_idx);
            Ok(())
        } else {
            Err(format!("Unknown function: {}", name))
        }
    }

    /// Примитивы линейной памяти (селф-хостинг): `alloc`, `load8`, `store8`,
    /// `load32`, `store32`, `memcopy`. Возвращает `Some(Ok(()))`, если `name`
    /// распознан, — значение уже оставлено на стеке WASM.
    ///
    /// # Safety
    /// Это небезопасные операции без границ — та же природа, что у bump-
    /// аллокатора и байтового доступа внутри рантайм-хелперов. Вызывающая
    /// сторона отвечает за валидность адреса.
    fn compile_memory_builtin(
        &mut self,
        name: &str,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<Option<()>, String> {
        match name {
            // alloc(size) -> ptr — bump-аллокатор рантайма.
            "alloc" => {
                if let Some(a) = args.first() {
                    self.compile_expr(a, ctx)?;
                } else {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(0);
                }
                self.emit_helper_call(&mut ctx.body, ALLOC);
                Ok(Some(()))
            }
            // load8(addr) -> int — беззнаковый байт из линейной памяти.
            "load8" => {
                if let Some(a) = args.first() {
                    self.compile_expr(a, ctx)?;
                } else {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(0);
                }
                ctx.body.push(op::I32_LOAD8_U);
                ctx.body.write_u32(0); // align = 1
                ctx.body.write_u32(0); // offset
                Ok(Some(()))
            }
            // store8(addr, value) — записать младший байт по адресу.
            "store8" => {
                if args.len() >= 2 {
                    self.compile_expr(&args[0], ctx)?;
                    self.compile_expr(&args[1], ctx)?;
                    ctx.body.push(op::I32_STORE8);
                    ctx.body.write_u32(0);
                    ctx.body.write_u32(0);
                }
                Ok(Some(()))
            }
            // load32(addr) -> int — 32-битное слово (little-endian).
            "load32" => {
                if let Some(a) = args.first() {
                    self.compile_expr(a, ctx)?;
                } else {
                    ctx.body.push(op::I32_CONST);
                    ctx.body.write_i32(0);
                }
                self.emit_i32_load(&mut ctx.body);
                Ok(Some(()))
            }
            // store32(addr, value) — записать 32-битное слово.
            "store32" => {
                if args.len() >= 2 {
                    self.compile_expr(&args[0], ctx)?;
                    self.compile_expr(&args[1], ctx)?;
                    self.emit_i32_store(&mut ctx.body);
                }
                Ok(Some(()))
            }
            // memcopy(dst, src, len) — побайтовое копирование.
            "memcopy" => {
                if args.len() >= 3 {
                    for a in &args[..3] {
                        self.compile_expr(a, ctx)?;
                    }
                    self.emit_helper_call(&mut ctx.body, MEM_COPY);
                }
                Ok(Some(()))
            }
            _ => Ok(None),
        }
    }
}
