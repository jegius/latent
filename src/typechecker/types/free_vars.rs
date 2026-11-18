//! Свободные типовые переменные.

use super::Type;
use std::collections::HashSet;

pub(crate) fn free_vars(ty: &Type) -> HashSet<String> {
    match ty {
        Type::Var(name) => {
            let mut set = HashSet::new();
            set.insert(name.clone());
            set
        }
        Type::Array(inner) => free_vars(inner),
        Type::Fn(args, ret) => {
            let mut set = HashSet::new();
            for a in args {
                set.extend(free_vars(a));
            }
            set.extend(free_vars(ret));
            set
        }
        Type::Tuple(types) => {
            let mut set = HashSet::new();
            for t in types {
                set.extend(free_vars(t));
            }
            set
        }
        Type::Generic(_, args) => {
            let mut set = HashSet::new();
            for a in args {
                set.extend(free_vars(a));
            }
            set
        }
        Type::Poly { vars, body } => {
            let mut set = free_vars(body);
            for v in vars {
                set.remove(v);
            }
            set
        }
        _ => HashSet::new(),
    }
}
