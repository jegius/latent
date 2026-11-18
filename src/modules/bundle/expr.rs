//! Печать выражений, паттернов и типов для bundle.
//!
//! Все составные выражения оборачиваются в скобки — приоритеты не нужны, AST
//! при повторном разборе сохраняется.

use super::ident;
use crate::ast::*;

pub(super) fn print_expr(expr: &Expr, out: &mut String) -> Result<(), String> {
    match &expr.kind {
        ExprKind::Number(n) => out.push_str(&format_number(*n)?),
        ExprKind::String(s) => {
            out.push('"');
            out.push_str(&escape_string(s));
            out.push('"');
        }
        ExprKind::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        ExprKind::Null => out.push_str("null"),
        ExprKind::Identifier(name) => out.push_str(&ident(name)),
        ExprKind::Binary { op, left, right } => {
            out.push('(');
            print_expr(left, out)?;
            out.push(' ');
            out.push_str(binary_op(*op));
            out.push(' ');
            print_expr(right, out)?;
            out.push(')');
        }
        ExprKind::Unary { op, operand } => {
            out.push('(');
            out.push_str(match op {
                UnaryOp::Neg => "-",
                UnaryOp::Not => "!",
            });
            print_expr(operand, out)?;
            out.push(')');
        }
        ExprKind::Call { callee, args } => {
            print_expr(callee, out)?;
            out.push('(');
            for (i, a) in args.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                print_expr(a, out)?;
            }
            out.push(')');
        }
        ExprKind::Index { object, index } => {
            print_expr(object, out)?;
            out.push('[');
            print_expr(index, out)?;
            out.push(']');
        }
        ExprKind::Field { object, field } => {
            print_expr(object, out)?;
            out.push('.');
            out.push_str(field);
        }
        ExprKind::Array(elements) => {
            out.push('[');
            for (i, e) in elements.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                print_expr(e, out)?;
            }
            out.push(']');
        }
        ExprKind::Assign { target, value } => {
            out.push('(');
            print_expr(target, out)?;
            out.push_str(" = ");
            print_expr(value, out)?;
            out.push(')');
        }
        ExprKind::ChannelSend { channel, value } => {
            out.push('(');
            print_expr(channel, out)?;
            out.push_str(" <- ");
            print_expr(value, out)?;
            out.push(')');
        }
        ExprKind::ChannelRecv(e) => {
            out.push_str("(<-");
            print_expr(e, out)?;
            out.push(')');
        }
        ExprKind::Await(e) => {
            out.push_str("(await ");
            print_expr(e, out)?;
            out.push(')');
        }
        ExprKind::Match { scrutinee, arms } => {
            out.push_str("(match ");
            print_expr(scrutinee, out)?;
            out.push_str(" { ");
            for (i, arm) in arms.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str("case ");
                print_pattern(&arm.pattern, out)?;
                out.push_str(": ");
                print_expr(&arm.body, out)?;
            }
            out.push_str(" })");
        }
        ExprKind::SelectExpr { arms, default } => {
            out.push_str("(select { ");
            for (i, (var, channel, body)) in arms.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str("case ");
                if let Some(name) = var {
                    out.push_str(&ident(name));
                    out.push(' ');
                }
                out.push_str("<- ");
                print_expr(channel, out)?;
                out.push_str(": ");
                print_expr(body, out)?;
            }
            if let Some(d) = default {
                if !arms.is_empty() {
                    out.push_str(", ");
                }
                out.push_str("default: ");
                print_expr(d, out)?;
            }
            out.push_str(" })");
        }
        ExprKind::Lambda { params, ret_ty, body, block, .. } => {
            out.push_str("(fn(");
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
            out.push(')');
            if let Some(ty) = ret_ty {
                out.push_str(" -> ");
                print_type(ty, out)?;
            }
            if let Some(block_stmts) = block {
                out.push(' ');
                super::print_block(block_stmts, 0, out)?;
            } else {
                out.push_str(" => ");
                print_expr(body, out)?;
            }
            out.push(')');
        }
        ExprKind::AiGenerate { prompt } => {
            out.push_str("ai_generate!(\"");
            out.push_str(&escape_string(prompt));
            out.push_str("\")");
        }
        other => {
            return Err(format!(
                "bundle: выражение без Latent-синтаксиса: {:?}",
                other
            ))
        }
    }
    Ok(())
}

pub(super) fn print_pattern(pattern: &Pattern, out: &mut String) -> Result<(), String> {
    match pattern {
        Pattern::Wildcard => out.push('_'),
        Pattern::Literal(lit) => match lit {
            ExprKind::Number(n) => out.push_str(&format_number(*n)?),
            ExprKind::String(s) => {
                out.push('"');
                out.push_str(&escape_string(s));
                out.push('"');
            }
            ExprKind::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            ExprKind::Null => out.push_str("null"),
            other => {
                return Err(format!(
                    "bundle: литерал-паттерн без синтаксиса: {:?}",
                    other
                ))
            }
        },
        Pattern::Identifier(name) => out.push_str(&ident(name)),
        Pattern::Constructor(name, subs) => {
            out.push_str(&ident(name));
            out.push('(');
            for (i, p) in subs.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                print_pattern(p, out)?;
            }
            out.push(')');
        }
    }
    Ok(())
}

pub(super) fn print_type(ty: &Type, out: &mut String) -> Result<(), String> {
    match ty {
        Type::Named(name) => out.push_str(&ident(name)),
        Type::Array(inner) => {
            out.push('[');
            print_type(inner, out)?;
            out.push(']');
        }
        Type::Fn(args, ret) => {
            out.push_str("fn(");
            for (i, a) in args.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                print_type(a, out)?;
            }
            out.push_str(") -> ");
            print_type(ret, out)?;
        }
        Type::Generic(name, args) => {
            out.push_str(&ident(name));
            out.push('<');
            for (i, a) in args.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                print_type(a, out)?;
            }
            out.push('>');
        }
        Type::Union(_) => return Err("bundle: union-типы не имеют синтаксиса v1".to_string()),
        Type::Unit => out.push_str("unit"),
    }
    Ok(())
}

fn binary_op(op: BinaryOp) -> &'static str {
    match op {
        BinaryOp::Add => "+",
        BinaryOp::Sub => "-",
        BinaryOp::Mul => "*",
        BinaryOp::Div => "/",
        BinaryOp::Mod => "%",
        BinaryOp::Eq => "==",
        BinaryOp::NotEq => "!=",
        BinaryOp::Lt => "<",
        BinaryOp::Gt => ">",
        BinaryOp::LtEq => "<=",
        BinaryOp::GtEq => ">=",
        BinaryOp::And => "&&",
        BinaryOp::Or => "||",
        BinaryOp::BitAnd => "&",
        BinaryOp::BitOr => "|",
        BinaryOp::BitXor => "^",
        BinaryOp::Shl => "<<",
        BinaryOp::Shr => ">>",
    }
}

pub(super) fn escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out
}

/// Число в форме, которую понимает лексер (`read_number`).
fn format_number(n: f64) -> Result<String, String> {
    if !n.is_finite() {
        return Err("bundle: NaN/Infinity не имеют синтаксиса".to_string());
    }
    if n.is_sign_negative() {
        // Лексер не читает знак: отрицательные литералы в AST не появляются
        // (в исходнике это унарный минус). Защита от ручного AST.
        return Err("bundle: отрицательный числовой литерал".to_string());
    }
    Ok(format!("{}", n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_strings() {
        assert_eq!(escape_string("a\"b\\c\n\t"), "a\\\"b\\\\c\\n\\t");
    }

    #[test]
    fn formats_numbers() {
        assert_eq!(format_number(42.0).unwrap(), "42");
        assert_eq!(format_number(1.5).unwrap(), "1.5");
        assert!(format_number(f64::NAN).is_err());
        assert!(format_number(-1.0).is_err());
    }

    #[test]
    fn numbers_roundtrip_through_lexer() {
        for n in [0.0, 1.0, 1.5, 1e21, 1e300, 1e-300, 1.5e-7, 123456789012345.0] {
            let text = format_number(n).unwrap();
            let parsed: f64 = text.parse().unwrap();
            assert_eq!(parsed.to_bits(), n.to_bits(), "{text}");
        }
    }
}
