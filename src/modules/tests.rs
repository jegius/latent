//! Тесты модулей: загрузка, линковка, bundle, C-ABI манифест.

use super::loader::SourceFile;
use super::*;

fn wasm_magic(bytes: &[u8]) -> bool {
    bytes.len() > 4 && &bytes[0..4] == b"\0asm"
}

fn pair(main: &str, math: &str) -> Vec<SourceFile> {
    vec![
        SourceFile::new("main.lat", main),
        SourceFile::new("math.lat", math),
    ]
}

const MATH: &str = r#"
export fn square(x: int) -> int { return x * x; }

export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
    fn norm2() -> int { return square(this.x) + square(this.y); }
}

export enum Shape { Circle(int), Rect(int, int) }
"#;

#[test]
fn compile_files_imports_class_enum() {
    let main = r#"
import { square, Point, Shape } from "./math.lat";
import { square as sq } from "./math.lat";

fn main() -> int {
    let p = new Point(3, 4);
    let s = Circle(2);
    let v = match s { case Circle(r): p.norm2() + sq(r), default: 0 };
    return v;
}
"#;
    let wasm = compile_files(&pair(main, MATH), "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
    assert!(wasm.len() > 20);
}

#[test]
fn compile_files_single_file_equals_compile_source() {
    let src = "fn main() -> int { let x = 1 + 2 * 3; return x; }";
    let files = vec![SourceFile::new("main.lat", src)];
    let project = compile_files(&files, "main.lat").unwrap();
    let single = crate::compile_source(src).unwrap();
    assert_eq!(project, single, "однофайловый compile_files должен совпадать с compile_source");
}

#[test]
fn compile_files_is_deterministic_by_input_order() {
    let main = "import { f } from \"./m.lat\";\nfn main() -> int { return f(2); }";
    let m = "export fn f(x: int) -> int { return x + 1; }";
    let a = compile_files(&[SourceFile::new("main.lat", main), SourceFile::new("m.lat", m)], "main.lat").unwrap();
    let b = compile_files(&[SourceFile::new("m.lat", m), SourceFile::new("main.lat", main)], "main.lat").unwrap();
    assert_eq!(a, b);
}

#[test]
fn bundle_compiles_to_same_bytes() {
    let main = "import { f } from \"./m.lat\";\nfn main() -> int { return f(2); }";
    let m = "export fn f(x: int) -> int { return x + 1; }";
    let files = [SourceFile::new("main.lat", main), SourceFile::new("m.lat", m)];
    let direct = compile_files(&files, "main.lat").unwrap();
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert!(!bundle.contains("import"), "{bundle}");
    assert!(!bundle.contains("export"), "{bundle}");
    let from_bundle = crate::compile_source(&bundle).unwrap();
    assert_eq!(direct, from_bundle, "bundle:\n{bundle}");
}

#[test]
fn bundle_has_no_import_export_and_mangled_names() {
    let main = "import { f } from \"./m.lat\";\nfn main() -> int { return f(2); }";
    let m = "export fn f(x: int) -> int { return x + 1; }";
    let bundle = bundle_files(&[SourceFile::new("main.lat", main), SourceFile::new("m.lat", m)], "main.lat").unwrap();
    assert!(bundle.contains("fn main"), "{bundle}");
    assert!(bundle.contains("m0__f") || bundle.contains("m1__f"), "{bundle}");
    assert!(!bundle.contains('$'), "{bundle}");
}

#[test]
fn compile_source_rejects_imports_with_hint() {
    let err = crate::compile_source("import { a } from \"./a.lat\";\nfn main() -> int { return 0; }").unwrap_err();
    assert!(err.contains("compile_files"), "{err}");
}

#[test]
fn compile_source_allows_export_modifier() {
    let wasm = crate::compile_source("export fn f() -> int { return 1; }\nfn main() -> int { return f(); }").unwrap();
    assert!(wasm_magic(&wasm));
}

#[test]
fn unknown_export_is_error_with_path() {
    let files = pair("import { nope } from \"./math.lat\";\nfn main() -> int { return 0; }", MATH);
    let err = compile_files(&files, "main.lat").unwrap_err();
    assert!(err.starts_with("main.lat:1:10"), "{err}");
    assert!(err.contains("не экспортирован"), "{err}");
}

#[test]
fn missing_module_is_error_with_path() {
    let files = vec![SourceFile::new("main.lat", "import { a } from \"./nope.lat\";")];
    let err = compile_files(&files, "main.lat").unwrap_err();
    assert!(err.contains("main.lat:1:1"), "{err}");
    assert!(err.contains("не найден"), "{err}");
}

#[test]
fn duplicate_import_name_is_error() {
    let math = "export fn a() -> int { return 1; }\nexport fn b() -> int { return 2; }";
    let main = "import { a } from \"./math.lat\";\nimport { b as a } from \"./math.lat\";\nfn main() -> int { return a(); }";
    let err = compile_files(&pair(main, math), "main.lat").unwrap_err();
    assert!(err.contains("дубликат импортированного имени"), "{err}");
}

#[test]
fn import_conflicts_with_local_decl() {
    let math = "export fn a() -> int { return 1; }";
    let main = "import { a } from \"./math.lat\";\nfn a() -> int { return 0; }\nfn main() -> int { return a(); }";
    let err = compile_files(&pair(main, math), "main.lat").unwrap_err();
    assert!(err.contains("уже объявлено"), "{err}");
}

#[test]
fn side_effect_import_loads_module() {
    let math = "export fn unused() -> int { return 1; }";
    let main = "import \"./math.lat\";\nfn main() -> int { return 0; }";
    let wasm = compile_files(&pair(main, math), "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
}

#[test]
fn local_variable_shadows_import() {
    let math = "export fn a() -> int { return 1; }";
    let main = "import { a } from \"./math.lat\";\nfn main() -> int { let a = 5; return a; }";
    let wasm = compile_files(&pair(main, math), "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
}

#[test]
fn typecheck_error_reported() {
    let math = "export fn need(p: int) -> int { return p; }";
    let main = "import { need } from \"./math.lat\";\nfn main() -> int { return need(\"s\"); }";
    let err = compile_files(&pair(main, math), "main.lat").unwrap_err();
    assert!(!err.is_empty());
}

#[test]
fn cross_module_enum_variants_and_patterns() {
    let math = "export enum Color { Red, Green(int) }";
    let main = "import { Color } from \"./math.lat\";\nfn main() -> int { let c = Green(2); let v = match c { case Green(x): x, case Red: 0, default: 9 }; return v; }";
    let wasm = compile_files(&pair(main, math), "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
}

#[test]
fn cross_module_recursion() {
    let a = "import { even } from \"./b.lat\";\nexport fn odd(n: int) -> int { if (n == 0) { return 0; } return even(n - 1); }";
    let b = "import { odd } from \"./a.lat\";\nexport fn even(n: int) -> int { if (n == 0) { return 1; } return odd(n - 1); }";
    let main = "import { odd } from \"./a.lat\";\nfn main() -> int { return odd(5); }";
    let files = vec![
        SourceFile::new("a.lat", a),
        SourceFile::new("b.lat", b),
        SourceFile::new("main.lat", main),
    ];
    let wasm = compile_files(&files, "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(wasm, crate::compile_source(&bundle).unwrap());
}

#[test]
fn manifest_abi_compile_files() {
    let files = pair(
        "import { f } from \"./m.lat\";\nfn main() -> int { return f(2); }",
        "export fn f(x: int) -> int { return x + 1; }",
    );
    // Переименуем m.lat → m.lat в манифесте: files выше второй путь math.lat.
    let files = if files[1].path == "math.lat" {
        vec![files[0].clone(), SourceFile::new("m.lat", files[1].text.clone())]
    } else {
        files
    };
    let manifest = manifest::encode(&files, 0);
    let res = crate::latent_compile_files(manifest.as_ptr(), manifest.len());
    assert!(!res.is_null());
    let status = unsafe { std::ptr::read_unaligned(res as *const u32) };
    let len = unsafe { std::ptr::read_unaligned((res as *const u32).add(1)) } as usize;
    assert_eq!(status, 1);
    let payload = unsafe { std::slice::from_raw_parts(res.add(8), len) };
    assert_eq!(&payload[0..4], b"\0asm");
    crate::latent_free(res, 8 + len);
}

#[test]
fn manifest_abi_error_status_zero() {
    let manifest = manifest::encode(&[SourceFile::new("main.lat", "import { a } from \"./x.lat\";")], 0);
    let res = crate::latent_compile_files(manifest.as_ptr(), manifest.len());
    let status = unsafe { std::ptr::read_unaligned(res as *const u32) };
    let len = unsafe { std::ptr::read_unaligned((res as *const u32).add(1)) } as usize;
    assert_eq!(status, 0);
    let payload = unsafe { std::slice::from_raw_parts(res.add(8), len) };
    assert!(String::from_utf8_lossy(payload).contains("не найден"));
    crate::latent_free(res, 8 + len);
}

#[test]
fn manifest_abi_bundle_files() {
    let files = pair(
        "import { f } from \"./math.lat\";\nfn main() -> int { return f(2); }",
        "export fn f(x: int) -> int { return x + 1; }",
    );
    let manifest = manifest::encode(&files, 0);
    let res = crate::latent_bundle_files(manifest.as_ptr(), manifest.len());
    let status = unsafe { std::ptr::read_unaligned(res as *const u32) };
    let len = unsafe { std::ptr::read_unaligned((res as *const u32).add(1)) } as usize;
    assert_eq!(status, 1);
    let payload = unsafe { std::slice::from_raw_parts(res.add(8), len) };
    let text = String::from_utf8_lossy(payload);
    assert!(text.contains("fn main"));
    assert!(!text.contains("import"));
    crate::latent_free(res, 8 + len);
}

#[test]
fn missing_entry_errors() {
    let err = compile_files(&[SourceFile::new("a.lat", "fn a() -> int { return 1; }")], "main.lat").unwrap_err();
    assert!(err.contains("entry"), "{err}");
}

#[test]
fn links_to_flat_program_with_mangled_names() {
    let math = "export fn f() -> int { return 1; }\nexport class P { x: int; }";
    let main = "import { f, P } from \"./math.lat\";\nfn main() -> int { let p = new P(); return f(); }";
    let linked = super::link_files(&pair(main, math), "main.lat").unwrap();
    assert!(linked.imports.is_empty());
    assert!(linked.exports.is_empty());
    let mut names = Vec::new();
    for stmt in &linked.statements {
        match &stmt.kind {
            crate::ast::StmtKind::Fn { name, .. } => names.push(name.clone()),
            crate::ast::StmtKind::Class { name, .. } => names.push(name.clone()),
            _ => {}
        }
    }
    // Порядок модулей — по canonical path: main.lat (m0), math.lat (m1).
    assert!(names.contains(&"main".to_string()), "{names:?}");
    assert!(names.contains(&"m1$f".to_string()), "{names:?}");
    assert!(names.contains(&"m1$P".to_string()), "{names:?}");
}

#[test]
fn export_without_declaration_is_error() {
    use super::loader::{Module, Project};
    use crate::ast::{ExportFlag, Program};
    let program = Program {
        statements: Vec::new(),
        imports: Vec::new(),
        exports: vec![ExportFlag {
            name: "nope".to_string(),
            pos: crate::lexer::Position::new(2, 3, 4),
        }],
    };
    let project = Project {
        modules: vec![Module { path: "main.lat".to_string(), program }],
        entry_path: "main.lat".to_string(),
    };
    let err = super::linker::link(project).unwrap_err();
    assert!(err.contains("export 'nope'"), "{err}");
    assert!(err.contains("main.lat:2:3"), "{err}");
}

#[test]
fn imported_class_alias_and_type_annotation() {
    let math = r#"
export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
}
export fn take(p: Point) -> int { return p.x + p.y; }
"#;
    let main = r#"
import { Point as P, take } from "./math.lat";
fn main() -> int { let p = new P(2, 3); return take(p); }
"#;
    let files = pair(main, math);
    let wasm = compile_files(&files, "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(wasm, crate::compile_source(&bundle).unwrap(), "{bundle}");
}

#[test]
fn lambda_captures_imported_function() {
    let math = "export fn inc(x: int) -> int { return x + 1; }";
    let main = "import { inc } from \"./math.lat\";\nfn main() -> int { let f = fn(x: int) => inc(x); return f(2); }";
    let files = pair(main, math);
    let wasm = compile_files(&files, "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(wasm, crate::compile_source(&bundle).unwrap(), "{bundle}");
}

#[test]
fn same_variant_names_in_different_modules() {
    let a = "export enum Color { Red, Blue(int) }\nexport fn a() -> int { let c = Red; return 7; }";
    let b = "export enum State { Red, Green(int) }\nexport fn b() -> int { let s = Green(2); let v = match s { case Green(x): x, default: 0 }; return v; }";
    let main = "import { a } from \"./a.lat\";\nimport { b } from \"./b.lat\";\nfn main() -> int { return a() + b(); }";
    let files = vec![
        SourceFile::new("a.lat", a),
        SourceFile::new("b.lat", b),
        SourceFile::new("main.lat", main),
    ];
    let wasm = compile_files(&files, "main.lat").unwrap();
    assert!(wasm_magic(&wasm));
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(wasm, crate::compile_source(&bundle).unwrap(), "{bundle}");
}

#[test]
fn duplicate_variant_names_across_imported_enums() {
    let a = "export enum Color { Red, Blue(int) }";
    let b = "export enum State { Red, Green(int) }";
    let main = "import { Color } from \"./a.lat\";\nimport { State } from \"./b.lat\";\nfn main() -> int { return 0; }";
    let files = vec![
        SourceFile::new("a.lat", a),
        SourceFile::new("b.lat", b),
        SourceFile::new("main.lat", main),
    ];
    let err = compile_files(&files, "main.lat").unwrap_err();
    assert!(err.contains("дубликат импортированного имени 'Red'"), "{err}");
}

#[test]
fn intermodule_type_mismatch_is_reported() {
    let math = "export class P { x: int; }\nexport fn take(p: P) -> int { return 0; }";
    let main = "import { P, take } from \"./math.lat\";\nfn main() -> int { return take(1); }";
    let err = compile_files(&pair(main, math), "main.lat").unwrap_err();
    assert!(!err.is_empty());
}

#[test]
fn bundle_prints_every_construct() {
    // Полный набор конструкций: bundle только печатает (без typecheck/codegen),
    // поэтому здесь допустимы каналы, await и AI-примитивы.
    let math = r#"
export fn ident(x: int) -> int { return x; }
export class C {
    v: int;
    fn init(v: int) { this.v = v; }
    fn get() -> int { return this.v; }
}
export enum E { A, B(int) }
"#;
    let main = r#"
import { ident, C, E } from "./math.lat";
async fn ap() -> int { return ident(1); }
fn main() -> int {
    let c = new C(1);
    let e = B(2);
    let arr = [ident(1), 2];
    arr[0] = ident(3);
    let f = fn(x: int) { return ident(x); };
    let g = fn(x: int) => ident(x);
    let m = match e { case B(x): ident(x), case A: 0, default: 1 };
    let sel = select { case v <- 1: ident(v), default: 2 };
    let ch = 1;
    ch <- ident(1);
    let r = <-ch;
    let aw = await ap();
    let gen = ai_generate!("p");
    while (false) { ident(1); }
    for (let x in arr) { ident(x); }
    for (let i = 0; i < 1; i = i + 1) { ident(i); }
    if (true) { ident(1); } else { ident(2); }
    spawn { ident(1); }
    test "t" { ident(1); }
    @snapshot("s") let z = ident(1);
    yield;
    return m;
}
"#;
    let files = pair(main, math);
    let bundle = bundle_files(&files, "main.lat").unwrap();
    for needle in [
        "fn m1__ident", "class m1__C", "enum m1__E", "m1__B", "new m1__C",
        "fn(x: int) {", "=> ", "match ", "select {", " <- ", "(<-ch)", "await ",
        "ai_generate!", "while (", "for (let ", "for (let i = 0;", "if (", "spawn {",
        "test \"t\"", "@snapshot", "yield;", "async fn m0__ap",
    ] {
        assert!(bundle.contains(needle), "нет {needle:?} в bundle:\n{bundle}");
    }
    assert!(!bundle.contains("import"), "{bundle}");
    assert!(!bundle.contains('$'), "{bundle}");
    // Bundle обязан быть синтаксически корректным Latent.
    let mut lexer = crate::lexer::Lexer::new(&bundle);
    let tokens = lexer.tokenize().unwrap();
    crate::parser::Parser::new(tokens).parse().unwrap();
}

#[test]
fn bundle_of_supported_features_compiles_to_same_bytes() {
    let src = r#"
class Box {
    v: int;
    fn init(v: int) { this.v = v; }
    fn get() -> int { return this.v; }
}
enum E { A, B(int) }
fn add(a: int, b: int) -> int { return a + b; }
fn main() -> int {
    let b = new Box(add(1, 2));
    let arr = [1, 2, 3];
    arr[0] = 5;
    let i = 0;
    while (i < 2) { i = i + 1; }
    for (let x in arr) { i = i + x; }
    for (let j = 0; j < 2; j = j + 1) { i = i + j; }
    if (i > 3) { i = i + 1; } else { i = 0; }
    let f = fn(x: int) => add(x, i);
    let g = fn(x: int) { return x * 2; };
    let e = B(4);
    let m = match e { case B(x): x, case A: 0, default: 9 };
    let s = "abc";
    print(s, len(arr), f(1), g(2), b.get(), m);
    spawn { print(1); }
    test "t" { print(2); }
    yield;
    return f(3);
}
"#;
    let files = vec![SourceFile::new("main.lat", src)];
    let direct = compile_files(&files, "main.lat").unwrap();
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(direct, crate::compile_source(&bundle).unwrap(), "{bundle}");
    // Selfhost не принимает `(this.v = v)`; в позиции инструкции скобки не нужны.
    assert!(bundle.contains("this.v = v;"), "{bundle}");
    assert!(bundle.contains("arr[0] = 5;"), "{bundle}");
    assert!(!bundle.contains("(this.v = v)"), "{bundle}");
}

#[test]
fn bundle_prints_edge_syntax() {
    fn bundle(src: &str) -> String {
        bundle_files(&[SourceFile::new("main.lat", src)], "main.lat").unwrap()
    }
    let snippets = [
        // Типовые аннотации: массив, fn-тип, generic, class/enum.
        "fn f(xs: [int], cb: fn(int) -> int, t: Tensor<[float]>) -> int { return 0; }\nfn main() -> int { return 0; }",
        // for (;;) и C-стиль с init-выражением.
        "fn main() -> int { for (;;) { } let i = 0; for (i = 0; i < 1; i = i + 1) { } return 0; }",
        // select: default без веток, пустой statement, пустое выражение.
        "fn main() -> int { select { default: { print(1); } } select { } let x = select { }; return 0; }",
        // Декоратор без аргументов, пустые spawn/test, yield.
        "fn main() -> int { @snapshot let z = 1; spawn { } test \"n\" { } yield; return 0; }",
        // Класс без типов полей, пустой enum, литеральные паттерны match.
        "class C { x; }\nenum E { }\nfn main() -> int { let v = 1; let r = match v { case 1: 0, case \"s\": 1, case _: 2 }; return r; }",
        // else-if и вложенные блоки.
        "fn main() -> int { let x = 1; if (x > 0) { x = 2; } else if (x == 0) { x = 3; } else { x = 4; } return x; }",
    ];
    for src in snippets {
        let text = bundle(src);
        assert!(!text.contains("import") && !text.contains('$'), "{text}");
        let mut lexer = crate::lexer::Lexer::new(&text);
        let tokens = lexer.tokenize().unwrap_or_else(|e| panic!("{e}\n{text}"));
        crate::parser::Parser::new(tokens)
            .parse()
            .unwrap_or_else(|e| panic!("{e}\n{text}"));
    }
}

#[test]
fn bundle_covers_operators_and_select_statement() {
    let src = r#"
fn main() -> int {
    let a = 1;
    let b = 2;
    let x = a + b - b * a / b % 2;
    let y = (a == b) || (a != b) && (a < b);
    let z = (a <= b) | (a >= b) & (a > b) ^ (a << 1) >> 1;
    let n = -a;
    let m = !false;
    let u = null;
    let s = "x";
    select { case v <- 1: { print(v); } default: { print(0); } }
    return x + y + z + n + m + len(s);
}
"#;
    let files = vec![SourceFile::new("main.lat", src)];
    let direct = compile_files(&files, "main.lat").unwrap();
    let bundle = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(direct, crate::compile_source(&bundle).unwrap(), "{bundle}");
    for op in ["+", "-", "*", "/", "%", "==", "!=", "<", ">", "<=", ">=", "&&", "||", "|", "&", "^", "<<", ">>"] {
        assert!(bundle.contains(op), "нет {op:?}:\n{bundle}");
    }
}

#[test]
fn bundle_rejects_unprintable_ast() {
    use crate::ast::*;
    let pos = crate::lexer::Position::new(1, 1, 0);
    // AiInfer не имеет Latent-синтаксиса.
    let expr = Expr {
        kind: ExprKind::AiInfer {
            model: Box::new(Expr { kind: ExprKind::Null, pos }),
            input: Box::new(Expr { kind: ExprKind::Null, pos }),
        },
        pos,
    };
    let stmt = Stmt { kind: StmtKind::Expr(expr), pos };
    let program = Program::new(vec![stmt]);
    assert!(super::bundle::print_program(&program).unwrap_err().contains("синтаксиса"));

    // Union-тип тоже не печатается.
    let fn_stmt = Stmt {
        kind: StmtKind::Fn {
            name: "f".to_string(),
            params: vec![Param {
                name: "x".to_string(),
                ty: Some(Type::Union(vec![Type::Named("int".to_string())])),
            }],
            ret_ty: None,
            body: vec![],
            is_async: false,
        },
        pos,
    };
    let program = Program::new(vec![fn_stmt]);
    assert!(super::bundle::print_program(&program).unwrap_err().contains("union"));
}

#[test]
fn bundle_is_deterministic() {
    let files = pair(
        "import { f } from \"./math.lat\";\nfn main() -> int { return f(2); }",
        "export fn f(x: int) -> int { return x + 1; }",
    );
    let a = bundle_files(&files, "main.lat").unwrap();
    let b = bundle_files(&files, "main.lat").unwrap();
    assert_eq!(a, b);
}

#[test]
fn compile_files_uses_entry_main_export() {
    // entry main не манглятся — WASM экспортирует main.
    let math = "export fn f() -> int { return 1; }";
    let main = "import { f } from \"./math.lat\";\nfn main() -> int { return f(); }";
    let wasm = compile_files(&pair(main, math), "main.lat").unwrap();
    assert!(wasm.windows(4).any(|w| w == b"main"));
}
