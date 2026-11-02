// Паритет новых конструкций: успешные и ошибочные кейсы.

export const PARITY_OK_CASES = {
  "spawn-блок исполняется последовательно": {
    src: `fn main() -> int { let x = 0; spawn { x = x + 1; } return x; }`,
    main: 1,
  },
  "spawn-выражение вычисляется inline": {
    src: `fn main() -> int { let x = 1; spawn x = x + 2; return x; }`,
    main: 3,
  },
  "return внутри spawn возвращает из объемлющей функции": {
    src: `fn main() -> int { spawn { return 7; } return 0; }`,
    main: 7,
  },
  "spawn-вызов печатает сразу": {
    src: `fn main() -> int { spawn print("t"); return 3; }`,
    main: 3,
    output: ["t"],
  },
  "yield — no-op": {
    src: `fn main() -> int { yield; return 4; }`,
    main: 4,
  },
  "async fn + await — passthrough": {
    src: `async fn v() -> int { return 5; } fn main() -> int { return await v() + 1; }`,
    main: 6,
  },
  "await локальной переменной": {
    src: `async fn v() -> int { return 5; } fn main() -> int { let x = v(); return await x + 1; }`,
    main: 6,
  },
  "select-выражение берёт первую ветку": {
    src: `fn main() -> int { return select { case v <- 0: 1, default: 2 }; }`,
    main: 1,
  },
  "select-выражение с default": {
    src: `fn main() -> int { return select { default: 2 }; }`,
    main: 2,
  },
  "пустой select-выражение = 0": {
    src: `fn main() -> int { return select { }; }`,
    main: 0,
  },
  "select-инструкция берёт первую ветку": {
    src: `fn main() -> int { select { case v <- 0: { return 5; } default: { return 6; } } }`,
    main: 5,
  },
  "select-инструкция с default": {
    src: `fn main() -> int { select { default: { return 6; } } }`,
    main: 6,
  },
  "select связывает переменную ветки с 0": {
    src: `fn main() -> int { select { case v <- 0: { return v + 7; } } return 0; }`,
    main: 7,
  },
  "select с несколькими ветками — первая": {
    src: `fn main() -> int { select { case a <- 0: { return 1; } case b <- 0: { return 2; } } }`,
    main: 1,
  },
  "top-level test не эмитится": {
    src: `test "t" { assert(false); } fn main() -> int { return 0; }`,
    main: 0,
  },
  "test внутри функции исполняется": {
    src: `fn main() -> int { test "t" { assert(1 == 1); } return 3; }`,
    main: 3,
  },
  "test(\"...\")-форма": {
    src: `test("t") { assert(1 == 1); } fn main() -> int { return 2; }`,
    main: 2,
  },
  "match по строковому литералу": {
    src: `fn main() -> int { let s = "b"; let r = match s { case "a": 1, case "b": 2, default: 3 }; return r; }`,
    main: 2,
  },
  "match по строке — default": {
    src: `fn main() -> int { let s = "z"; let r = match s { case "a": 1, case "b": 2, default: 3 }; return r; }`,
    main: 3,
  },
  "match по строке без default — 0": {
    src: `fn main() -> int { let s = "z"; let r = match s { case "a": 1, case "b": 2 }; return r; }`,
    main: 0,
  },
  "to_str/to_int (int/string)": {
    src: `fn main() -> int { let n = 7; let s = n.to_str(); let k = "42"; return len(s) + k.to_int(); }`,
    main: 43,
  },
  "to_str float — f64_to_str": {
    src: `fn main() -> int { let x = 2.5; return len(x.to_str()); }`,
    main: 8,
  },
  "to_int float — усечение": {
    src: `fn main() -> int { let x = 42.9; return x.to_int(); }`,
    main: 42,
  },
  "to_str строки — без изменений": {
    src: `fn main() -> int { let s = "abc"; return len(s.to_str()); }`,
    main: 3,
  },
  "top-level let без использования — компилируется": {
    src: `let g = 3; fn main() -> int { return 0; }`,
    main: 0,
  },
  "null ≡ 0": {
    src: `fn main() -> int { let n = null; return n + 3; }`,
    main: 3,
  },
  "строковый параметр индексируется как строка": {
    src: `fn f(s: string) -> int { return s[1]; } fn main() -> int { return f("abc"); }`,
    main: 98,
  },
  "print(int) конвертирует в строку": {
    src: `fn main() -> int { print(42); return 0; }`,
    main: 0,
    output: ["42"],
  },
  "print нескольких аргументов — по строке на аргумент": {
    src: `fn main() -> int { print("a", 1); return 0; }`,
    main: 0,
    output: ["a", "1"],
  },
  "print(float) — 6 знаков": {
    src: `fn main() -> int { print(2.5); return 0; }`,
    main: 0,
    output: ["2.500000"],
  },
  "print(bool/null)": {
    src: `fn main() -> int { print(true); print(null); return 0; }`,
    main: 0,
    output: ["1", "0"],
  },
  "print строкового параметра": {
    src: `fn p(s: string) { print(s); } fn main() -> int { p("hi"); return 0; }`,
    main: 0,
    output: ["hi"],
  },
  "float(\"...\") парсит строку": {
    src: `fn main() -> int { return int(float("3")) + int(float("3.9")); }`,
    main: 6,
  },
  "экспоненциальные литералы": {
    src: `fn main() -> int { return int(1e3) + int(2.5e1) + int(1250e-1); }`,
    main: 1000 + 25 + 125,
  },
  "escape-последовательности строк": {
    src: `fn main() -> int { return len("a\\nb") + len("a\\\"b") + len("a\\\\b"); }`,
    main: 9,
  },
  "вложенный блочный комментарий": {
    src: `fn main() -> int { /* a /* b */ c */ return 1; }`,
    main: 1,
  },
  "for-in по массиву (регресс)": {
    src: `fn main() -> int { let s = 0; for (let x in [1, 2, 3]) { s = s + x; } return s; }`,
    main: 6,
  },
  "короткое замыкание (регресс)": {
    src: `fn main() -> int { let s = 0; if (0 != 0 && (s = 1) == 1) { return 9; } if (0 == 0 || (s = 2) == 2) { return s; } return 7; }`,
    main: 0,
  },
};

// Паритет новых конструкций: кейсы, где все три компилятора обязаны отказать.

export const PARITY_ERROR_CASES = {
  "channel(): host-ошибка с именем builtin": {
    src: `fn main() -> int { let c = channel(); return 0; }`,
    re: /channel/i,
  },
  "tensor(): host-ошибка с именем builtin": {
    src: `fn main() -> int { let t = tensor([1, 2]); return 0; }`,
    re: /tensor/i,
  },
  "ai_infer(): host-ошибка с именем builtin": {
    src: `fn main() -> int { let s = ai_infer("m", "p"); return 0; }`,
    re: /ai_infer/i,
  },
  "ai_embed(): host-ошибка с именем builtin": {
    src: `fn main() -> int { let v = ai_embed("text"); return 0; }`,
    re: /ai_embed/i,
  },
  "snapshot(): host-ошибка с именем builtin": {
    src: `fn main() -> int { let b = snapshot("s"); return 0; }`,
    re: /snapshot/i,
  },
  "ai_generate!: AI требует host-рантайма": {
    src: `fn main() -> int { let s = ai_generate!("p"); return 0; }`,
    re: /AI primitives|host runtime/i,
  },
  "метод send — host-ошибка": {
    src: `fn main() -> int { let c = 0; c.send(1); return 0; }`,
    re: /send/,
  },
  "метод recv — host-ошибка": {
    src: `fn main() -> int { let c = 0; c.recv(); return 0; }`,
    re: /recv/,
  },
  "неизвестный метод — host-ошибка": {
    src: `fn main() -> int { return [1, 2].len(); }`,
    re: /len/,
  },
  "приём из канала <-ch": {
    src: `fn main() -> int { let ch = 0; <-ch; return 0; }`,
    re: /channel operations/i,
  },
  "отправка в канал ch <- v": {
    src: `fn main() -> int { let ch = 0; ch <- 1; return 0; }`,
    re: /channel operations/i,
  },
  "top-level let в функции — осмысленная ошибка, не invalid wasm": {
    src: `let g = 3; fn main() -> int { return g; }`,
    re: /undefined variable/i,
    also: /g/,
  },
  "неизвестная функция — имя в тексте": {
    src: `fn main() -> int { return nosuch(1); }`,
    re: /undefined function/i,
    also: /nosuch/,
  },
  "неизвестная переменная — имя в тексте": {
    src: `fn main() -> int { return nope; }`,
    re: /undefined variable/i,
    also: /nope/,
  },
  "for-in по строке — ошибка типов, как oracle": {
    src: `fn main() -> int { let s = 0; for (let c in "abc") { s = s + c; } return s; }`,
    re: /type mismatch/i,
  },
};

// Лексические сниппеты из lexer.test.mjs: прогоняются через tokenize+остальной
// компилятор, поэтому дают покрытие ветвей лексера на краевых входах.
