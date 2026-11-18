//! Печать связанного AST обратно в Latent-исходник (`latentc bundle`).
//!
//! Требования:
//! * только подмножество языка без `import`/`export` (линкер их уже снял);
//! * мангленные имена (`m0$name`) печатаются как `m0__name`: selfhost-лексер
//!   принимает только `[A-Za-z_][A-Za-z0-9_]*`, а `$` в нём недопустим;
//! * печать детерминирована и не зависит от HashMap'ов;
//! * AST после повторного разбора эквивалентен связанному (позиции не важны),
//!   поэтому `compile(bundle)` даёт те же WASM-байты, что `compile_files`.
//!
//! Печать выражений/типов/паттернов — в [`super::bundle::expr`].

mod expr;

use crate::ast::*;
use expr::{print_expr, print_type};

/// `m0$name` → `m0__name` (лексемы selfhost-компилятора).
fn ident(name: &str) -> String {
    name.replace('$', "__")
}

/// Плоский исходник всей программы.
pub fn print_program(program: &Program) -> Result<String, String> {
    if !program.imports.is_empty() || !program.exports.is_empty() {
        return Err(
            "bundle: программа должна быть связана (import/export уже сняты)".to_string(),
        );
    }
    let mut out = String::new();
    for stmt in &program.statements {
        print_stmt(stmt, 0, &mut out)?;
    }
    Ok(out)
}

fn indent(out: &mut String, level: usize) {
    for _ in 0..level {
        out.push_str("    ");
    }
}

fn print_block(stmts: &[Stmt], level: usize, out: &mut String) -> Result<(), String> {
    out.push_str("{\n");
    for stmt in stmts {
        print_stmt(stmt, level + 1, out)?;
    }
    indent(out, level);
    out.push('}');
    Ok(())
}

/// Выражение в позиции инструкции: присваивание печатается без скобок.
///
/// Selfhost-компилятор не принимает `(this.x = x)` (присваивание как
/// parenthesized-выражение), поэтому в statement-позициях скобки не нужны —
/// ровно как в исходнике.
fn print_stmt_expr(expr: &Expr, out: &mut String) -> Result<(), String> {
    if let ExprKind::Assign { target, value } = &expr.kind {
        print_expr(target, out)?;
        out.push_str(" = ");
        return print_expr(value, out);
    }
    print_expr(expr, out)
}

fn print_params(params: &[Param], out: &mut String) -> Result<(), String> {
    for (i, p) in params.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push_str(&ident(&p.name));
        if let Some(ty) = &p.ty {
            out.push_str(": ");
            print_type(ty, out)?;
        }
    }
    Ok(())
}

fn print_stmt(stmt: &Stmt, level: usize, out: &mut String) -> Result<(), String> {
    indent(out, level);
    match &stmt.kind {
        StmtKind::Let { name, ty, value } => {
            out.push_str("let ");
            out.push_str(&ident(name));
            if let Some(ty) = ty {
                out.push_str(": ");
                print_type(ty, out)?;
            }
            out.push_str(" = ");
            print_expr(value, out)?;
            out.push_str(";\n");
        }
        StmtKind::Fn { name, params, ret_ty, body, is_async } => {
            if *is_async {
                out.push_str("async ");
            }
            out.push_str("fn ");
            out.push_str(&ident(name));
            out.push('(');
            print_params(params, out)?;
            out.push(')');
            if let Some(ty) = ret_ty {
                out.push_str(" -> ");
                print_type(ty, out)?;
            }
            out.push(' ');
            print_block(body, level, out)?;
            out.push('\n');
        }
        StmtKind::Class { name, fields, methods } => {
            out.push_str("class ");
            out.push_str(&ident(name));
            out.push_str(" {\n");
            for f in fields {
                indent(out, level + 1);
                out.push_str(&ident(&f.name));
                if let Some(ty) = &f.ty {
                    out.push_str(": ");
                    print_type(ty, out)?;
                }
                out.push_str(";\n");
            }
            for m in methods {
                print_stmt(m, level + 1, out)?;
            }
            indent(out, level);
            out.push_str("}\n");
        }
        StmtKind::Enum { name, variants } => {
            out.push_str("enum ");
            out.push_str(&ident(name));
            out.push_str(" { ");
            for (i, v) in variants.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(&ident(&v.name));
                if !v.fields.is_empty() {
                    out.push('(');
                    for (j, ty) in v.fields.iter().enumerate() {
                        if j > 0 {
                            out.push_str(", ");
                        }
                        print_type(ty, out)?;
                    }
                    out.push(')');
                }
            }
            out.push_str(" }\n");
        }
        StmtKind::If { cond, then_branch, else_branch } => {
            out.push_str("if (");
            print_expr(cond, out)?;
            out.push_str(") ");
            print_block(then_branch, level, out)?;
            if let Some(branch) = else_branch {
                out.push_str(" else ");
                print_block(branch, level, out)?;
            }
            out.push('\n');
        }
        StmtKind::While { cond, body } => {
            out.push_str("while (");
            print_expr(cond, out)?;
            out.push_str(") ");
            print_block(body, level, out)?;
            out.push('\n');
        }
        StmtKind::For { var, iterable, body } => {
            out.push_str("for (let ");
            out.push_str(&ident(var));
            out.push_str(" in ");
            print_expr(iterable, out)?;
            out.push_str(") ");
            print_block(body, level, out)?;
            out.push('\n');
        }
        StmtKind::ForC { init, cond, step, body } => {
            out.push_str("for (");
            match init.as_deref() {
                None => out.push(';'),
                Some(Stmt { kind: StmtKind::Let { name, ty, value }, .. }) => {
                    out.push_str("let ");
                    out.push_str(&ident(name));
                    if let Some(ty) = ty {
                        out.push_str(": ");
                        print_type(ty, out)?;
                    }
                    out.push_str(" = ");
                    print_expr(value, out)?;
                    out.push(';');
                }
                Some(Stmt { kind: StmtKind::Expr(e), .. }) => {
                    print_stmt_expr(e, out)?;
                    out.push(';');
                }
                Some(other) => {
                    return Err(format!(
                        "bundle: неподдерживаемый init в for: {:?}",
                        other.kind
                    ))
                }
            }
            out.push(' ');
            if let Some(cond) = cond {
                print_expr(cond, out)?;
            }
            out.push_str("; ");
            if let Some(step) = step {
                print_stmt_expr(step, out)?;
            }
            out.push_str(") ");
            print_block(body, level, out)?;
            out.push('\n');
        }
        StmtKind::Return(value) => {
            out.push_str("return");
            if let Some(e) = value {
                out.push(' ');
                print_stmt_expr(e, out)?;
            }
            out.push_str(";\n");
        }
        StmtKind::Spawn(body) => {
            out.push_str("spawn ");
            print_block(body, level, out)?;
            out.push('\n');
        }
        StmtKind::Select { arms, default_branch } => {
            out.push_str("select {\n");
            for arm in arms {
                indent(out, level + 1);
                out.push_str("case ");
                if let Some(var) = &arm.var {
                    out.push_str(&ident(var));
                    out.push(' ');
                }
                out.push_str("<- ");
                print_expr(&arm.channel, out)?;
                out.push_str(": ");
                print_block(&arm.body, level + 1, out)?;
                out.push('\n');
            }
            if let Some(branch) = default_branch {
                indent(out, level + 1);
                out.push_str("default: ");
                print_block(branch, level + 1, out)?;
                out.push('\n');
            }
            indent(out, level);
            out.push_str("}\n");
        }
        StmtKind::Yield => out.push_str("yield;\n"),
        StmtKind::Test { name, body } => {
            out.push_str("test \"");
            out.push_str(&expr::escape_string(name));
            out.push_str("\" ");
            print_block(body, level, out)?;
            out.push('\n');
        }
        StmtKind::Decorator { name, args, target } => {
            out.push('@');
            out.push_str(&ident(name));
            if !args.is_empty() {
                out.push('(');
                for (i, a) in args.iter().enumerate() {
                    if i > 0 {
                        out.push_str(", ");
                    }
                    print_expr(a, out)?;
                }
                out.push(')');
            }
            out.push(' ');
            // Цель декоратора печатается как обычное объявление (свой отступ).
            print_stmt(target, level, out)?;
        }
        StmtKind::AiGenerate { prompt } => {
            out.push_str("ai_generate!(\"");
            out.push_str(&expr::escape_string(prompt));
            out.push_str("\");\n");
        }
        StmtKind::Expr(e) => {
            print_stmt_expr(e, out)?;
            out.push_str(";\n");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ident_sanitizes_dollar() {
        assert_eq!(ident("m0$square"), "m0__square");
        assert_eq!(ident("main"), "main");
        assert_eq!(ident("new m1$Point"), "new m1__Point");
    }

    #[test]
    fn rejects_linked_only_program() {
        let mut program = Program::new(vec![]);
        program.imports.push(ImportDecl {
            path: "./x.lat".to_string(),
            specifiers: ImportSpecifiers::SideEffect,
            pos: crate::lexer::Position::new(1, 1, 0),
        });
        assert!(print_program(&program).is_err());
    }

    #[test]
    fn mangle_helper_matches_linker() {
        assert_eq!(super::super::linker::mangle(3, "f"), "m3$f");
    }
}
