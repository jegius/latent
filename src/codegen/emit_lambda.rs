//! Кодогенерация лямбд (замыканий) и косвенных вызовов.
//!
//! Closure conversion: лямбда превращается в обычную функцию с явным
//! окружением. Представление closure в памяти:
//! `[table_slot i32][env_ptr i32]` (8 байт).
//!
//! env — массив захваченных i32-значений. Косвенный вызов идёт через таблицу
//! функций (`call_indirect`) с каноническим типом `(i32 env, i32...)->i32`.

use super::bytecode::{op, valtype};
use super::context::FuncContext;
use super::module_builder::WasmCodegen;
use crate::ast::*;

/// Описание лямбды, вынесенной в отдельную функцию-хелпер.
pub(super) struct LambdaInfo {
    /// Имя сгенерированной функции (`__lambda_N`).
    #[allow(dead_code)]
    pub func_name: String,
    /// Параметры (без env).
    pub params: Vec<Param>,
    /// Тело в виде инструкций.
    pub body: Vec<Stmt>,
    /// Индекс типа функции `(env, params...) -> i32`.
    pub type_idx: u32,
    /// Индекс функции в пространстве функций.
    pub func_idx: u32,
    /// Имя в таблице (совпадает с func_name).
    pub table_name: String,
    /// Захваченные свободные переменные (порядок = порядок env-слотов).
    pub captured: Vec<String>,
}

impl WasmCodegen {
    /// Канонический тип лямбды по арности (params без env): env + arity
    /// i32-параметров, результат i32. Дедуплицируется.
    pub(super) fn lambda_type_for(&mut self, arity: u32) -> u32 {
        let mut params = vec![valtype::I32]; // env
        for _ in 0..arity {
            params.push(valtype::I32);
        }
        self.add_func_type_cached(&params, &[valtype::I32])
    }

    /// Первый проход: находит лямбды, регистрирует их как функции.
    pub(super) fn collect_lambdas(&mut self, program: &Program) {
        for stmt in &program.statements {
            self.walk_stmt_lambdas(stmt);
        }

        let count = self.lambdas.len();
        for i in 0..count {
            let arity = self.lambdas[i].params.len() as u32;
            let type_idx = self.lambda_type_for(arity);
            let func_idx = self.import_count + self.func_count;
            self.func_count += 1;
            self.func_section.write_u32(type_idx);
            let name = format!("__lambda_{}", i);
            self.functions.insert(name.clone(), (func_idx, type_idx));
            self.lambdas[i].type_idx = type_idx;
            self.lambdas[i].func_idx = func_idx;
            self.lambdas[i].table_name = name;
        }
    }

    fn walk_stmt_lambdas(&mut self, stmt: &Stmt) {
        match &stmt.kind {
            StmtKind::Let { value, .. } => self.walk_expr_lambdas(value),
            StmtKind::Expr(e) => self.walk_expr_lambdas(e),
            StmtKind::Return(Some(e)) => self.walk_expr_lambdas(e),
            StmtKind::If { cond, then_branch, else_branch } => {
                self.walk_expr_lambdas(cond);
                for s in then_branch { self.walk_stmt_lambdas(s); }
                if let Some(eb) = else_branch { for s in eb { self.walk_stmt_lambdas(s); } }
            }
            StmtKind::While { cond, body } => {
                self.walk_expr_lambdas(cond);
                for s in body { self.walk_stmt_lambdas(s); }
            }
            StmtKind::ForC { init, cond, step, body } => {
                if let Some(i) = init { self.walk_stmt_lambdas(i); }
                if let Some(c) = cond { self.walk_expr_lambdas(c); }
                if let Some(s) = step { self.walk_expr_lambdas(s); }
                for s in body { self.walk_stmt_lambdas(s); }
            }
            StmtKind::For { iterable, body, .. } => {
                self.walk_expr_lambdas(iterable);
                for s in body { self.walk_stmt_lambdas(s); }
            }
            StmtKind::Spawn(body) => { for s in body { self.walk_stmt_lambdas(s); } }
            StmtKind::Fn { body, .. } => { for s in body { self.walk_stmt_lambdas(s); } }
            StmtKind::Test { body, .. } => { for s in body { self.walk_stmt_lambdas(s); } }
            _ => {}
        }
    }

    fn walk_expr_lambdas(&mut self, expr: &Expr) {
        match &expr.kind {
            ExprKind::Lambda { params, body, block, locals, .. } => {
                // Захватываем только имена, которые не являются функциями
                // верхнего уровня (иначе захватывали бы "print" и т.п.).
                let captured: Vec<String> = locals.iter()
                    .filter(|n| !self.functions.contains_key(*n))
                    .cloned()
                    .collect();
                let stmts: Vec<Stmt> = if let Some(blk) = block {
                    blk.clone()
                } else {
                    vec![Stmt {
                        kind: StmtKind::Return(Some((**body).clone())),
                        pos: expr.pos,
                    }]
                };
                let idx = self.lambdas.len() as u32;
                self.lambda_map.insert(expr.pos.offset, idx);
                self.lambdas.push(LambdaInfo {
                    func_name: format!("__lambda_{}", idx),
                    params: params.clone(),
                    body: stmts,
                    type_idx: 0,
                    func_idx: 0,
                    table_name: String::new(),
                    captured,
                });
                if let Some(blk) = block {
                    for s in blk { self.walk_stmt_lambdas(s); }
                } else {
                    self.walk_expr_lambdas(body);
                }
            }
            ExprKind::Binary { left, right, .. } => {
                self.walk_expr_lambdas(left);
                self.walk_expr_lambdas(right);
            }
            ExprKind::Unary { operand, .. } => self.walk_expr_lambdas(operand),
            ExprKind::Call { callee, args } => {
                self.walk_expr_lambdas(callee);
                for a in args { self.walk_expr_lambdas(a); }
            }
            ExprKind::Index { object, index } => {
                self.walk_expr_lambdas(object);
                self.walk_expr_lambdas(index);
            }
            ExprKind::Field { object, .. } => self.walk_expr_lambdas(object),
            ExprKind::Array(elems) => { for e in elems { self.walk_expr_lambdas(e); } }
            ExprKind::Assign { target, value } => {
                self.walk_expr_lambdas(target);
                self.walk_expr_lambdas(value);
            }
            ExprKind::Match { scrutinee, arms } => {
                self.walk_expr_lambdas(scrutinee);
                for arm in arms { self.walk_expr_lambdas(&arm.body); }
            }
            ExprKind::Await(e) => self.walk_expr_lambdas(e),
            _ => {}
        }
    }

    /// Генерирует тела всех лямбд в code-секцию (после пользовательских функций).
    pub(super) fn emit_lambda_bodies(&mut self) -> Result<(), String> {
        let count = self.lambdas.len();
        for i in 0..count {
            let params = self.lambdas[i].params.clone();
            let body = self.lambdas[i].body.clone();
            let captured = self.lambdas[i].captured.clone();
            let (_, func_body) = self.build_function_typed(
                &params,
                true,
                valtype::I32,
                &body,
                &captured,
                true,
            )?;
            let mut fb = func_body;
            fb.push(op::END);
            let bytes = fb.into_vec();
            self.code_section.write_u32(bytes.len() as u32);
            self.code_section.extend(&bytes);
            self.code_count += 1;
        }
        Ok(())
    }

    /// Создаёт closure на стеке: `[table_slot, env_ptr]`.
    pub(super) fn compile_lambda(
        &mut self,
        expr: &Expr,
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        let lambda_idx = match self.lambda_map.get(&expr.pos.offset) {
            Some(i) => *i as usize,
            None => return Err("internal: lambda not hoisted".to_string()),
        };
        let (func_idx, captured) = {
            let info = &self.lambdas[lambda_idx];
            (info.func_idx, info.captured.clone())
        };
        // Элемент-секция кладёт функцию с индексом i в слот i таблицы,
        // поэтому слот = индекс функции в пространстве функций.
        let table_slot = func_idx;
        let n = captured.len() as u32;

        // env_ptr = alloc(4*n) (либо 0, если нет захватов)
        if n > 0 {
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32((4 * n) as i32);
            self.emit_helper_call(&mut ctx.body, super::runtime_helpers::ALLOC);
        } else {
            ctx.body.push(op::I32_CONST);
            ctx.body.write_i32(0);
        }
        let env_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(env_local);

        for (i, name) in captured.iter().enumerate() {
            if let Some((local_idx, _)) = ctx.locals.get(name).cloned() {
                ctx.body.push(op::LOCAL_GET);
                ctx.body.write_u32(env_local);
                ctx.body.push(op::I32_CONST);
                ctx.body.write_i32((i * 4) as i32);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::LOCAL_GET);
                ctx.body.write_u32(local_idx);
                ctx.body.push(op::I32_STORE);
                ctx.body.write_u32(2);
                ctx.body.write_u32(0);
            }
        }

        // closure_ptr = alloc(8); [ptr+0]=table_slot; [ptr+4]=env_ptr
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(8);
        self.emit_helper_call(&mut ctx.body, super::runtime_helpers::ALLOC);
        let closure_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_TEE);
        ctx.body.write_u32(closure_local);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(table_slot as i32);
        ctx.body.push(op::I32_STORE);
        ctx.body.write_u32(2);
        ctx.body.write_u32(0);
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(closure_local);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(env_local);
        ctx.body.push(op::I32_STORE);
        ctx.body.write_u32(2);
        ctx.body.write_u32(0);
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(closure_local);
        Ok(())
    }

    /// Косвенный вызов closure: `callee` — выражение, дающее closure_ptr.
    pub(super) fn compile_indirect_call(
        &mut self,
        callee: &Expr,
        args: &[Expr],
        ctx: &mut FuncContext,
    ) -> Result<(), String> {
        self.compile_expr(callee, ctx)?;
        let closure_local = ctx.reserve_local();
        ctx.body.push(op::LOCAL_SET);
        ctx.body.write_u32(closure_local);

        // Порядок для call_indirect: [env, args..., table_index] — индекс
        // таблицы обязан быть на вершине стека.
        // env ptr = [closure+4]
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(closure_local);
        ctx.body.push(op::I32_CONST);
        ctx.body.write_i32(4);
        ctx.body.push(op::I32_ADD);
        ctx.body.push(op::I32_LOAD);
        ctx.body.write_u32(2);
        ctx.body.write_u32(0);
        // аргументы
        for a in args {
            self.compile_expr(a, ctx)?;
        }
        // table index = [closure+0]
        ctx.body.push(op::LOCAL_GET);
        ctx.body.write_u32(closure_local);
        ctx.body.push(op::I32_LOAD);
        ctx.body.write_u32(2);
        ctx.body.write_u32(0);
        let type_idx = self.lambda_type_for(args.len() as u32);
        ctx.body.push(op::CALL_INDIRECT);
        ctx.body.write_u32(type_idx);
        ctx.body.write_u32(0);
        Ok(())
    }
}