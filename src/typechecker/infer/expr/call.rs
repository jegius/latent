//! Вывод типов для вызовов: методы, вариативные builtins, обычные функции.

use super::super::super::checker::TypeChecker;
use super::super::super::types::{Type, TypeError};
use crate::ast::*;
use crate::lexer::Position;

/// Встроенные функции с переменным числом аргументов. Для них пропускаем
/// проверку арности, но проверяем каждый аргумент (§8).
const VARIADIC_BUILTINS: &[&str] = &[
    "print", "assert", "ai_infer", "ai_embed", "ai_stream", "stream_next",
    "tensor", "semantic", "matmul", "cosine_similarity", "dot", "magnitude",
    "zeros", "ones", "snapshot", "ai_contract", "enforce_contract", "assert_eq",
    "len", "push", "str", "int", "float", "sqrt",
    "alloc", "load8", "store8", "load32", "store32", "memcopy",
];

impl TypeChecker {
    /// Типизирует вызов: методы встроенных типов, вариативные встроенные и
    /// обычные функции.
    pub(super) fn infer_call(
        &mut self,
        callee: &Expr,
        args: &[Expr],
        pos: Position,
    ) -> Result<Type, TypeError> {
        // Метод-вызовы на встроенных типах: ch.send(v), ch.recv() и т.п.
        if let ExprKind::Field { object, field } = &callee.kind {
            let t_obj_raw = self.infer_expr(object)?;
            let t_obj = self.apply(&t_obj_raw);
            if matches!(&t_obj, Type::Named(n) if n == "channel") || matches!(&t_obj, Type::Generic(n, _) if n == "Channel") {
                for a in args {
                    self.infer_expr(a)?;
                }
                return Ok(match field.as_str() {
                    "recv" => self.fresh_var(),
                    _ => Type::Unit, // send/push/...
                });
            }
            // Прочие методы (arr.push/pop/length): проверяем аргументы,
            // возвращаем свежую переменную — строгая типизация не нужна.
            for a in args {
                self.infer_expr(a)?;
            }
            return Ok(self.fresh_var());
        }

        // Вариативные встроенные функции: проверяем аргументы, но не арность.
        if let ExprKind::Identifier(name) = &callee.kind {
            // `new Class(...)` — конструктор класса.
            if name.starts_with("new ") {
                for arg in args {
                    self.infer_expr(arg)?;
                }
                return Ok(Type::Named(name[4..].to_string()));
            }
            if VARIADIC_BUILTINS.contains(&name.as_str()) {
                for arg in args {
                    self.infer_expr(arg)?;
                }
                return Ok(self.builtin_return_type(name));
            }
        }

        let t_callee = self.infer_expr(callee)?;
        let t_callee = self.apply(&t_callee);

        let arg_types: Vec<Type> = args.iter().map(|_| self.fresh_var()).collect();
        let ret_type = self.fresh_var();
        let expected_fn = Type::Fn(arg_types.clone(), Box::new(ret_type.clone()));

        self.unify(&t_callee, &expected_fn, callee.pos)?;

        for (arg, expected) in args.iter().zip(arg_types.iter()) {
            let t_arg = self.infer_expr(arg)?;
            self.unify(&t_arg, expected, arg.pos)?;
        }

        let _ = pos;
        Ok(ret_type)
    }

    /// Статический тип результата вариативного builtin'а.
    fn builtin_return_type(&mut self, name: &str) -> Type {
        match name {
            "ai_infer" => Type::String,
            "ai_embed" => Type::Array(Box::new(Type::Float)),
            "ai_stream" => Type::Float,
            "stream_next" => Type::String,
            "tensor" | "zeros" | "ones" => {
                Type::Generic("Tensor".to_string(), vec![self.fresh_var()])
            }
            "semantic" => Type::Generic("Semantic".to_string(), vec![Type::String]),
            "cosine_similarity" | "dot" | "magnitude" => Type::Float,
            "matmul" => Type::Generic("Tensor".to_string(), vec![self.fresh_var()]),
            "len" => Type::Int,
            "alloc" | "load8" | "load32" => Type::Int,
            "store8" | "store32" | "memcopy" => Type::Unit,
            "str" => Type::String,
            "int" => Type::Int,
            "float" => Type::Float,
            "sqrt" => Type::Float,
            "push" => Type::Unit,
            "snapshot" | "enforce_contract" => Type::Bool,
            "ai_contract" => Type::Generic("Contract".to_string(), vec![Type::String]),
            _ => Type::Unit, // print, assert, ...
        }
    }
}
