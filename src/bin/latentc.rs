//! `latentc` — CLI компилятора Latent.
//!
//! Использование:
//!   latentc compile <file.lat> [out.wasm]   — скомпилировать проект в WASM
//!   latentc check <file.lat>                — только лексинг/парсинг/типизация
//!   latentc bundle <file.lat> [out.lat]     — плоский Latent-исходник проекта
//!   latentc version                          — версия компилятора
//!
//! `compile`/`check` читают дерево импортов с диска (entry — обычный файл).
//! Однофайловые программы без `import` компилируются прежним путём
//! (`compile_source`), поэтому их WASM байт-в-байт не меняется.

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::ExitCode;

use latent::modules::loader;
use latent::SourceFile;

/// Дерево исходников проекта.
struct Tree {
    files: Vec<SourceFile>,
    /// Есть ли хоть один `import` (тогда нужен мультифайловый пайплайн).
    has_imports: bool,
}

fn absolute_path(path: &str) -> String {
    let candidate = PathBuf::from(path);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir().unwrap_or_default().join(candidate)
    };
    loader::normalize_path(&absolute.to_string_lossy())
}

fn read_text(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {}", path, e))
}

/// Читает entry и рекурсивно все файлы из его `import` (циклы безопасны).
fn read_tree(entry: &str) -> Result<Tree, String> {
    let entry_path = absolute_path(entry);
    let text = read_text(&entry_path)?;
    // Ошибку разбора entry отдаём БЕЗ префикса пути: для однофайловых программ
    // текст ошибки должен остаться прежним (golden).
    let entry_imports = loader::parse_imports(&text)?;

    let mut files = vec![SourceFile::new(entry_path.clone(), text)];
    let mut has_imports = !entry_imports.is_empty();
    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(entry_path.clone());

    // (импортёр, строка, столбец, разрешённый путь)
    let mut queue: Vec<(String, usize, usize, String)> = Vec::new();
    for (import, pos) in entry_imports {
        queue.push((
            entry_path.clone(),
            pos.line,
            pos.column,
            resolve(&entry_path, pos, &import)?,
        ));
    }

    while let Some((importer, line, column, path)) = queue.pop() {
        if !seen.insert(path.clone()) {
            continue;
        }
        let text = std::fs::read_to_string(&path).map_err(|e| {
            format!("{}:{}:{}: файл не найден: {} ({})", importer, line, column, path, e)
        })?;
        let imports = loader::parse_imports(&text)
            .map_err(|e| format!("{}: {}", path, e))?;
        if !imports.is_empty() {
            has_imports = true;
        }
        for (import, pos) in imports {
            queue.push((
                path.clone(),
                pos.line,
                pos.column,
                resolve(&path, pos, &import)?,
            ));
        }
        files.push(SourceFile::new(path, text));
    }

    Ok(Tree { files, has_imports })
}

fn resolve(
    base: &str,
    pos: latent::lexer::Position,
    import: &str,
) -> Result<String, String> {
    loader::resolve_import_path(base, import)
        .map_err(|e| format!("{}:{}:{}: {}", base, pos.line, pos.column, e))
}

/// Компилирует дерево: однофайловое — старым путём, проект — через линкер.
fn compile_tree(tree: &Tree, entry: &str) -> Result<Vec<u8>, String> {
    if tree.has_imports {
        latent::compile_files(&tree.files, &absolute_path(entry))
    } else {
        latent::compile_source(&tree.files[0].text)
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("version") | Some("--version") | Some("-v") => {
            println!("latentc {}", latent::VERSION);
            ExitCode::SUCCESS
        }
        Some("check") => {
            let Some(path) = args.get(2) else {
                eprintln!("usage: latentc check <file.lat>");
                return ExitCode::FAILURE;
            };
            match read_tree(path).and_then(|tree| compile_tree(&tree, path)) {
                Ok(wasm) => {
                    println!("ok: {} bytes of wasm", wasm.len());
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }
        Some("compile") => {
            let Some(path) = args.get(2) else {
                eprintln!("usage: latentc compile <file.lat> [out.wasm]");
                return ExitCode::FAILURE;
            };
            let out = args.get(3).cloned().unwrap_or_else(|| {
                let stem = path.trim_end_matches(".lat");
                format!("{}.wasm", stem)
            });
            match read_tree(path).and_then(|tree| compile_tree(&tree, path)) {
                Ok(wasm) => match std::fs::write(&out, &wasm) {
                    Ok(()) => {
                        println!("{} -> {} ({} bytes)", path, out, wasm.len());
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("cannot write {}: {}", out, e);
                        ExitCode::FAILURE
                    }
                },
                Err(e) => {
                    eprintln!("error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }
        Some("bundle") => {
            let Some(path) = args.get(2) else {
                eprintln!("usage: latentc bundle <file.lat> [out.lat]");
                return ExitCode::FAILURE;
            };
            let tree = match read_tree(path) {
                Ok(tree) => tree,
                Err(e) => {
                    eprintln!("error: {}", e);
                    return ExitCode::FAILURE;
                }
            };
            let entry = absolute_path(path);
            match latent::bundle_files(&tree.files, &entry) {
                Ok(source) => match args.get(3) {
                    Some(out) => match std::fs::write(out, source.as_bytes()) {
                        Ok(()) => {
                            println!("{} -> {} ({} bytes)", path, out, source.len());
                            ExitCode::SUCCESS
                        }
                        Err(e) => {
                            eprintln!("cannot write {}: {}", out, e);
                            ExitCode::FAILURE
                        }
                    },
                    None => {
                        print!("{}", source);
                        ExitCode::SUCCESS
                    }
                },
                Err(e) => {
                    eprintln!("error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("latentc {}", latent::VERSION);
            eprintln!("usage:");
            eprintln!("  latentc compile <file.lat> [out.wasm]");
            eprintln!("  latentc check <file.lat>");
            eprintln!("  latentc bundle <file.lat> [out.lat]");
            eprintln!("  latentc version");
            ExitCode::FAILURE
        }
    }
}
