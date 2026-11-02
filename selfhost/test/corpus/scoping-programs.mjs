// Кейсы лексической области видимости из scoping.test.mjs.

export const SCOPING_PROGRAMS = [
  {
    name: "повторный let того же имени в соседнем блоке не путает слоты",
    src: `
fn classify(c) -> int {
    let n = 0;
    if (c < 100) {
        let k = 10;
        n = n + k;
    } else {
        let k = 20;
        n = n + k;
    }
    return n;
}
fn main() -> int { return classify(200) + classify(50); }
`,
    main: 30,
  },
  {
    name: "одноимённые let в соседних ветках во вложенном блоке",
    src: `
fn f(c) -> int {
    let r = 0;
    if (c == 1) {
        let x = 100;
        r = r + x;
    } else {
        if (c == 2) {
            let x = 200;
            r = r + x;
        } else {
            let x = 300;
            r = r + x;
        }
    }
    return r;
}
fn main() -> int { return f(1) + f(2) + f(3); }
`,
    main: 600,
  },
  {
    name: "повторное объявление let — последняя привязка активна",
    src: `
fn f() -> int {
    let k = 1;
    let r = 0;
    if (k == 1) {
        let k = 5;
        r = r + k;
    }
    r = r + k;
    return r;
}
fn main() -> int { return f(); }
`,
    main: 10,
  },
  {
    name: "let внутри цикла не утекает за его пределы",
    src: `
fn f() -> int {
    let total = 0;
    let i = 0;
    while (i < 3) {
        let step = 2;
        total = total + step;
        i = i + 1;
    }
    return total;
}
fn main() -> int { return f(); }
`,
    main: 6,
  },
];
