//! Кодогенерация инструкций (statements).

use super::bytecode::{op, valtype};
use super::context::{ast_to_static, FuncContext};
use super::module_builder::WasmCodegen;
use crate::ast::*;

impl WasmCodegen {
    pub(super) fn compile_stmt(&mut self, stmt: &Stmt, ctx: &mut FuncContext) -> Result<(), String> {
        match &stmt.kind {
            StmtKind::Let { name, ty, value } => {
                self.compile_expr(value, ctx)?;

                // Тип локальной: из аннотации или выведенный из значения.
                let st = ty.as_ref()
                    .map(ast_to_static)
                    .unwrap_or_else(|| self.static_ty_of(value, ctx));
                let vt = st.valtype();
                // Имя класса значения: аннотация, `new Class` или тип поля.
                let class = ty.as_ref().and_then(|t| match t {
                    crate::ast::Type::Named(n)
                        if !matches!(n.as_str(), "int" | "float" | "bool" | "string" | "void" | "unit" | "null") =>
                        Some(n.clone()),
                    _ => None,
                }).or_else(|| {
                    if let ExprKind::Call { callee, .. } = &value.kind {
                        if let ExprKind::Identifier(n) = &callee.kind {
                            if let Some(rest) = n.strip_prefix("new ") {
                                return Some(rest.to_string());
                            }
                        }
                    }
                    None
                });
                ctx.declare_class(name, vt, st, class);

                ctx.body.push(op::LOCAL_SET);
                ctx.body.write_u32(ctx.locals[name].0);
                Ok(())
            }

            StmtKind::Expr(expr) => {
                self.compile_expr(expr, ctx)?;
                // Void-вызовы (print, функции без результата) ничего не оставляют
                // на стеке — DROP для них был бы невалиден.
                if self.expr_produces_value(expr) {
                    ctx.body.push(op::DROP);
                }
                Ok(())
            }

            StmtKind::Return(expr) => {
                if let Some(e) = expr {
                    self.compile_expr(e, ctx)?;
                }
                ctx.body.push(op::RETURN);
                Ok(())
            }

            StmtKind::If { cond, then_branch, else_branch } => {
                self.compile_expr(cond, ctx)?;
                ctx.body.push(op::IF);
                ctx.body.push(valtype::VOID);

                for s in then_branch {
                    self.compile_stmt(s, ctx)?;
                }

                if let Some(else_b) = else_branch {
                    ctx.body.push(op::ELSE);
                    for s in else_b {
                        self.compile_stmt(s, ctx)?;
                    }
                }

                ctx.body.push(op::END);
                Ok(())
            }

            StmtKind::While { cond, body: while_body } => {
                ctx.body.push(op::BLOCK);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::LOOP);
                ctx.body.push(valtype::VOID);

                self.compile_expr(cond, ctx)?;
                ctx.body.push(op::I32_EQZ);
                ctx.body.push(op::BR_IF);
                ctx.body.write_u32(1);

                for s in while_body {
                    self.compile_stmt(s, ctx)?;
                }

                ctx.body.push(op::BR);
                ctx.body.write_u32(0);

                ctx.body.push(op::END);
                ctx.body.push(op::END);
                Ok(())
            }

            // for (init; cond; step) { body } — C-стиль
            StmtKind::ForC { init, cond, step, body } => {
                if let Some(init_stmt) = init {
                    self.compile_stmt(init_stmt, ctx)?;
                }

                ctx.body.push(op::BLOCK);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::LOOP);
                ctx.body.push(valtype::VOID);

                if let Some(c) = cond {
                    self.compile_expr(c, ctx)?;
                    ctx.body.push(op::I32_EQZ);
                    ctx.body.push(op::BR_IF);
                    ctx.body.write_u32(1); // выход из блока
                }

                for s in body {
                    self.compile_stmt(s, ctx)?;
                }

                if let Some(st) = step {
                    self.compile_expr(st, ctx)?;
                    ctx.body.push(op::DROP);
                }

                ctx.body.push(op::BR);
                ctx.body.write_u32(0); // повторить loop
                ctx.body.push(op::END); // loop
                ctx.body.push(op::END); // block
                Ok(())
            }

            // for (let x in arr) { body } — итерация по массиву
            StmtKind::For { var, iterable, body } => {
                self.compile_expr(iterable, ctx)?;
                let arr_local = ctx.reserve_local();
                ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(arr_local);

                let idx_local = ctx.reserve_local();
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(0);
                ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(idx_local);

                let var_local = ctx.reserve_local();
                ctx.locals.insert(var.clone(), (var_local, valtype::I32));

                ctx.body.push(op::BLOCK);
                ctx.body.push(valtype::VOID);
                ctx.body.push(op::LOOP);
                ctx.body.push(valtype::VOID);

                // if (idx >= len) break
                ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(idx_local);
                ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
                self.emit_i32_load(&mut ctx.body); // length
                ctx.body.push(op::I32_GE_S);
                ctx.body.push(op::BR_IF);
                ctx.body.write_u32(1);

                // var = arr[idx]
                ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(arr_local);
                ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(idx_local);
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
                ctx.body.push(op::I32_MUL);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(4);
                ctx.body.push(op::I32_ADD);
                self.emit_i32_load(&mut ctx.body);
                ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(var_local);

                for s in body {
                    self.compile_stmt(s, ctx)?;
                }

                // idx = idx + 1
                ctx.body.push(op::LOCAL_GET); ctx.body.write_u32(idx_local);
                ctx.body.push(op::I32_CONST); ctx.body.write_i32(1);
                ctx.body.push(op::I32_ADD);
                ctx.body.push(op::LOCAL_SET); ctx.body.write_u32(idx_local);

                ctx.body.push(op::BR); ctx.body.write_u32(0);
                ctx.body.push(op::END); // loop
                ctx.body.push(op::END); // block
                Ok(())
            }

            StmtKind::Spawn(body) => {
                // В WASM-модуле spawn компилируется в последовательное
                // выполнение (кооперативный рантайм не имеет отдельного стека).
                for s in body {
                    self.compile_stmt(s, ctx)?;
                }
                Ok(())
            }

            StmtKind::Select { arms, default_branch } => {
                // Движок №2 не имеет host-рантайма каналов. Выражения каналов
                // НЕ компилируем (channel недоступен); тело первой ветки —
                // последовательно, иначе default.
                if let Some(arm) = arms.first() {
                    if let Some(var) = &arm.var {
                        let idx = ctx.reserve_local();
                        ctx.locals.insert(var.clone(), (idx, valtype::I32));
                        ctx.body.push(op::I32_CONST);
                        ctx.body.write_i32(0);
                        ctx.body.push(op::LOCAL_SET);
                        ctx.body.write_u32(idx);
                    }
                    for s in &arm.body {
                        self.compile_stmt(s, ctx)?;
                    }
                } else if let Some(db) = default_branch {
                    for s in db {
                        self.compile_stmt(s, ctx)?;
                    }
                }
                Ok(())
            }

            StmtKind::Yield => Ok(()),

            // Объявления типов не генерируют код.
            StmtKind::Class { .. } | StmtKind::Enum { .. } => Ok(()),

            // Тесты исполняются как обычные тела (при наличие @test).
            StmtKind::Test { body, .. } => {
                for s in body {
                    self.compile_stmt(s, ctx)?;
                }
                Ok(())
            }

            // Декораторы прозрачны: код генерируется для цели.
            StmtKind::Decorator { target, .. } => self.compile_stmt(target, ctx),

            StmtKind::AiGenerate { .. } => Ok(()),

            _ => Ok(()),
        }
    }
}