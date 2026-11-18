//! Интеграционные тесты файловых модулей Latent (публичный API + CLI).

use std::path::{Path, PathBuf};
use std::process::Command;

use latent::{bundle_files, compile_files, compile_source, SourceFile};

const MATH: &str = r#"
export fn square(x: int) -> int { return x * x; }

export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
    fn norm2() -> int { return square(this.x) + square(this.y); }
}

export enum Shape { Circle(int), Rect(int, int) }

export fn norm(p: Point) -> int { return p.norm2(); }
"#;

const MAIN: &str = r#"
import { square, Point, Shape, norm } from "./math.lat";
import { square as sq } from "./math.lat";

fn main() -> int {
    let p = new Point(3, 4);
    let s = Circle(2);
    let v = match s { case Circle(r): norm(p) + sq(r), default: 0 };
    return v;
}
"#;

fn wasm_magic(bytes: &[u8]) -> bool {
    bytes.len() > 8 && &bytes[0..4] == b"\0asm"
}

fn project() -> Vec<SourceFile> {
    vec![
        SourceFile::new("main.lat", MAIN),
        SourceFile::new("math.lat", MATH),
    ]
}

fn temp_dir(tag: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    /// Уникальность между тестами одного процесса и между запусками.
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "latent-it-{}-{}-{}",
        tag,
        std::process::id(),
        n
    ));
    let _ = std::fs::remove_dir_all(&dir);
    // На Windows каталог в TEMP иногда кратковременно занят (антивирус,
    // индексирование) — пара ретраев убирает флаки.
    for attempt in 0..20 {
        match std::fs::create_dir_all(&dir) {
            Ok(()) => return dir,
            Err(e) if attempt == 19 => panic!("cannot create {}: {e}", dir.display()),
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(25)),
        }
    }
    unreachable!()
}

fn latentc() -> &'static str {
    env!("CARGO_BIN_EXE_latentc")
}

fn write_project(dir: &Path) {
    std::fs::write(dir.join("math.lat"), MATH).unwrap();
    std::fs::write(dir.join("main.lat"), MAIN).unwrap();
}

#[test]
fn compile_files_project_and_bundle_are_equal() {
    let wasm = compile_files(&project(), "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
    let bundle = bundle_files(&project(), "main.lat").unwrap();
    assert!(!bundle.contains("import"));
    assert!(!bundle.contains("export"));
    let from_bundle = compile_source(&bundle).unwrap();
    assert_eq!(wasm, from_bundle, "bundle:\n{bundle}");
}

#[test]
fn single_file_compile_files_matches_compile_source() {
    let src = r#"
class Box { v: int; fn init(v: int) { this.v = v; } fn get() -> int { return this.v; } }
enum E { A, B(int) }
fn add(a: int, b: int) -> int { return a + b; }
fn main() -> int {
    let b = new Box(add(1, 2));
    let arr = [1, 2, 3];
    let f = fn(x) => x * 2;
    let s = 0;
    for (let i in arr) { s = s + i; }
    for (let i = 0; i < 3; i = i + 1) { s = s + i; }
    let e = B(4);
    let m = match e { case B(x): x, case A: 0, default: 9 };
    return b.get() + s + f(3) + m;
}
"#;
    let files = vec![SourceFile::new("main.lat", src)];
    let a = compile_files(&files, "main.lat").unwrap();
    let b = compile_source(src).unwrap();
    assert_eq!(a, b);
}

#[test]
fn bundle_roundtrip_covers_control_flow_lambda_strings() {
    let src = r#"
fn helper(x: int) -> int { return x + 1; }
fn main() -> int {
    let total = 0;
    let i = 0;
    while (i < 3) { total = total + i; i = i + 1; }
    if (total > 2) { total = total + 1; } else { total = 0; }
    let f = fn(x: int) => helper(x) + total;
    let text = "a\\b\"c\n";
    print(text, len(text), f(2));
    return f(1);
}
"#;
    let files = vec![SourceFile::new("main.lat", src)];
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(compile_source(src).unwrap(), compile_source(&bundle).unwrap());
}

#[test]
fn hidden_files_are_resolved_relative_to_importer() {
    let files = vec![
        SourceFile::new("src/main.lat", "import { f } from \"../lib/m.lat\";\nfn main() -> int { return f(); }"),
        SourceFile::new("lib/m.lat", "export fn f() -> int { return 1; }"),
    ];
    let wasm = compile_files(&files, "src/main.lat").unwrap();
    assert!(wasm_magic(&wasm));
}

#[test]
fn cli_compile_check_bundle_and_errors() {
    let dir = temp_dir("cli");
    write_project(&dir);

    let compile = Command::new(latentc())
        .args(["compile", "main.lat", "out.wasm"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(compile.status.success(), "{}", String::from_utf8_lossy(&compile.stderr));
    let wasm = std::fs::read(dir.join("out.wasm")).unwrap();
    assert!(wasm_magic(&wasm));

    let check = Command::new(latentc())
        .args(["check", "main.lat"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(check.status.success());
    assert!(String::from_utf8_lossy(&check.stdout).contains("ok:"));

    let bundle = Command::new(latentc())
        .args(["bundle", "main.lat", "bundle.lat"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(bundle.status.success(), "{}", String::from_utf8_lossy(&bundle.stderr));
    let bundled = std::fs::read_to_string(dir.join("bundle.lat")).unwrap();
    assert!(!bundled.contains("import"));
    assert!(bundled.contains("m1__square") || bundled.contains("m0__square"));

    let from_bundle = Command::new(latentc())
        .args(["compile", "bundle.lat", "from_bundle.wasm"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(from_bundle.status.success(), "{}", String::from_utf8_lossy(&from_bundle.stderr));
    let wasm2 = std::fs::read(dir.join("from_bundle.wasm")).unwrap();
    assert_eq!(wasm, wasm2);

    // Ошибка линковки: путь файла в stderr + exit 1.
    std::fs::write(
        dir.join("bad.lat"),
        "import { nope } from \"./math.lat\";\nfn main() -> int { return 0; }",
    )
    .unwrap();
    let bad = Command::new(latentc())
        .args(["compile", "bad.lat", "bad.wasm"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(!bad.status.success());
    let stderr = String::from_utf8_lossy(&bad.stderr);
    assert!(stderr.contains("bad.lat"), "{stderr}");
    assert!(stderr.contains("не экспортирован"), "{stderr}");

    let version = Command::new(latentc()).arg("version").output().unwrap();
    assert!(version.status.success());
    assert!(String::from_utf8_lossy(&version.stdout).contains("latentc 0.1.0"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cli_missing_import_reports_path_and_exit_code() {
    let dir = temp_dir("missing");
    std::fs::write(
        dir.join("main.lat"),
        "import { f } from \"./nope.lat\";\nfn main() -> int { return 0; }",
    )
    .unwrap();
    let out = Command::new(latentc())
        .args(["compile", "main.lat", "out.wasm"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("nope.lat"), "{stderr}");
    assert!(stderr.contains("не найден"), "{stderr}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cli_bundle_to_stdout() {
    let dir = temp_dir("stdout");
    write_project(&dir);
    let out = Command::new(latentc())
        .args(["bundle", "main.lat"])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("fn main"));
    assert!(!text.contains("import"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn manifest_c_abi_roundtrip() {
    let files = project();
    let manifest = latent::modules::manifest::encode(&files, 0);
    let res = latent::latent_compile_files(manifest.as_ptr(), manifest.len());
    assert!(!res.is_null());
    let status = unsafe { std::ptr::read_unaligned(res as *const u32) };
    let len = unsafe { std::ptr::read_unaligned((res as *const u32).add(1)) } as usize;
    assert_eq!(status, 1);
    let payload = unsafe { std::slice::from_raw_parts(res.add(8), len) }.to_vec();
    assert!(wasm_magic(&payload));
    latent::latent_free(res, 8 + len);
}
