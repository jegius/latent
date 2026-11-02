//! Переписывание паттернов и типовых аннотаций модуля.
//!
//! Паттерн: имя конструктора манглятся, связываемые имена — нет.
//! Тип: `Named`/`Generic` переписываются только по таблице типов, чтобы
//! случайно не задеть одноимённую функцию.

use super::rewrite::{RewriteMaps, Scope};
use crate::ast::*;

pub(super) fn rewrite_pattern(pattern: &Pattern, maps: &RewriteMaps, scope: &mut Scope) -> Pattern {
    match pattern {
        Pattern::Wildcard => Pattern::Wildcard,
        Pattern::Literal(lit) => Pattern::Literal(lit.clone()),
        Pattern::Identifier(name) => {
            scope.push(name.clone());
            Pattern::Identifier(name.clone())
        }
        Pattern::Constructor(name, subs) => Pattern::Constructor(
            maps.variant_map.get(name).cloned().unwrap_or_else(|| name.clone()),
            subs.iter().map(|p| rewrite_pattern(p, maps, scope)).collect(),
        ),
    }
}

pub(super) fn rewrite_type(ty: &Type, maps: &RewriteMaps) -> Type {
    match ty {
        Type::Named(name) => {
            Type::Named(maps.type_map.get(name).cloned().unwrap_or_else(|| name.clone()))
        }
        Type::Array(inner) => Type::Array(Box::new(rewrite_type(inner, maps))),
        Type::Fn(args, ret) => Type::Fn(
            args.iter().map(|t| rewrite_type(t, maps)).collect(),
            Box::new(rewrite_type(ret, maps)),
        ),
        Type::Union(types) => Type::Union(types.iter().map(|t| rewrite_type(t, maps)).collect()),
        Type::Generic(name, args) => Type::Generic(
            maps.type_map.get(name).cloned().unwrap_or_else(|| name.clone()),
            args.iter().map(|t| rewrite_type(t, maps)).collect(),
        ),
        Type::Unit => Type::Unit,
    }
}
