//! Загрузчик модулей: канонические пути, DFS по `import`, разбор файлов.
//!
//! Загрузчик не знает ни о манглинге, ни о типах — его задача:
//! 1. нормализовать пути (`./`, `..`, `\\` → `/`);
//! 2. найти все файлы, достижимые из entry по `import` (циклы разрешены);
//! 3. разобрать каждый файл ровно один раз и вернуть модули в порядке DFS.
//!
//! Все ошибки содержат путь файла: `path: ...` либо `path:line:col: ...`
//! (позиция известна у объявления импорта).

use crate::ast::Program;
use crate::lexer::{Lexer, Position};
use crate::parser::Parser;
use std::collections::HashMap;

/// Файл проекта: путь (в любом виде) + исходный текст.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    pub path: String,
    pub text: String,
}

impl SourceFile {
    pub fn new(path: impl Into<String>, text: impl Into<String>) -> Self {
        Self { path: path.into(), text: text.into() }
    }
}

/// Разобранный модуль с каноническим путём.
#[derive(Debug, Clone)]
pub(crate) struct Module {
    pub path: String,
    pub program: Program,
}

/// Результат загрузки: модули (DFS-порядок) и канонический путь entry.
#[derive(Debug, Clone)]
pub(crate) struct Project {
    pub modules: Vec<Module>,
    pub entry_path: String,
}

/// Абсолютный ли путь (POSIX `/`, Windows `C:\`, UNC `\\`).
pub fn is_absolute_path(path: &str) -> bool {
    let p = path.replace('\\', "/");
    if p.starts_with('/') {
        return true;
    }
    let bytes = p.as_bytes();
    bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic()
}

/// Лексическая нормализация пути: `\\` → `/`, `.`/`..`, схлопывание `//`.
///
/// Симлинки не разрешаются — это чистая функция (важно для WASM-сборки и
/// детерминизма).
pub fn normalize_path(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let absolute = unified.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();

    for part in unified.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if let Some(last) = parts.last() {
                    if *last != ".." && !last.ends_with(':') {
                        parts.pop();
                    } else if !absolute {
                        parts.push("..");
                    }
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }

    let joined = parts.join("/");
    if absolute {
        format!("/{}", joined)
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
}

/// Каталог файла в нормализованном виде (`""` — текущий каталог).
fn parent_dir(path: &str) -> String {
    let normalized = normalize_path(path);
    match normalized.rfind('/') {
        // Корень абсолютного пути ("/main.lat") — это "/", а не "".
        Some(0) => "/".to_string(),
        Some(idx) => normalized[..idx].to_string(),
        None => String::new(),
    }
}

/// Разрешает путь из `import` относительно файла-источника.
///
/// v1: путь обязан быть относительным (`./` или `../`) и оканчиваться `.lat`.
pub fn resolve_import_path(base_file: &str, import: &str) -> Result<String, String> {
    let raw = import.replace('\\', "/");
    if is_absolute_path(&raw) {
        return Err(format!("абсолютный путь импорта недопустим: '{}'", import));
    }
    if !raw.ends_with(".lat") {
        return Err(format!(
            "путь импорта должен оканчиваться на '.lat': '{}'",
            import
        ));
    }
    if !(raw.starts_with("./") || raw.starts_with("../")) {
        return Err(format!(
            "путь импорта должен быть относительным ('./' или '../'): '{}'",
            import
        ));
    }
    let dir = parent_dir(base_file);
    let joined = if dir.is_empty() { raw } else { format!("{}/{}", dir, raw) };
    Ok(normalize_path(&joined))
}

/// Разбирает исходник и возвращает `import` с позициями объявлений (для CLI,
/// читающего дерево с диска). Ошибки лексера/парсера возвращаются текстом.
pub fn parse_imports(source: &str) -> Result<Vec<(String, Position)>, String> {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize().map_err(|e| e.to_string())?;
    let mut parser = Parser::new(tokens);
    let program = parser.parse().map_err(|e| e.to_string())?;
    Ok(program.imports.into_iter().map(|i| (i.path, i.pos)).collect())
}

/// То же, но только пути (без позиций).
pub fn parse_import_paths(source: &str) -> Result<Vec<String>, String> {
    Ok(parse_imports(source)?
        .into_iter()
        .map(|(path, _)| path)
        .collect())
}

/// Загружает проект из набора файлов. Entry обязан присутствовать в `files`.
pub(crate) fn load(files: &[SourceFile], entry_path: &str) -> Result<Project, String> {
    let mut by_path: HashMap<String, &SourceFile> = HashMap::new();
    for file in files {
        let canonical = normalize_path(&file.path);
        if let Some(previous) = by_path.get(&canonical) {
            if previous.text != file.text {
                return Err(format!(
                    "{}: файл передан дважды с разным содержимым",
                    canonical
                ));
            }
        }
        by_path.insert(canonical, file);
    }

    let entry = normalize_path(entry_path);
    if !by_path.contains_key(&entry) {
        return Err(format!("{}: entry-файл не найден среди переданных файлов", entry));
    }

    let mut parsed: HashMap<String, Program> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    visit(&entry, &by_path, &mut parsed, &mut order)?;

    let modules = order
        .into_iter()
        .filter_map(|path| {
            parsed.remove(&path).map(|program| Module { path, program })
        })
        .collect();
    Ok(Project { modules, entry_path: entry })
}

/// DFS: помечаем модуль разобранным ДО обхода импортов — циклы разрешены.
fn visit(
    path: &str,
    by_path: &HashMap<String, &SourceFile>,
    parsed: &mut HashMap<String, Program>,
    order: &mut Vec<String>,
) -> Result<(), String> {
    if parsed.contains_key(path) {
        return Ok(());
    }
    let file = by_path
        .get(path)
        .ok_or_else(|| format!("{}: файл не найден", path))?;
    let program = parse_file(path, &file.text)?;
    let imports = program.imports.clone();
    parsed.insert(path.to_string(), program);
    order.push(path.to_string());

    for import in imports {
        let resolved = resolve_import_path(path, &import.path).map_err(|msg| {
            format!("{}:{}:{}: {}", path, import.pos.line, import.pos.column, msg)
        })?;
        if !by_path.contains_key(&resolved) {
            return Err(format!(
                "{}:{}:{}: файл не найден: {}",
                path, import.pos.line, import.pos.column, resolved
            ));
        }
        visit(&resolved, by_path, parsed, order)?;
    }
    Ok(())
}

/// Лексинг + парсинг файла; ошибка всегда с путём.
fn parse_file(path: &str, text: &str) -> Result<Program, String> {
    let mut lexer = Lexer::new(text);
    let tokens = lexer.tokenize().map_err(|e| format!("{}: {}", path, e))?;
    let mut parser = Parser::new(tokens);
    parser.parse().map_err(|e| format!("{}: {}", path, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_relative() {
        assert_eq!(normalize_path("./a.lat"), "a.lat");
        assert_eq!(normalize_path("a/./b/../c.lat"), "a/c.lat");
        assert_eq!(normalize_path("sub\\x.lat"), "sub/x.lat");
        assert_eq!(normalize_path("../x.lat"), "../x.lat");
    }

    #[test]
    fn normalize_absolute() {
        assert_eq!(normalize_path("C:\\work\\src\\..\\main.lat"), "C:/work/main.lat");
        assert_eq!(normalize_path("/a//b/../c.lat"), "/a/c.lat");
        assert!(is_absolute_path("C:/x.lat"));
        assert!(is_absolute_path("/x.lat"));
        assert!(!is_absolute_path("./x.lat"));
    }

    #[test]
    fn resolve_relative_paths() {
        assert_eq!(resolve_import_path("src/main.lat", "./math.lat").unwrap(), "src/math.lat");
        assert_eq!(resolve_import_path("src/main.lat", "../lib/math.lat").unwrap(), "lib/math.lat");
        assert_eq!(resolve_import_path("main.lat", "./sub/../math.lat").unwrap(), "math.lat");
    }

    #[test]
    fn resolve_from_absolute_root() {
        // Web IDE может передавать пути workspace с ведущим "/".
        assert_eq!(resolve_import_path("/main.lat", "./math.lat").unwrap(), "/math.lat");
        assert_eq!(resolve_import_path("/src/main.lat", "../lib/m.lat").unwrap(), "/lib/m.lat");
    }

    #[test]
    fn parse_imports_returns_positions() {
        let imports = parse_imports("// x\nimport { a } from \"./a.lat\";\nimport \"./b.lat\";").unwrap();
        assert_eq!(imports.len(), 2);
        assert_eq!(imports[0].0, "./a.lat");
        assert_eq!(imports[0].1.line, 2);
        assert_eq!(imports[1].1.line, 3);
    }

    #[test]
    fn reject_bad_import_paths() {
        assert!(resolve_import_path("main.lat", "math.lat").unwrap_err().contains("относительным"));
        assert!(resolve_import_path("main.lat", "./math").unwrap_err().contains(".lat"));
        assert!(resolve_import_path("main.lat", "/abs/math.lat").unwrap_err().contains("абсолютный"));
        assert!(resolve_import_path("main.lat", "C:\\abs\\math.lat").unwrap_err().contains("абсолютный"));
    }

    #[test]
    fn load_cycle_and_order() {
        let files = vec![
            SourceFile::new("b.lat", "import { a } from \"./a.lat\";\nexport fn b() -> int { return a(); }"),
            SourceFile::new("a.lat", "import { b } from \"./b.lat\";\nexport fn a() -> int { return 1; }"),
            SourceFile::new("main.lat", "import { a } from \"./a.lat\";\nfn main() -> int { return a(); }"),
        ];
        let project = load(&files, "main.lat").unwrap();
        assert_eq!(project.modules.len(), 3);
        assert_eq!(project.entry_path, "main.lat");
        let paths: Vec<&str> = project.modules.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(paths, vec!["main.lat", "a.lat", "b.lat"]);
    }

    #[test]
    fn load_missing_file() {
        let files = vec![SourceFile::new("main.lat", "import { a } from \"./nope.lat\";")];
        let err = load(&files, "main.lat").unwrap_err();
        assert!(err.contains("main.lat:1:1"), "{err}");
        assert!(err.contains("не найден"), "{err}");
    }

    #[test]
    fn load_missing_entry() {
        let err = load(&[], "main.lat").unwrap_err();
        assert!(err.contains("entry"), "{err}");
    }

    #[test]
    fn load_parse_error_has_path() {
        let files = vec![SourceFile::new("bad.lat", "fn main() { let x = ; }")];
        let err = load(&files, "bad.lat").unwrap_err();
        assert!(err.starts_with("bad.lat:"), "{err}");
    }

    #[test]
    fn load_bad_path_has_position() {
        let files = vec![SourceFile::new("main.lat", "import { a } from \"x.lat\";")];
        let err = load(&files, "main.lat").unwrap_err();
        assert!(err.contains("main.lat:1:1"), "{err}");
        assert!(err.contains("относительным"), "{err}");
    }

    #[test]
    fn parse_import_paths_works() {
        let paths = parse_import_paths("import \"./a.lat\";\nimport { x } from \"../b.lat\";").unwrap();
        assert_eq!(paths, vec!["./a.lat", "../b.lat"]);
        assert!(parse_import_paths("import ?;").is_err());
    }

    #[test]
    fn duplicate_file_with_same_text_is_ok() {
        let files = vec![
            SourceFile::new("./main.lat", "fn main() -> int { return 0; }"),
            SourceFile::new("main.lat", "fn main() -> int { return 0; }"),
        ];
        assert!(load(&files, "main.lat").is_ok());
    }

    #[test]
    fn duplicate_file_with_other_text_errors() {
        let files = vec![
            SourceFile::new("main.lat", "fn main() -> int { return 0; }"),
            SourceFile::new("./main.lat", "fn main() -> int { return 1; }"),
        ];
        let err = load(&files, "main.lat").unwrap_err();
        assert!(err.contains("дважды"), "{err}");
    }
}
