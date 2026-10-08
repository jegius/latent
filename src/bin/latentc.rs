//! `latentc` — CLI компилятора Latent.
//!
//! Использование:
//!   latentc compile <file.lat> [out.wasm]   — скомпилировать файл в WASM
//!   latentc check <file.lat>                — только лексинг/парсинг/типизация
//!   latentc version                          — версия компилятора

use std::process::ExitCode;

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
            match std::fs::read_to_string(path) {
                Ok(src) => match latent::compile_source(&src) {
                    Ok(wasm) => {
                        println!("ok: {} bytes of wasm", wasm.len());
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("error: {}", e);
                        ExitCode::FAILURE
                    }
                },
                Err(e) => {
                    eprintln!("cannot read {}: {}", path, e);
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
            match std::fs::read_to_string(path) {
                Ok(src) => match latent::compile_source(&src) {
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
                },
                Err(e) => {
                    eprintln!("cannot read {}: {}", path, e);
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("latentc {}", latent::VERSION);
            eprintln!("usage:");
            eprintln!("  latentc compile <file.lat> [out.wasm]");
            eprintln!("  latentc check <file.lat>");
            eprintln!("  latentc version");
            ExitCode::FAILURE
        }
    }
}