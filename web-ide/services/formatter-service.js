// services/formatter-service.js — автоформатирование и выравнивание кода Latent.
// Единственная ответственность: привести исходник к единому стилю
// (отступы в 4 пробела, выравнивание по фигурным скобкам, пробелы после
// запятых). Чистая функция без DOM — легко тестируется.

const INDENT = '    ';

const OP_CHARS = new Set(['=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '!']);

/** Двухсимвольные операторы языка Latent. */
const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '->']);

/** Символы, после которых `-`/`+`/`!` считаются унарными. */
const UNARY_PRECEDERS = '([{,;:=<>+-*/%&|!';

/**
 * Разбивает входные «pieces» на операторные токены (1–2 символа), не
 * склеивая соседние независимые операторы (`=-` → `=`, `-`).
 * @param {Array<{ch:string, protected:boolean}>} pieces
 * @returns {Array<{start:number, end:number, op:string}>}
 */
function collectOperatorTokens(pieces) {
    const tokens = [];
    let i = 0;
    while (i < pieces.length) {
        const p = pieces[i];
        if (p.protected || !OP_CHARS.has(p.ch)) { i++; continue; }
        const next = pieces[i + 1];
        const two = next && !next.protected ? p.ch + next.ch : '';
        if (TWO_CHAR_OPS.has(two)) {
            tokens.push({ start: i, end: i + 2, op: two });
            i += 2;
        } else {
            tokens.push({ start: i, end: i + 1, op: p.ch });
            i += 1;
        }
    }
    return tokens;
}

/**
 * Разбирает строку на символы, помечая участки внутри строковых литералов
 * и комментариев как «защищённые» — их содержимое форматирование не трогает.
 * Состояние блочного комментария сохраняется между строками.
 * @param {string} line
 * @param {{inBlockComment: boolean}} state
 * @returns {Array<{ch: string, protected: boolean}>}
 */
function scanLine(line, state) {
    const out = [];
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (state.inBlockComment) {
            out.push({ ch, protected: true });
            if (ch === '*' && next === '/') {
                out.push({ ch: next, protected: true });
                i++;
                state.inBlockComment = false;
            }
            continue;
        }

        if (ch === '/' && next === '/') {
            for (let j = i; j < line.length; j++) out.push({ ch: line[j], protected: true });
            return out;
        }
        if (ch === '/' && next === '*') {
            out.push({ ch, protected: true });
            out.push({ ch: next, protected: true });
            i++;
            state.inBlockComment = true;
            continue;
        }

        if (ch === '"') {
            out.push({ ch, protected: true });
            i++;
            while (i < line.length) {
                out.push({ ch: line[i], protected: true });
                if (line[i] === '\\' && i + 1 < line.length) {
                    out.push({ ch: line[i + 1], protected: true });
                    i += 2;
                    continue;
                }
                if (line[i] === '"') { i++; break; }
                i++;
            }
            i--;
            continue;
        }

        out.push({ ch, protected: false });
    }
    return out;
}

/**
 * Считает открытые/закрытые фигурные скобки строки (вне строк и комментариев).
 * @param {Array<{ch:string, protected:boolean}>} chars
 * @returns {{opens: number, leadingClose: number}}
 */
function braceStats(chars) {
    let opens = 0;
    let leadingClose = 0;
    let seenCode = false;
    for (const { ch, protected: isProtected } of chars) {
        if (isProtected) {
            if (ch !== ' ' && ch !== '\t') seenCode = true;
            continue;
        }
        if (ch === '{') { opens++; seenCode = true; }
        else if (ch === '}') {
            if (!seenCode) leadingClose++;
            opens--;
            seenCode = true;
        } else if (ch !== ' ' && ch !== '\t') {
            seenCode = true;
        }
    }
    return { opens, leadingClose };
}

/**
 * Вставляет пробел после запятой, если его нет (вне защищённых участков).
 * @param {Array<{ch:string, protected:boolean}>} pieces
 */
function spaceAfterComma(pieces) {
    for (let i = 0; i < pieces.length; i++) {
        if (pieces[i].protected || pieces[i].ch !== ',') continue;
        const nxt = pieces[i + 1];
        if (nxt && !nxt.protected && nxt.ch !== ' ' && nxt.ch !== ')' && nxt.ch !== ']'
            && nxt.ch !== '}') {
            pieces.splice(i + 1, 0, { ch: ' ', protected: false });
            i++;
        }
    }
}

/**
 * Проставляет пробел перед открывающей фигурной скобкой (`) {`, `x {`),
 * кроме начала строки. Также добавляет пробел после `;` внутри круглых
 * скобок (заголовок for), где точка с запятой разделяет части выражения.
 * @param {Array<{ch:string, protected:boolean}>} pieces
 */
function spaceBracesAndSemis(pieces) {
    let parenDepth = 0;
    // Идентификаторы-ключевые слова, после которых ставится пробел перед '('.
    const keywordBuf = [];
    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (p.protected) { keywordBuf.length = 0; continue; }
        if (/[A-Za-z0-9_]/.test(p.ch)) { keywordBuf.push(p.ch); continue; }
        if (p.ch === '(') {
            const word = keywordBuf.join('');
            if (['for', 'while', 'if', 'match', 'return'].includes(word)
                && pieces[i - 1] && !pieces[i - 1].protected && pieces[i - 1].ch !== ' ') {
                pieces.splice(i, 0, { ch: ' ', protected: false });
                i++;
            }
            keywordBuf.length = 0;
            parenDepth++;
            continue;
        }
        keywordBuf.length = 0;
        if (p.ch === ')') { parenDepth = Math.max(0, parenDepth - 1); continue; }

        if (p.ch === '{') {
            const prev = pieces[i - 1];
            if (prev && !prev.protected && prev.ch !== ' ' && prev.ch !== '{') {
                pieces.splice(i, 0, { ch: ' ', protected: false });
                i++;
            }
            continue;
        }
        if (p.ch === ';' && parenDepth > 0) {
            const next = pieces[i + 1];
            if (next && !next.protected && next.ch !== ' ') {
                pieces.splice(i + 1, 0, { ch: ' ', protected: false });
                i++;
            }
        }
    }
}

/**
 * Схлопывает подряд идущие пробелы вне «защищённых» участков (строки/комментарии
 * сохраняются дословно). Табуляции внутри строк/комментариев не трогаются.
 * @param {Array<{ch:string, protected:boolean}>} pieces
 * @returns {string}
 */
function collapseSpaces(pieces) {
    let out = '';
    let spaceRun = false;
    for (const p of pieces) {
        if (p.protected) {
            spaceRun = false;
            out += p.ch;
            continue;
        }
        if (p.ch === ' ' || p.ch === '\t') {
            if (!spaceRun) { out += ' '; spaceRun = true; }
            continue;
        }
        spaceRun = false;
        out += p.ch;
    }
    return out;
}

/**
 * Нормализует пробелы вокруг бинарных операторов (`==`, `+`, `<=`, `->` и т.п.),
 * не трогая унарные (`-x`, `!flag`) и содержимое строк/комментариев.
 * @param {Array<{ch:string, protected:boolean}>} pieces
 */
function spaceOperators(pieces) {
    // Вставляем пробелы справа-налево, чтобы индексы ранее найденных токенов
    // не сдвигались. Токены собраны до вставок.
    const tokens = collectOperatorTokens(pieces);

    const isUnaryToken = (tok) => {
        if (tok.op !== '-' && tok.op !== '+' && tok.op !== '!') return false;
        let k = tok.start - 1;
        while (k >= 0 && !pieces[k].protected && (pieces[k].ch === ' ' || pieces[k].ch === '\t')) k--;
        const prevCh = k >= 0 ? pieces[k].ch : '';
        return prevCh === '' || UNARY_PRECEDERS.includes(prevCh);
    };

    for (let t = tokens.length - 1; t >= 0; t--) {
        const tok = tokens[t];
        if (isUnaryToken(tok)) continue;
        // Пробел справа (перед ним не ставим, если он уже есть).
        const afterIdx = tok.end;
        const after = pieces[afterIdx];
        const needRight = after && !after.protected && after.ch !== ' '
            && after.ch !== ')' && after.ch !== ']' && after.ch !== '}'
            && after.ch !== ',' && after.ch !== ';';
        // Пробел слева.
        const before = pieces[tok.start - 1];
        const needLeft = before && !before.protected && before.ch !== ' '
            && before.ch !== '(' && before.ch !== '[' && before.ch !== '{';

        // Важно: вставка справа сдвигает индексы, поэтому правим от конца.
        if (needRight) pieces.splice(afterIdx, 0, { ch: ' ', protected: false });
        if (needLeft) pieces.splice(tok.start, 0, { ch: ' ', protected: false });
    }
}

/**
 * Форматирует исходник Latent: единые отступы и пробелы.
 * @param {string} source
 * @returns {string}
 */
export function formatLatent(source) {
    if (typeof source !== 'string' || source.length === 0) return source || '';

    const normalized = source.replace(/\r\n?/g, '\n');
    const rawLines = normalized.split('\n');

    const result = [];
    let depth = 0;
    const state = { inBlockComment: false };

    for (const rawLine of rawLines) {
        const trimmed = rawLine.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

        if (trimmed === '') {
            result.push('');
            continue;
        }

        const chars = scanLine(trimmed, state);
        const { opens, leadingClose } = braceStats(chars);
        const lineDepth = Math.max(0, depth - leadingClose);

        const pieces = chars.map(c => ({ ...c }));
        spaceAfterComma(pieces);
        spaceOperators(pieces);
        spaceBracesAndSemis(pieces);
        const text = collapseSpaces(pieces).replace(/[ \t]+$/, '');

        result.push(INDENT.repeat(lineDepth) + text);
        depth = Math.max(0, depth + opens);
    }

    // Схлопываем повторяющиеся пустые строки, убираем пустые в конце.
    const collapsed = [];
    for (const line of result) {
        if (line === '' && collapsed.length > 0 && collapsed[collapsed.length - 1] === '') continue;
        collapsed.push(line);
    }
    while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();

    return collapsed.join('\n') + '\n';
}