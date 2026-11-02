// Инструментатор подмножества Latent для сбора покрытия self-hosted компилятора.
//
// Задача: в начало каждой функции верхнего уровня вставить вызов `cov_bump(ID)`,
// а счётчики хранить в линейной памяти инструментированного компилятора.
//
// Почему адрес 32768..65535:
//   * 0..1023      — нулевая страница (null и зарезервировано);
//   * 1024..       — data-секция скомпилированного компилятора (строки);
//   * 65536..      — OUTB (выходной WASM), занят компилятором;
//   * 3145728..    — INPUT (входной исходник);
//   * выше         — таблицы компилятора (KIND/TVAL/.../ERRB, см. 00_abi.lat).
// Диапазон 32768..65535 — единственная дыра в карте памяти shc, которая
// гарантированно не пересекается ни с одной областью компилятора: старый
// адрес INPUT (32768) больше не используется (INPUT = 3145728). Диапазон
// целиком помещается в начальную память модуля (>= 16 страниц = 1 MiB),
// поэтому счётчики доступны ещё до `alloc(4600000)` в драйвере.
//
// Раскладка счётчиков:
//   [32768 .. 49152)  — 4096 счётчиков функций (ID 0..4095);
//   [49152 .. 65536)  — 4096 счётчиков строк   (ID 4096..8191).
//
// Инструментатор не является парсером Latent: он сканирует верхний уровень
// (глубина фигурных скобок 0) и корректно пропускает строки, линейные и
// вложенные блочные комментарии. Этого достаточно для shc.lat, где все
// функции объявлены на верхнем уровне, а лямбды — выражения внутри тел.

export const COUNTER_BASE = 32768;
export const FUNCTION_CAP = 4096;
export const LINE_ID_BASE = 4096;
export const LINE_CAP = 4096;
export const LINE_COUNTER_BASE = COUNTER_BASE + LINE_ID_BASE * 4; // 49152

const PREAMBLE =
  "// ==== selfhost-coverage: инструментированная сборка (генерируется tooling/selfhost-coverage) ====\n" +
  "fn cov_bump(id) -> int { let a = 32768 + id * 4; store32(a, load32(a) + 1); return 0; }\n" +
  "fn cov_read(id) -> int { return load32(32768 + id * 4); }\n\n";

function isIdentStart(c) {
  return c !== undefined && ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_");
}
function isIdentChar(c) {
  return isIdentStart(c) || (c >= "0" && c <= "9");
}

function skipLineComment(src, i) {
  while (i < src.length && src[i] !== "\n") i++;
  return i;
}
function skipBlockComment(src, i) {
  let depth = 1;
  i += 2;
  while (i < src.length && depth > 0) {
    if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; }
    else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; }
    else i++;
  }
  return i;
}
function skipString(src, i) {
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === '"') return i + 1;
    i++;
  }
  return i;
}
function skipTrivia(src, i) {
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    return i;
  }
  return i;
}

/** Ищет закрывающую `}` для `{` в позиции open; -1 при незакрытой. */
function findMatchingBrace(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (c === '"') { i = skipString(src, i); continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Разбирает заголовок `fn name(...) [-> T] {` начиная с позиции после `fn`.
// Возвращает { name, bodyOpen } либо null, если это не объявление функции
// (например, тип `fn(int) -> int`).
function parseFnHeader(src, afterFn) {
  let i = skipTrivia(src, afterFn);
  if (!isIdentStart(src[i])) return null;
  const nameStart = i;
  while (i < src.length && isIdentChar(src[i])) i++;
  const name = src.slice(nameStart, i);
  i = skipTrivia(src, i);
  if (src[i] !== "(") return null;

  // Пропускаем параметры с балансом скобок.
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (c === '"') { i = skipString(src, i); continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { i++; break; }
    }
    i++;
  }
  // После параметров: `-> T` и/или `{`.
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (c === "{") return { name, bodyOpen: i };
    if (c === ";") return { name, bodyOpen: -1 };
    i++;
  }
  return null;
}

/**
 * Возвращает объявления функций верхнего уровня в порядке исходника.
 * @param {string} source
 * @returns {{name:string, bodyOpen:number, bodyClose:number}[]}
 */
export function scanTopLevelFunctions(source) {
  const funcs = [];
  let i = 0;
  let brace = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") { i = skipLineComment(source, i); continue; }
    if (c === "/" && source[i + 1] === "*") { i = skipBlockComment(source, i); continue; }
    if (c === '"') { i = skipString(source, i); continue; }
    if (c === "{") { brace++; i++; continue; }
    if (c === "}") { brace = brace > 0 ? brace - 1 : 0; i++; continue; }
    if (brace === 0 && isIdentStart(c)) {
      let j = i + 1;
      while (j < source.length && isIdentChar(source[j])) j++;
      const word = source.slice(i, j);
      if (word === "fn") {
        const header = parseFnHeader(source, j);
        if (header && header.bodyOpen >= 0) {
          const close = findMatchingBrace(source, header.bodyOpen);
          if (close < 0) {
            throw new Error(`selfhost-coverage: незакрытая функция ${header.name} (offset ${header.bodyOpen})`);
          }
          funcs.push({ name: header.name, bodyOpen: header.bodyOpen, bodyClose: close });
          i = close + 1;
          continue;
        }
      }
      i = j;
      continue;
    }
    i++;
  }
  return funcs;
}

function buildLineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineIndexAt(starts, off) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Индекс частей сборки: маркеры `// ===== часть: NN_name.lat =====`. */
function buildPartIndex(source, starts) {
  const parts = [];
  for (let i = 0; i < starts.length; i++) {
    const end = starts[i + 1] ?? source.length;
    const m = /^\/\/ ===== часть: (.+?) =====\s*$/.exec(source.slice(starts[i], end));
    if (m) parts.push({ name: m[1], markerLine: i + 1, offset: starts[i] });
  }
  return parts;
}

/** Часть и номер строки внутри неё (1-based) для смещения в собранном файле. */
function partAt(parts, starts, off) {
  let part = null;
  for (const p of parts) {
    if (p.offset <= off) part = p;
    else break;
  }
  const absolute = lineIndexAt(starts, off) + 1;
  if (!part) return { part: "-", line: absolute, endLine: absolute };
  return { part: part.name, line: absolute - part.markerLine, endLine: absolute - part.markerLine };
}

/**
 * Кандидаты на строчные счётчики: только начало инструкции внутри тела
 * функции. Проверка консервативная — если сомневаемся, счётчик не ставим.
 */
function lineCandidates(source, bodyOpen, bodyClose) {
  const candidates = [];
  let paren = 0;
  let bracket = 0;
  let prevSig = "{";
  let i = bodyOpen + 1;
  let start = i;
  let state = { paren: 0, bracket: 0, prevSig: "{" };

  const pushLine = (end) => {
    if (start > bodyClose) return;
    if (state.paren === 0 && state.bracket === 0 && (state.prevSig === "{" || state.prevSig === "}" || state.prevSig === ";")) {
      const raw = source.slice(start, end);
      const trimmed = raw.trim();
      if (trimmed !== "" && isStatementStart(trimmed)) {
        candidates.push({ offset: start, text: trimmed });
      }
    }
  };

  while (i <= bodyClose) {
    if (i === bodyClose) { pushLine(i); break; }
    const c = source[i];
    if (c === "\n") {
      pushLine(i);
      i++;
      start = i;
      state = { paren, bracket, prevSig };
      continue;
    }
    if (c === "/" && source[i + 1] === "/") { i = skipLineComment(source, i); continue; }
    if (c === "/" && source[i + 1] === "*") { i = skipBlockComment(source, i); continue; }
    if (c === '"') { i = skipString(source, i); prevSig = '"'; continue; }
    if (c === "(") paren++;
    else if (c === ")") paren = paren > 0 ? paren - 1 : 0;
    else if (c === "[") bracket++;
    else if (c === "]") bracket = bracket > 0 ? bracket - 1 : 0;
    if (c !== " " && c !== "\t" && c !== "\r") prevSig = c;
    i++;
  }
  return candidates;
}

function isStatementStart(trimmed) {
  // Закрывающие/продолжающие строки и ветки — не начало инструкции.
  if (/^(\}|\belse\b|\bcase\b|\bdefault\b|\/\/|\/\*|\*|\.|,|\)|\]|=|\?|:)/.test(trimmed)) return false;
  // Известные начала инструкций + вызов/присваивание/индексация по имени.
  return /^(let\b|return\b|if\s*\(|while\s*\(|for\s*\(|spawn\b|yield\b|select\b|test\b|this\.|[A-Za-z_]\w*\s*(?:\.|\[|=|\())/.test(
    trimmed,
  );
}

/**
 * Инструментирует исходник.
 *
 * @param {string} source собранный shc.lat (или отдельный .lat)
 * @param {{lines?: boolean}} [opts]
 * @returns {{
 *   source: string,
 *   functions: {id:number,name:string,part:string,file:string,line:number,endLine:number}[],
 *   lines: {id:number,functionId:number,functionName:string,part:string,line:number,text:string}[],
 *   counterBase:number, lineCounterBase:number,
 * }}
 */
export function instrumentSource(source, opts = {}) {
  const linesMode = Boolean(opts.lines);
  const funcs = scanTopLevelFunctions(source);
  if (funcs.length > FUNCTION_CAP) {
    throw new Error(`selfhost-coverage: ${funcs.length} функций > FUNCTION_CAP=${FUNCTION_CAP}; увеличьте раскладку счётчиков`);
  }
  const starts = buildLineStarts(source);
  const partIndex = buildPartIndex(source, starts);
  const functions = funcs.map((f, id) => {
    const start = partAt(partIndex, starts, f.bodyOpen);
    const end = partAt(partIndex, starts, f.bodyClose);
    return {
      id,
      name: f.name,
      part: start.part,
      file: start.part === "-" ? "shc.lat" : `selfhost/src/${start.part}`,
      line: start.line,
      endLine: end.line,
      bodyOpen: f.bodyOpen,
      bodyClose: f.bodyClose,
    };
  });

  /** @type {Map<number,string[]>} */
  const insertions = new Map();
  const addInsertion = (offset, text) => {
    if (!insertions.has(offset)) insertions.set(offset, []);
    insertions.get(offset).push(text);
  };

  for (const f of functions) {
    addInsertion(f.bodyOpen + 1, ` cov_bump(${f.id});`);
  }

  const lineRecords = [];
  if (linesMode) {
    let nextId = LINE_ID_BASE;
    for (const f of functions) {
      const cands = lineCandidates(source, f.bodyOpen, f.bodyClose);
      for (const cand of cands) {
        if (nextId >= LINE_ID_BASE + LINE_CAP) {
          throw new Error(`selfhost-coverage: счётчиков строк > ${LINE_CAP}`);
        }
        const line = partAt(partIndex, starts, cand.offset).line;
        lineRecords.push({
          id: nextId,
          functionId: f.id,
          functionName: f.name,
          part: f.part,
          line,
          text: cand.text.slice(0, 120),
        });
        addInsertion(cand.offset, `cov_line(${nextId}); `);
        nextId++;
      }
    }
  }

  const offsets = [...insertions.keys()].sort((a, b) => a - b);
  let out = "";
  let last = 0;
  for (const off of offsets) {
    out += source.slice(last, off);
    out += insertions.get(off).join("");
    last = off;
  }
  out += source.slice(last);

  // `cov_line` объявляется только в строчном режиме: иначе инструментатор
  // не должен добавлять неиспользуемую функцию (она меняет индексы функций).
  const preamble = linesMode
    ? PREAMBLE.replace(
        "fn cov_read(id) -> int { return load32(32768 + id * 4); }\n",
        "fn cov_line(id) -> int { let a = 32768 + id * 4; store32(a, load32(a) + 1); return 0; }\n" +
          "fn cov_read(id) -> int { return load32(32768 + id * 4); }\n",
      )
    : PREAMBLE;

  return {
    source: preamble + out,
    functions: functions.map(({ bodyOpen, bodyClose, ...rest }) => rest),
    lines: lineRecords,
    counterBase: COUNTER_BASE,
    lineCounterBase: LINE_COUNTER_BASE,
  };
}

/** Есть ли в исходнике пользовательские имена, конфликтующие с преамбулой. */
export function findPreambleConflicts(source) {
  const names = new Set(["cov_bump", "cov_read", "cov_line"]);
  return scanTopLevelFunctions(source)
    .map((f) => f.name)
    .filter((n) => names.has(n));
}
