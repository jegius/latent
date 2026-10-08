//! Контекст компиляции функции, layout классов и преобразование типов.

use super::bytecode::ByteBuffer;
use super::bytecode::valtype;
use crate::typechecker::Type;
use std::collections::HashMap;

/// Статический (best-effort) тип выражения/локальной переменной для выбора
/// правильных WASM-инструкций (i32 vs f64, string vs array).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaticTy {
    Int,
    Float,
    Bool,
    Str,
    Array,
    /// Функция/замыкание — значение представлено указателем на closure.
    Fn,
    Unknown,
}

impl StaticTy {
    /// WASM-тип значения для этого статического типа.
    pub fn valtype(self) -> u8 {
        match self {
            StaticTy::Float => valtype::F64,
            _ => valtype::I32,
        }
    }
}

/// Контекст компиляции одной функции
pub struct FuncContext {
    pub(super) locals: HashMap<String, (u32, u8)>,
    /// Статический тип каждой зарезервированной локальной переменной
    /// (индекс = индекс локальной). Заполняется по мере `reserve_local`.
    pub(super) local_types: Vec<u8>,
    /// Статический (best-effort) тип каждой локальной — для выбора
    /// строковых/числовых путей в кодогене.
    pub(super) local_static: Vec<StaticTy>,
    /// Имя класса локальной переменной (для доступа к полям/методам).
    pub(super) local_class: Vec<Option<String>>,
    pub(super) local_count: u32,
    pub(super) body: ByteBuffer,
    pub(super) has_result: bool,
}

impl FuncContext {
    pub(super) fn new(has_result: bool) -> Self {
        Self {
            locals: HashMap::new(),
            local_types: Vec::new(),
            local_static: Vec::new(),
            local_class: Vec::new(),
            local_count: 0,
            body: ByteBuffer::new(),
            has_result,
        }
    }

    /// Регистрирует параметр/локальную: valtype + статический тип.
    #[allow(dead_code)]
    pub(super) fn declare(&mut self, name: &str, ty: u8, st: StaticTy) -> u32 {
        self.declare_class(name, ty, st, None)
    }

    /// Регистрирует локальную с известным именем класса.
    pub(super) fn declare_class(
        &mut self,
        name: &str,
        ty: u8,
        st: StaticTy,
        class: Option<String>,
    ) -> u32 {
        let idx = self.local_count;
        self.local_count += 1;
        self.local_types.push(ty);
        self.local_static.push(st);
        self.local_class.push(class);
        self.locals.insert(name.to_string(), (idx, ty));
        idx
    }

    /// Имя класса локальной (если известно).
    pub(super) fn class_of(&self, idx: u32) -> Option<String> {
        self.local_class.get(idx as usize).cloned().flatten()
    }

    /// Резервирует новый локальный слот заданного WASM-типа и возвращает индекс.
    pub(super) fn reserve_local_ty(&mut self, ty: u8) -> u32 {
        let idx = self.local_count;
        self.local_count += 1;
        self.local_types.push(ty);
        self.local_static.push(StaticTy::Unknown);
        self.local_class.push(None);
        idx
    }

    /// Резервирует локальный слот i32 (наиболее частый случай).
    pub(super) fn reserve_local(&mut self) -> u32 {
        self.reserve_local_ty(valtype::I32)
    }

    /// Статический тип локальной по индексу.
    pub(super) fn static_of(&self, idx: u32) -> StaticTy {
        self.local_static.get(idx as usize).copied().unwrap_or(StaticTy::Unknown)
    }
}

/// Layout класса в памяти
#[derive(Debug, Clone)]
pub struct ClassLayout {
    pub(super) fields: Vec<FieldInfo>,
    pub(super) size: u32,
    pub(super) align: u32,
}

/// Информация о поле класса
#[derive(Debug, Clone)]
pub struct FieldInfo {
    pub(super) name: String,
    pub(super) offset: u32,
    pub(super) valtype: u8,
}

/// Преобразуем Latent-тип в WASM valtype
pub(super) fn latent_to_wasm(ty: &Type) -> u8 {
    match ty {
        Type::Int => valtype::I32,
        Type::Float => valtype::F64,
        Type::Bool => valtype::I32,
        _ => valtype::I32,
    }
}

/// Статический тип по Latent-типу.
pub(super) fn latent_to_static(ty: &Type) -> StaticTy {
    match ty {
        Type::Int => StaticTy::Int,
        Type::Float => StaticTy::Float,
        Type::Bool => StaticTy::Bool,
        Type::String => StaticTy::Str,
        Type::Array(_) => StaticTy::Array,
        Type::Fn(_, _) => StaticTy::Fn,
        _ => StaticTy::Unknown,
    }
}

/// Парсинг AST-типа в Type
pub(super) fn parse_ast_type(ty: &crate::ast::Type) -> Type {
    match ty {
        crate::ast::Type::Named(name) => match name.as_str() {
            "int" => Type::Int,
            "float" => Type::Float,
            "bool" => Type::Bool,
            "string" => Type::String,
            "null" => Type::Null,
            "unit" | "void" => Type::Unit,
            other => Type::Named(other.to_string()),
        },
        crate::ast::Type::Array(inner) => Type::Array(Box::new(parse_ast_type(inner))),
        crate::ast::Type::Fn(args, ret) => {
            let a = args.iter().map(|x| parse_ast_type(x)).collect();
            let r = parse_ast_type(ret);
            Type::Fn(a, Box::new(r))
        }
        crate::ast::Type::Union(types) => {
            if let Some(first) = types.first() {
                parse_ast_type(first)
            } else {
                Type::Unit
            }
        }
        crate::ast::Type::Generic(name, args) => {
            let a = args.iter().map(|x| parse_ast_type(x)).collect();
            Type::Generic(name.clone(), a)
        }
        _ => Type::Var("$Unknown".to_string()),
    }
}

/// Статический тип из AST-аннотации.
pub(super) fn ast_to_static(ty: &crate::ast::Type) -> StaticTy {
    latent_to_static(&parse_ast_type(ty))
}