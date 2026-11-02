//! Линкер модулей: таблица экспортов, манглинг имён, сборка единого `Program`.
//!
//! Линковка двухфазная:
//! 1. для всех модулей (детерминированный порядок — сортировка по canonical
//!    path) строятся таблицы `(module, name) → mangled` и проверяются импорты;
//! 2. AST каждого модуля переписывается (см. [`super::rewrite`]), после чего
//!    остаётся один `Program` без `import`/`export` — его и получают
//!    typechecker/codegen.
//!
//! Формат манглинга: `m<idx>$<name>` (варианты enum — так же). `main`
//! entry-модуля не манглятся: именно его экспортирует WASM-модуль.

use super::loader::{resolve_import_path, Module, Project};
use super::rewrite::{self, RewriteMaps};
use crate::ast::*;
use std::collections::{HashMap, HashSet};

/// Вид top-level объявления.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeclKind {
    Fn,
    Class,
    Enum,
}

#[derive(Debug, Clone)]
struct ModuleMeta {
    path: String,
    idx: usize,
    /// Имя top-level объявления → вид.
    decls: HashMap<String, DeclKind>,
    /// Имя варианта → mangled (все enum'ы этого модуля).
    own_variants: HashMap<String, String>,
    /// enum → [(вариант, mangled)] (нужно для импорта enum'а вместе с вариантами).
    enums: HashMap<String, Vec<(String, String)>>,
    exports: Vec<ExportFlag>,
}

#[derive(Debug, Clone)]
struct ExportSymbol {
    mangled: String,
    kind: DeclKind,
    variants: Vec<(String, String)>,
}

/// `m<idx>$<name>`; `main` entry-модуля остаётся `main`.
pub(crate) fn mangle(idx: usize, name: &str) -> String {
    format!("m{}${}", idx, name)
}

fn mangled_decl(idx: usize, entry_idx: usize, kind: DeclKind, name: &str) -> String {
    if kind == DeclKind::Fn && idx == entry_idx && name == "main" {
        "main".to_string()
    } else {
        mangle(idx, name)
    }
}

/// Собирает `decls/enums/own_variants` одного модуля.
fn collect_meta(path: &str, idx: usize, program: &Program) -> ModuleMeta {
    let mut decls = HashMap::new();
    let mut own_variants = HashMap::new();
    let mut enums: HashMap<String, Vec<(String, String)>> = HashMap::new();

    for stmt in &program.statements {
        match &stmt.kind {
            StmtKind::Fn { name, .. } => {
                decls.insert(name.clone(), DeclKind::Fn);
            }
            StmtKind::Class { name, .. } => {
                decls.insert(name.clone(), DeclKind::Class);
            }
            StmtKind::Enum { name, variants } => {
                decls.insert(name.clone(), DeclKind::Enum);
                let mut pairs = Vec::new();
                for v in variants {
                    let mangled = mangle(idx, &v.name);
                    own_variants.insert(v.name.clone(), mangled.clone());
                    pairs.push((v.name.clone(), mangled));
                }
                enums.insert(name.clone(), pairs);
            }
            _ => {}
        }
    }

    ModuleMeta {
        path: path.to_string(),
        idx,
        decls,
        own_variants,
        enums,
        exports: program.exports.clone(),
    }
}

/// Собирает таблицу экспортов модуля (имя → mangled + варианты для enum).
fn build_export_table(meta: &ModuleMeta, entry_idx: usize) -> Result<HashMap<String, ExportSymbol>, String> {
    let mut table: HashMap<String, ExportSymbol> = HashMap::new();
    for flag in &meta.exports {
        let Some(kind) = meta.decls.get(&flag.name).copied() else {
            return Err(format!(
                "{}:{}:{}: export '{}': объявление не найдено",
                meta.path, flag.pos.line, flag.pos.column, flag.name
            ));
        };
        let variants = meta.enums.get(&flag.name).cloned().unwrap_or_default();
        table.insert(
            flag.name.clone(),
            ExportSymbol {
                mangled: mangled_decl(meta.idx, entry_idx, kind, &flag.name),
                kind,
                variants,
            },
        );
    }
    Ok(table)
}

/// Точка входа линкера: проект → единая программа.
pub(crate) fn link(project: Project) -> Result<Program, String> {
    let mut modules: Vec<Module> = project.modules;
    // Детерминированный порядок: canonical path. DFS загрузчика задаёт состав,
    // сортировка — индексы модулей (m0, m1, ...).
    modules.sort_by(|a, b| a.path.cmp(&b.path));
    let entry_idx = modules
        .iter()
        .position(|m| m.path == project.entry_path)
        .ok_or_else(|| format!("{}: entry-модуль потерян при линковке", project.entry_path))?;

    let metas: Vec<ModuleMeta> = modules
        .iter()
        .enumerate()
        .map(|(idx, m)| collect_meta(&m.path, idx, &m.program))
        .collect();
    let index_by_path: HashMap<&str, usize> =
        metas.iter().map(|m| (m.path.as_str(), m.idx)).collect();

    let export_tables: Vec<HashMap<String, ExportSymbol>> = metas
        .iter()
        .map(|m| build_export_table(m, entry_idx))
        .collect::<Result<_, _>>()?;

    let mut statements: Vec<Stmt> = Vec::new();
    for (module, meta) in modules.iter().zip(metas.iter()) {
        let maps = build_maps(module, meta, &metas, &index_by_path, &export_tables, entry_idx)?;
        statements.extend(rewrite::rewrite_module(&module.program, &maps));
    }

    Ok(Program {
        statements,
        imports: Vec::new(),
        exports: Vec::new(),
    })
}

/// Импортированные имена → mangled; локальные объявления, варианты и типы.
fn build_maps(
    module: &Module,
    meta: &ModuleMeta,
    metas: &[ModuleMeta],
    index_by_path: &HashMap<&str, usize>,
    export_tables: &[HashMap<String, ExportSymbol>],
    entry_idx: usize,
) -> Result<RewriteMaps, String> {
    let mut value_map: HashMap<String, String> = HashMap::new();
    let mut type_map: HashMap<String, String> = HashMap::new();
    let mut local_names: HashSet<String> = HashSet::new();

    for (name, kind) in &meta.decls {
        let mangled = mangled_decl(meta.idx, entry_idx, *kind, name);
        value_map.insert(name.clone(), mangled.clone());
        if *kind != DeclKind::Fn {
            type_map.insert(name.clone(), mangled);
        }
        local_names.insert(name.clone());
    }
    for (variant, mangled) in &meta.own_variants {
        value_map.entry(variant.clone()).or_insert_with(|| mangled.clone());
        local_names.insert(variant.clone());
    }

    let mut variant_map = meta.own_variants.clone();
    let mut imported: HashSet<String> = HashSet::new();

    for import in &module.program.imports {
        let resolved = resolve_import_path(&module.path, &import.path).map_err(|msg| {
            format!("{}:{}:{}: {}", module.path, import.pos.line, import.pos.column, msg)
        })?;
        let target_idx = *index_by_path.get(resolved.as_str()).ok_or_else(|| {
            format!(
                "{}:{}:{}: модуль не найден: {}",
                module.path, import.pos.line, import.pos.column, resolved
            )
        })?;
        let ImportSpecifiers::Named(specs) = &import.specifiers else {
            continue;
        };
        for spec in specs {
            let local = spec.alias.clone().unwrap_or_else(|| spec.name.clone());
            let symbol = export_tables[target_idx].get(&spec.name).ok_or_else(|| {
                format!(
                    "{}:{}:{}: символ '{}' не экспортирован из '{}'",
                    module.path,
                    spec.pos.line,
                    spec.pos.column,
                    spec.name,
                    metas[target_idx].path
                )
            })?;
            check_binding(&module.path, spec.pos, &local, &local_names, &imported)?;
            imported.insert(local.clone());

            value_map.insert(local.clone(), symbol.mangled.clone());
            if symbol.kind != DeclKind::Fn {
                type_map.insert(local.clone(), symbol.mangled.clone());
            }
            if symbol.kind == DeclKind::Enum {
                for (variant, mangled) in &symbol.variants {
                    check_binding(&module.path, spec.pos, variant, &local_names, &imported)?;
                    imported.insert(variant.clone());
                    value_map.insert(variant.clone(), mangled.clone());
                    variant_map.insert(variant.clone(), mangled.clone());
                }
            }
        }
    }

    Ok(RewriteMaps { value_map, type_map, variant_map })
}

/// Проверяет, что имя ещё не занято локально и не импортировано дважды.
fn check_binding(
    path: &str,
    pos: crate::lexer::Position,
    name: &str,
    local_names: &HashSet<String>,
    imported: &HashSet<String>,
) -> Result<(), String> {
    if local_names.contains(name) {
        return Err(format!(
            "{}:{}:{}: имя '{}' уже объявлено в модуле",
            path, pos.line, pos.column, name
        ));
    }
    if imported.contains(name) {
        return Err(format!(
            "{}:{}:{}: дубликат импортированного имени '{}'",
            path, pos.line, pos.column, name
        ));
    }
    Ok(())
}
