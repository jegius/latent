//! Переписывание AST модуля после линковки: манглинг ссылок.
//!
//! Правила:
//! * объявления модуля манглятся, ссылки на них — тоже;
//! * импортированные имена заменяются на mangled имена целевого модуля;
//! * локальные переменные/параметры не трогаются (лексические scope);
//! * имена полей и методов не манглятся (методы манглятся кодогеном от имени
//!   класса);
//! * `new X` переписывается как `new <mangled X>`;
//! * `Constructor`-паттерны и вызовы вариантов enum манглятся;
//! * типовые аннотации (`Named`/`Generic`) переписываются отдельной таблицей,
//!   чтобы не задеть имена функций.

use super::rewrite_types::{rewrite_pattern, rewrite_type};
use crate::ast::*;
use std::collections::HashMap;

/// Таблицы переписывания для одного модуля.
pub(crate) struct RewriteMaps {
    /// Имя значения (fn/class/enum/вариант, включая импортированные) → mangled.
    pub value_map: HashMap<String, String>,
    /// Имя типа (class/enum, включая импортированные) → mangled.
    pub type_map: HashMap<String, String>,
    /// Имя варианта enum (локального или импортированного) → mangled.
    pub variant_map: HashMap<String, String>,
}

pub(super) type Scope = Vec<String>;

fn bound(scope: &Scope, name: &str) -> bool {
    scope.iter().any(|n| n == name)
}

/// Переписывает все инструкции программы (scope верхнего уровня общий).
pub(crate) fn rewrite_module(program: &Program, maps: &RewriteMaps) -> Vec<Stmt> {
    let mut scope: Scope = Vec::new();
    program
        .statements
        .iter()
        .map(|stmt| rewrite_stmt(stmt, maps, &mut scope))
        .collect()
}

/// Блок: новые `let`/`for`-переменные не выходят за его пределы.
fn rewrite_block(stmts: &[Stmt], maps: &RewriteMaps, scope: &mut Scope) -> Vec<Stmt> {
    let mark = scope.len();
    let out = stmts.iter().map(|s| rewrite_stmt(s, maps, scope)).collect();
    scope.truncate(mark);
    out
}

fn rewrite_stmt(stmt: &Stmt, maps: &RewriteMaps, scope: &mut Scope) -> Stmt {
    let kind = match &stmt.kind {
        StmtKind::Let { name, ty, value } => {
            let value = rewrite_expr(value, maps, scope);
            let ty = ty.as_ref().map(|t| rewrite_type(t, maps));
            scope.push(name.clone());
            StmtKind::Let { name: name.clone(), ty, value }
        }
        StmtKind::Fn { name, params, ret_ty, body, is_async } => {
            let mark = scope.len();
            let params = rewrite_params(params, maps, scope);
            let body = body.iter().map(|s| rewrite_stmt(s, maps, scope)).collect();
            scope.truncate(mark);
            StmtKind::Fn {
                name: map_value(maps, name),
                params,
                ret_ty: ret_ty.as_ref().map(|t| rewrite_type(t, maps)),
                body,
                is_async: *is_async,
            }
        }
        StmtKind::Class { name, fields, methods } => {
            let fields = fields
                .iter()
                .map(|f| ClassField {
                    name: f.name.clone(),
                    ty: f.ty.as_ref().map(|t| rewrite_type(t, maps)),
                })
                .collect();
            let methods = methods
                .iter()
                .map(|m| rewrite_method(m, maps))
                .collect();
            StmtKind::Class { name: map_value(maps, name), fields, methods }
        }
        StmtKind::Enum { name, variants } => {
            let variants = variants
                .iter()
                .map(|v| EnumVariant {
                    name: maps
                        .variant_map
                        .get(&v.name)
                        .cloned()
                        .unwrap_or_else(|| v.name.clone()),
                    fields: v.fields.iter().map(|t| rewrite_type(t, maps)).collect(),
                })
                .collect();
            StmtKind::Enum { name: map_value(maps, name), variants }
        }
        StmtKind::If { cond, then_branch, else_branch } => StmtKind::If {
            cond: rewrite_expr(cond, maps, scope),
            then_branch: rewrite_block(then_branch, maps, scope),
            else_branch: else_branch.as_ref().map(|b| rewrite_block(b, maps, scope)),
        },
        StmtKind::While { cond, body } => StmtKind::While {
            cond: rewrite_expr(cond, maps, scope),
            body: rewrite_block(body, maps, scope),
        },
        StmtKind::For { var, iterable, body } => {
            let iterable = rewrite_expr(iterable, maps, scope);
            let mark = scope.len();
            scope.push(var.clone());
            let body = body.iter().map(|s| rewrite_stmt(s, maps, scope)).collect();
            scope.truncate(mark);
            StmtKind::For { var: var.clone(), iterable, body }
        }
        StmtKind::ForC { init, cond, step, body } => {
            let mark = scope.len();
            let init = init.as_ref().map(|s| Box::new(rewrite_stmt(s, maps, scope)));
            let cond = cond.as_ref().map(|e| rewrite_expr(e, maps, scope));
            let step = step.as_ref().map(|e| rewrite_expr(e, maps, scope));
            let body = body.iter().map(|s| rewrite_stmt(s, maps, scope)).collect();
            scope.truncate(mark);
            StmtKind::ForC { init, cond, step, body }
        }
        StmtKind::Return(value) => {
            StmtKind::Return(value.as_ref().map(|e| rewrite_expr(e, maps, scope)))
        }
        StmtKind::Spawn(body) => StmtKind::Spawn(rewrite_block(body, maps, scope)),
        StmtKind::Select { arms, default_branch } => {
            let arms = arms
                .iter()
                .map(|arm| {
                    let channel = rewrite_expr(&arm.channel, maps, scope);
                    let mark = scope.len();
                    if let Some(var) = &arm.var {
                        scope.push(var.clone());
                    }
                    let body = body_stmts(&arm.body, maps, scope);
                    scope.truncate(mark);
                    SelectArm { var: arm.var.clone(), channel, body }
                })
                .collect();
            let default_branch =
                default_branch.as_ref().map(|b| rewrite_block(b, maps, scope));
            StmtKind::Select { arms, default_branch }
        }
        StmtKind::Decorator { name, args, target } => StmtKind::Decorator {
            name: name.clone(),
            args: args.iter().map(|a| rewrite_expr(a, maps, scope)).collect(),
            target: Box::new(rewrite_stmt(target, maps, scope)),
        },
        StmtKind::Test { name, body } => StmtKind::Test {
            name: name.clone(),
            body: rewrite_block(body, maps, scope),
        },
        StmtKind::Yield => StmtKind::Yield,
        StmtKind::AiGenerate { prompt } => StmtKind::AiGenerate { prompt: prompt.clone() },
        StmtKind::Expr(expr) => StmtKind::Expr(rewrite_expr(expr, maps, scope)),
    };
    Stmt { kind, pos: stmt.pos }
}

fn body_stmts(stmts: &[Stmt], maps: &RewriteMaps, scope: &mut Scope) -> Vec<Stmt> {
    stmts.iter().map(|s| rewrite_stmt(s, maps, scope)).collect()
}

/// Параметры: типы переписываются, имена — нет; имена добавляются в scope.
fn rewrite_params(params: &[Param], maps: &RewriteMaps, scope: &mut Scope) -> Vec<Param> {
    params
        .iter()
        .map(|p| {
            scope.push(p.name.clone());
            Param { name: p.name.clone(), ty: p.ty.as_ref().map(|t| rewrite_type(t, maps)) }
        })
        .collect()
}

/// Тело метода класса: `this` + параметры; имя метода не манглятся.
fn rewrite_method(method: &Stmt, maps: &RewriteMaps) -> Stmt {
    let StmtKind::Fn { name, params, ret_ty, body, is_async } = &method.kind else {
        let mut scope: Scope = Vec::new();
        return rewrite_stmt(method, maps, &mut scope);
    };
    let mut scope: Scope = vec!["this".to_string()];
    let params = rewrite_params(params, maps, &mut scope);
    let body = body_stmts(body, maps, &mut scope);
    Stmt {
        kind: StmtKind::Fn {
            name: name.clone(),
            params,
            ret_ty: ret_ty.as_ref().map(|t| rewrite_type(t, maps)),
            body,
            is_async: *is_async,
        },
        pos: method.pos,
    }
}

fn map_value(maps: &RewriteMaps, name: &str) -> String {
    maps.value_map.get(name).cloned().unwrap_or_else(|| name.to_string())
}

/// Переписывает имя-значение с учётом `new X` и локальных переменных.
fn map_identifier(name: &str, maps: &RewriteMaps, scope: &Scope) -> String {
    if let Some(rest) = name.strip_prefix("new ") {
        if let Some(mangled) = maps.value_map.get(rest) {
            return format!("new {}", mangled);
        }
        return name.to_string();
    }
    if bound(scope, name) {
        return name.to_string();
    }
    maps.value_map.get(name).cloned().unwrap_or_else(|| name.to_string())
}

/// Выражение: рекурсивно, с лексическим scope для локальных имён.
fn rewrite_expr(expr: &Expr, maps: &RewriteMaps, scope: &mut Scope) -> Expr {
    let kind = match &expr.kind {
        ExprKind::Number(n) => ExprKind::Number(*n),
        ExprKind::String(s) => ExprKind::String(s.clone()),
        ExprKind::Bool(b) => ExprKind::Bool(*b),
        ExprKind::Null => ExprKind::Null,
        ExprKind::Identifier(name) => ExprKind::Identifier(map_identifier(name, maps, scope)),
        ExprKind::Binary { op, left, right } => ExprKind::Binary {
            op: *op,
            left: Box::new(rewrite_expr(left, maps, scope)),
            right: Box::new(rewrite_expr(right, maps, scope)),
        },
        ExprKind::Unary { op, operand } => ExprKind::Unary {
            op: *op,
            operand: Box::new(rewrite_expr(operand, maps, scope)),
        },
        ExprKind::Call { callee, args } => ExprKind::Call {
            callee: Box::new(rewrite_expr(callee, maps, scope)),
            args: args.iter().map(|a| rewrite_expr(a, maps, scope)).collect(),
        },
        ExprKind::Index { object, index } => ExprKind::Index {
            object: Box::new(rewrite_expr(object, maps, scope)),
            index: Box::new(rewrite_expr(index, maps, scope)),
        },
        ExprKind::Field { object, field } => ExprKind::Field {
            object: Box::new(rewrite_expr(object, maps, scope)),
            field: field.clone(),
        },
        ExprKind::Array(elements) => {
            ExprKind::Array(elements.iter().map(|e| rewrite_expr(e, maps, scope)).collect())
        }
        ExprKind::Assign { target, value } => ExprKind::Assign {
            target: Box::new(rewrite_expr(target, maps, scope)),
            value: Box::new(rewrite_expr(value, maps, scope)),
        },
        ExprKind::ChannelSend { channel, value } => ExprKind::ChannelSend {
            channel: Box::new(rewrite_expr(channel, maps, scope)),
            value: Box::new(rewrite_expr(value, maps, scope)),
        },
        ExprKind::ChannelRecv(e) => {
            ExprKind::ChannelRecv(Box::new(rewrite_expr(e, maps, scope)))
        }
        ExprKind::Await(e) => ExprKind::Await(Box::new(rewrite_expr(e, maps, scope))),
        ExprKind::Match { scrutinee, arms } => ExprKind::Match {
            scrutinee: Box::new(rewrite_expr(scrutinee, maps, scope)),
            arms: arms
                .iter()
                .map(|arm| {
                    let mark = scope.len();
                    let pattern = rewrite_pattern(&arm.pattern, maps, scope);
                    let body = rewrite_expr(&arm.body, maps, scope);
                    scope.truncate(mark);
                    MatchArm { pattern, body: Box::new(body) }
                })
                .collect(),
        },
        ExprKind::SelectExpr { arms, default } => ExprKind::SelectExpr {
            arms: arms
                .iter()
                .map(|(var, channel, body)| {
                    let channel = rewrite_expr(channel, maps, scope);
                    let mark = scope.len();
                    if let Some(name) = var {
                        scope.push(name.clone());
                    }
                    let body = rewrite_expr(body, maps, scope);
                    scope.truncate(mark);
                    (var.clone(), channel, body)
                })
                .collect(),
            default: default.as_ref().map(|d| Box::new(rewrite_expr(d, maps, scope))),
        },
        ExprKind::Lambda { params, ret_ty, body, block, locals } => {
            // Свободные имена вычислены парсером до манглинга: имена
            // top-level функций/вариантов нужно обновить, локальные — нет.
            let locals = locals
                .iter()
                .map(|n| {
                    if bound(scope, n) {
                        n.clone()
                    } else {
                        maps.value_map.get(n).cloned().unwrap_or_else(|| n.clone())
                    }
                })
                .collect();
            let mark = scope.len();
            let params = rewrite_params(params, maps, scope);
            let block = block
                .as_ref()
                .map(|b| b.iter().map(|s| rewrite_stmt(s, maps, scope)).collect());
            let body = Box::new(rewrite_expr(body, maps, scope));
            scope.truncate(mark);
            ExprKind::Lambda {
                params,
                ret_ty: ret_ty.as_ref().map(|t| rewrite_type(t, maps)),
                body,
                block,
                locals,
            }
        }
        ExprKind::AiLoad(s) => ExprKind::AiLoad(s.clone()),
        ExprKind::AiInfer { model, input } => ExprKind::AiInfer {
            model: Box::new(rewrite_expr(model, maps, scope)),
            input: Box::new(rewrite_expr(input, maps, scope)),
        },
        ExprKind::AiEmbed(e) => ExprKind::AiEmbed(Box::new(rewrite_expr(e, maps, scope))),
        ExprKind::AiAgent { name, config } => ExprKind::AiAgent {
            name: name.clone(),
            config: config
                .iter()
                .map(|(k, v)| (k.clone(), rewrite_expr(v, maps, scope)))
                .collect(),
        },
        ExprKind::AiAgentCall { agent, input } => ExprKind::AiAgentCall {
            agent: Box::new(rewrite_expr(agent, maps, scope)),
            input: Box::new(rewrite_expr(input, maps, scope)),
        },
        ExprKind::AiGenerate { prompt } => ExprKind::AiGenerate { prompt: prompt.clone() },
    };
    Expr { kind, pos: expr.pos }
}


