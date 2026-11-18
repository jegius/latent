// Кейсы покрытия конструкций, встречающихся в shc.lat.

export const COVERAGE_CASES = {
  "литерал массива и чтение по индексу": {
    src: `fn main() -> int { let a = [10, 20, 30]; return a[0] + a[1] * 2 + a[2]; }`,
    main: 10 + 40 + 30,
  },
  "длина массива": {
    src: `fn main() -> int { return [1, 2, 3, 4, 5].length; }`,
    main: 5,
  },
  "присваивание в элемент": {
    src: `fn main() -> int { let a = [1, 2, 3]; a[1] = 99; return a[0] + a[1] + a[2]; }`,
    main: 1 + 99 + 3,
  },
  "for-in по массиву": {
    src: `fn main() -> int { let a = [3, 5, 7, 11]; let s = 0; for (let x in a) { s = s + x; } return s; }`,
    main: 26,
  },
  "for-in накапливает индекс, как oracle": {
    src: `fn f() -> int { let a = [2, 4, 6]; let s = 0; for (let v in a) { s = s + v; } return s; }
fn main() -> int { return f() + f(); }`,
    main: 24,
  },
  // Обе ветки проверяют короткое замыкание: `a != 0` ложно (&& не вычисляет
  // правый операнд), `a == 0` истинно (|| не вычисляет правый). Поэтому ни
  // одно присваивание в `s` не выполняется и main возвращает 0; при жадном
  // вычислении получилось бы 11.
  "короткое замыкание &&/|| пропускает правый операнд": {
    src: `fn main() -> int {
  let s = 0;
  let a = 0;
  if (a != 0 && (s = s + 1) == 1) { return 99; }
  if (a == 0 || (s = s + 10) == 10) { return s; }
  return 100;
}`,
    main: 0,
  },
  "&& внутри || как в is_alpha": {
    src: `fn is_alpha(c) -> bool { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95; }
fn main() -> int { if (is_alpha(65) && is_alpha(95) && !is_alpha(48)) { return 1; } return 0; }`,
    main: 1,
  },
  "вложенные && при сканировании": {
    src: `fn scan(a) -> int {
  let i = 0; let n = 0;
  while (i < 10) {
    if (i > 2 && i < 8 && i != 5) { n = n + 1; }
    i = i + 1;
  }
  return n;
}
fn main() -> int { return scan(0); }`,
    main: 4,
  },
  "блочный комментарий": {
    src: `fn main() -> int { /* leading */ let x = 3; /* mid */ return x * 2; }`,
    main: 6,
  },
  "цепочка присваиваний с индексом": {
    src: `fn main() -> int {
  let a = [0, 0, 0, 0];
  a[0] = 5; a[1] = a[0] + 1; a[2] = a[1] * 2; a[3] = a[2] - a[0];
  return a[0] + a[1] + a[2] + a[3];
}`,
    main: 5 + 6 + 12 + 7,
  },
  "вызов с числом-аргументом и индексом": {
    src: `fn put(a, i, v) -> int { a[i] = v; return v; }
fn main() -> int { let a = [0, 0, 0]; put(a, 2, 109); return a[2]; }`,
    main: 109,
  },
  "while с индексной записью как в build_module": {
    src: `fn fill(n) -> int {
  let a = alloc(64);
  let i = 0;
  while (i < n) { store32(a + i * 4, i + 1); i = i + 1; }
  let s = 0; i = 0;
  while (i < n) { s = s + load32(a + i * 4); i = i + 1; }
  return s;
}
fn main() -> int { return fill(6); }`,
    main: 21,
  },
  "for-in внутри функции с накоплением": {
    src: `fn sum(a) -> int { let s = 0; for (let x in a) { s = s + x; } return s; }
fn main() -> int { return sum([1, 2, 3]) + sum([10, 20]); }`,
    main: 36,
  },
};

// Паритет новых конструкций: успешные кейсы.
