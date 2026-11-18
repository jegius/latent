// tooling/latent-lsp/src/formatter-scan.mjs — посимвольный разбор строки для
// форматтера.
//
// Помечает «защищённые» участки (строковые литералы и комментарии), которые
// форматирование обязано оставлять дословно, и считает фигурные скобки для
// вычисления отступов. Вынесено из formatter.mjs, чтобы каждый модуль оставался
// небольшим и отвечал за одну задачу.

/**
 * Разбирает строку на символы, помечая участки внутри строковых литералов и
 * комментариев как «защищённые» — их содержимое форматирование не трогает.
 * Состояние блочного комментария сохраняется между строками.
 * @param {string} line
 * @param {{inBlockComment: boolean}} state
 * @returns {Array<{ch: string, protected: boolean}>}
 */
export function scanLine(line, state) {
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
 * @param {Array<{ch: string, protected: boolean}>} chars
 * @returns {{opens: number, leadingClose: number}}
 */
export function braceStats(chars) {
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
