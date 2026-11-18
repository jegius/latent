//! Файловые модули Latent: загрузка, линковка, bundle, манифест для WASM.
//!
//! Публичный API:
//! * [`compile_files`] — компиляция проекта (`&[SourceFile]` + entry);
//! * [`bundle_files`] — плоский Latent-исходник (для self-hosted компилятора);
//! * [`SourceFile`] — файл проекта.
//!
//! Однофайловая компиляция осталась в [`crate::compile_source`].

pub mod bundle;
pub mod loader;
pub mod linker;
pub mod manifest;
mod rewrite;
mod rewrite_types;

#[cfg(test)]
mod tests;

use crate::ast::Program;

pub use loader::SourceFile;

/// Загружает и линкует проект в единый `Program` без import/export.
pub(crate) fn link_files(files: &[SourceFile], entry_path: &str) -> Result<Program, String> {
    let project = loader::load(files, entry_path)?;
    linker::link(project)
}

/// Компилирует проект из набора файлов в WASM-байты.
///
/// `entry_path` — путь entry-файла; он должен присутствовать в `files`
/// (пути нормализуются: `./`, `..`, `\` → `/`).
pub fn compile_files(files: &[SourceFile], entry_path: &str) -> Result<Vec<u8>, String> {
    let program = link_files(files, entry_path)?;
    crate::compile_program(&program)
}

/// Собирает плоский Latent-исходник проекта (все модули слиты, имена
/// манглены, `import`/`export` удалены). Результат компилируется
/// однофайловым пайплайном (и selfhost-компилятором) в те же WASM-байты.
pub fn bundle_files(files: &[SourceFile], entry_path: &str) -> Result<String, String> {
    let program = link_files(files, entry_path)?;
    bundle::print_program(&program)
}
